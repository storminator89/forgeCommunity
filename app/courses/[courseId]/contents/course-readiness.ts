import type { CourseContent } from './types'
import { getQuizValidationError, parseQuizContent } from './types'
import { getContentValidationError } from './content-form-utils'
import { getAssignmentValidationError } from './assignment-content'
import { isSafeRichHtmlUrl } from '@/lib/html-sanitize-config'

export interface CourseReadinessFinding {
  id: string
  code: 'empty-course' | 'missing-title' | 'empty-content' | 'invalid-source' | 'invalid-quiz' | 'quiz-with-children'
  severity: 'attention' | 'note'
  contentId?: string
  title: string
  message: string
}

export interface CourseReadiness {
  rootCount: number
  totalContents: number
  leafCount: number
  quizCount: number
  readyLeafCount: number
  incompleteLeafCount: number
  findings: CourseReadinessFinding[]
  ready: boolean
}

/** Clone drafts without JSON round-tripping temporarily invalid values such as NaN. */
function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyValue(entry)])) as T
  }
  return value
}

/** Only editable lesson fields enter preview; saved hierarchy and ordering stay intact. */
export function deriveInstructorPreviewTree(contents: CourseContent[], draft?: CourseContent | null): CourseContent[] {
  return contents.map(content => {
    const matches = draft?.id === content.id && draft.courseId === content.courseId
    return {
      ...content,
      ...(matches ? { title: draft.title, type: draft.type } : {}),
      content: copyValue(matches ? draft.content : content.content),
      ...(content.subContents ? { subContents: deriveInstructorPreviewTree(content.subContents, draft) } : {}),
    }
  })
}

/** Advisory content detection, never an HTML trust boundary. Rendering still sanitizes. */
export function hasCourseTextContent(value: string): boolean {
  const withoutExecutableText = value.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
  const text = withoutExecutableText.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#0*160|#x0*a0);|\u00a0|\u200b/gi, ' ').trim()
  if (text) return true
  return [...withoutExecutableText.matchAll(/<img\b[^>]*\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)]
    .some(match => isSafeRichHtmlUrl(match[1] ?? match[2] ?? match[3] ?? '', 'src'))
}

function looksLikeQuiz(content: CourseContent) {
  if (content.type === 'QUIZ' || typeof content.content !== 'string') return true
  if (content.type !== 'TEXT') return false
  try {
    const value: unknown = JSON.parse(content.content)
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'questions'))
  } catch {
    return content.content.trimStart().startsWith('{') && /["']questions["']\s*:/.test(content.content)
  }
}

/** Inspect the current tree only. This is neither a publication gate nor learner progress. */
export function getCourseReadiness(contents: CourseContent[]): CourseReadiness {
  const findings: CourseReadinessFinding[] = []
  const result: CourseReadiness = { rootCount: contents.length, totalContents: 0, leafCount: 0, quizCount: 0, readyLeafCount: 0, incompleteLeafCount: 0, findings, ready: false }
  if (!contents.length) findings.push({ id: 'empty-course', code: 'empty-course', severity: 'attention', title: 'Noch keine Kursinhalte', message: 'Lege das erste Kapitel oder Thema an und fülle es mit Lerninhalt.' })

  const inspect = (items: CourseContent[]) => items.forEach(item => {
    result.totalContents++
    const quizLike = looksLikeQuiz(item)
    if (quizLike) result.quizCount++
    const children = item.subContents ?? []
    const before = findings.length
    const add = (code: CourseReadinessFinding['code'], message: string, severity: CourseReadinessFinding['severity'] = 'attention') => {
      findings.push({ id: `${item.id}:${code}`, code, severity, contentId: item.id, title: item.title.trim() || 'Thema ohne Titel', message })
    }
    if (!item.title.trim()) add('missing-title', 'Ergänze einen Titel, damit das Thema im Kurs erkennbar ist.')
    if (children.length) {
      if (quizLike) add('quiz-with-children', 'Dieses Quiz hat Unterthemen. Nur ein Quiz ohne Unterthemen kann als Quizabschluss gewertet werden.', 'note')
      inspect(children)
      return
    }
    result.leafCount++
    if (item.type === 'ASSIGNMENT') {
      const issue = getAssignmentValidationError(item.content)
      if (issue) add('invalid-source', issue)
    } else if (quizLike) {
      const quiz = parseQuizContent(item.content, item.courseId)
      const issue = quiz ? getQuizValidationError(quiz, item.courseId) : 'Die Quizdaten sind ungültig.'
      if (issue) add('invalid-quiz', issue)
    } else {
      const value = typeof item.content === 'string' ? item.content : ''
      if (!value.trim() || (item.type === 'TEXT' && !hasCourseTextContent(value))) {
        add('empty-content', item.type === 'TEXT' ? 'Dieses Thema enthält noch keinen Lerninhalt.' : 'Ergänze eine Quelle für diesen Medieninhalt.')
      } else {
        const issue = getContentValidationError(item.type, value, item.courseId)
        if (issue) add('invalid-source', issue)
      }
    }
    if (findings.slice(before).some(finding => finding.severity === 'attention')) result.incompleteLeafCount++
    else result.readyLeafCount++
  })
  inspect(contents)
  result.ready = result.leafCount > 0 && findings.length === 0
  return result
}
