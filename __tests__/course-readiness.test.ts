import { deriveInstructorPreviewTree, getCourseReadiness, hasCourseTextContent } from '@/app/courses/[courseId]/contents/course-readiness'
import type { CourseContent, QuizContent } from '@/app/courses/[courseId]/contents/types'

const lesson = (id: string, extra: Partial<CourseContent> = {}): CourseContent => ({ id, courseId: 'course', title: id, type: 'TEXT', content: '<p>Lerninhalt</p>', order: 1, parentId: null, ...extra })
const quiz: QuizContent = { questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Welche Antwort?', options: ['A', 'B'], correctAnswers: [0] }], passingScore: 70 }

it('counts only leaves as learner topics at arbitrary depth and accepts empty chapter containers', () => {
  const contents = [lesson('chapter', { content: '', subContents: [lesson('nested', { content: '<p></p>', parentId: 'chapter', subContents: [lesson('deep-leaf', { parentId: 'nested' })] }), lesson('quiz', { parentId: 'chapter', type: 'QUIZ', content: quiz })] })]
  expect(getCourseReadiness(contents)).toMatchObject({ rootCount: 1, totalContents: 4, leafCount: 2, quizCount: 1, readyLeafCount: 2, incompleteLeafCount: 0, ready: true, findings: [] })
})

it('reports the empty course and does not call an empty curriculum ready', () => {
  expect(getCourseReadiness([])).toMatchObject({ totalContents: 0, leafCount: 0, ready: false, findings: [{ id: 'empty-course', code: 'empty-course' }] })
})

it.each(['', '<p></p>', '<p><br></p>', '<p>&nbsp; &#160; &#xA0;\u200b</p>', '<!-- a comment --><p> </p>', '<script>alert(1)</script>', '<style>p{color:red}</style>', '<p><img src="javascript:alert(1)"></p>'])('recognizes empty or non-renderable rich text: %s', content => {
  expect(hasCourseTextContent(content)).toBe(false)
  expect(getCourseReadiness([lesson('empty', { content })])).toMatchObject({ ready: false, incompleteLeafCount: 1, findings: [{ code: 'empty-content', contentId: 'empty' }] })
})

it.each(['<p>Text</p>', '<img src="/uploads/lesson.png" alt="Lernbild">', '<img src=https://example.org/lesson.png>', '<p>&lt;Beispiel&gt;</p>'])('accepts text and safe image-only lessons: %s', value => {
  expect(hasCourseTextContent(value)).toBe(true)
})

it('flags missing and unsafe media while treating supported configured sources as advisory', () => {
  const contents = [lesson('video', { type: 'VIDEO', content: '' }), lesson('unsafe', { type: 'AUDIO', content: 'javascript:alert(1)' }), lesson('h5p', { type: 'H5P', content: 'package_1' }), lesson('youtube', { type: 'VIDEO', content: 'https://www.youtube.com/watch?v=abc123' })]
  expect(getCourseReadiness(contents)).toMatchObject({ leafCount: 4, readyLeafCount: 2, incompleteLeafCount: 2, findings: [{ contentId: 'video', code: 'empty-content' }, { contentId: 'unsafe', code: 'invalid-source' }] })
})

it('uses logical legacy quizzes and fails closed for malformed or incomplete quiz content', () => {
  const contents = [lesson('valid', { content: JSON.stringify(quiz) }), lesson('empty', { type: 'QUIZ', content: { questions: [] } }), lesson('malformed', { content: '{"questions": broken' }), lesson('invalid', { type: 'QUIZ', content: { ...quiz, passingScore: Number.NaN } })]
  const state = getCourseReadiness(contents)
  expect(state).toMatchObject({ quizCount: 4, readyLeafCount: 1, incompleteLeafCount: 3, ready: false })
  expect(state.findings.map(item => [item.id, item.code])).toEqual([['empty:invalid-quiz', 'invalid-quiz'], ['malformed:invalid-quiz', 'invalid-quiz'], ['invalid:invalid-quiz', 'invalid-quiz']])
})

it('distinguishes a quiz container from a completable leaf quiz', () => {
  const state = getCourseReadiness([lesson('quiz-parent', { type: 'QUIZ', content: quiz, subContents: [lesson('child', { parentId: 'quiz-parent' })] })])
  expect(state).toMatchObject({ leafCount: 1, quizCount: 1, readyLeafCount: 1, ready: false, findings: [{ code: 'quiz-with-children', severity: 'note', contentId: 'quiz-parent' }] })
})

it('reports missing draft titles without double-counting incomplete lessons', () => {
  const state = getCourseReadiness([lesson('blank', { title: ' ', content: '' })])
  expect(state.incompleteLeafCount).toBe(1)
  expect(state.findings.map(item => item.code)).toEqual(['missing-title', 'empty-content'])
})

it('overlays only editable draft fields and deeply isolates preview from both saved data and draft objects', () => {
  const saved = [lesson('chapter', { subContents: [lesson('quiz', { type: 'QUIZ', content: quiz, parentId: 'chapter' })] })]
  const original = JSON.stringify(saved)
  const draft = lesson('quiz', { title: 'Lokaler Titel', type: 'QUIZ', content: { ...quiz, passingScore: Number.NaN }, parentId: 'foreign', order: 999, subContents: [lesson('injected')] })
  const tree = deriveInstructorPreviewTree(saved, draft)
  const preview = tree[0].subContents![0]
  expect(preview).toMatchObject({ title: 'Lokaler Titel', order: 1, parentId: 'chapter' })
  expect(preview.subContents).toBeUndefined()
  expect((preview.content as QuizContent).passingScore).toBeNaN()
  ;(preview.content as QuizContent).questions[0].question = 'Nur Vorschau'
  expect(JSON.stringify(saved)).toBe(original)
  expect((draft.content as QuizContent).questions[0].question).toBe('Welche Antwort?')
})

it('ignores an unrelated or cross-course draft and still clones the saved tree', () => {
  const saved = [lesson('one')]
  for (const draft of [lesson('other', { title: 'Fremd' }), lesson('one', { courseId: 'foreign', title: 'Fremd' })]) {
    const result = deriveInstructorPreviewTree(saved, draft)
    expect(result).toEqual(saved)
    expect(result[0]).not.toBe(saved[0])
  }
})
