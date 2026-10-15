import type { CourseContent } from './types'
import { getContentValidationError, inferContentType } from './content-form-utils'

export const CONTENT_TYPE_LABELS: Record<CourseContent['type'], string> = {
  TEXT: 'Text', VIDEO: 'Video', AUDIO: 'Audio', H5P: 'H5P', QUIZ: 'Quiz',
}

export interface AuthoringOutlineEntry {
  content: CourseContent
  depth: number
  position: string
  ancestorIds: string[]
  path: string[]
  siblingIndex: number
  siblingCount: number
  childCount: number
  leafCount: number
  type: CourseContent['type']
  readiness: 'empty' | 'check' | 'present'
  readinessLabel: string
}

/** Advisory authoring context only. This never changes learner requirements. */
export function outlineReadiness(content: CourseContent): Pick<AuthoringOutlineEntry, 'readiness' | 'readinessLabel'> {
  const type = inferContentType(content)
  const source = typeof content.content === 'string' ? content.content : JSON.stringify(content.content)
  const empty = type === 'TEXT'
    ? !source.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\u00a0/g, ' ').trim() && !/<(?:img|hr)\b/i.test(source)
    : !source.trim()
  if (empty) return { readiness: 'empty', readinessLabel: 'Noch leer' }
  if (getContentValidationError(type, content.content)) return { readiness: 'check', readinessLabel: type === 'QUIZ' ? 'Quiz prüfen' : 'Quelle prüfen' }
  return { readiness: 'present', readinessLabel: 'Inhalt vorhanden' }
}

/** Flatten for a narrow, reflowing outline while retaining every hierarchy level. */
export function authoringOutline(contents: CourseContent[]): AuthoringOutlineEntry[] {
  const entries: AuthoringOutlineEntry[] = []
  const seen = new Set<string>()
  const visit = (items: CourseContent[], ancestors: string[], path: string[], prefix: string) => {
    const ordered = [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    ordered.forEach((content, index) => {
      if (seen.has(content.id)) return
      seen.add(content.id)
      const position = prefix ? `${prefix}.${index + 1}` : `${index + 1}`
      const children = content.subContents || []
      const entry: AuthoringOutlineEntry = {
        content, depth: ancestors.length, position, ancestorIds: [...ancestors], path: [...path, content.title],
        siblingIndex: index, siblingCount: ordered.length, childCount: children.length, leafCount: 0,
        type: inferContentType(content), ...outlineReadiness(content),
      }
      entries.push(entry)
      const childStart = entries.length
      visit(children, [...ancestors, content.id], [...path, content.title], position)
      entry.leafCount = children.length ? entries.slice(childStart).filter(child => child.childCount === 0).length : 1
    })
  }
  visit(contents, [], [], '')
  return entries
}
