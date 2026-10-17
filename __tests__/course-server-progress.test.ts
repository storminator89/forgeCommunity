/** @jest-environment node */
import { GET as readContents } from '@/app/api/courses/[courseId]/contents/route'
import { GET as readProgress, PATCH as markProgress } from '@/app/api/courses/[courseId]/progress/route'
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route'
import { DELETE as deleteCourse } from '@/app/api/courses/[courseId]/route'
import { contentVersionToken, courseContentRevision, gradeQuiz, publicQuiz } from '@/lib/server/course-progress'
import { parseQuizContent } from '@/app/courses/[courseId]/contents/types'
import prisma from '@/lib/prisma'
import { getServerSession } from '@/lib/sites-auth/server'

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) { return new MockNextResponse(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } }) }
  }
  return { NextResponse: MockNextResponse }
})
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  course: { findUnique: jest.fn(), delete: jest.fn() },
  enrollment: { findUnique: jest.fn(), updateMany: jest.fn() },
  certificate: { findFirst: jest.fn() },
  courseContent: { findMany: jest.fn(), findUnique: jest.fn() },
  coursePublication: { findUnique: jest.fn() },
  courseContentProgress: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  courseCompletionRecord: { upsert: jest.fn() },
  quizAttempt: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
} }))
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/server/rewards', () => ({ reconcileLearnerCourseReward: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>
const params = { params: Promise.resolve({ courseId: 'course' }) }
const attemptParams = { params: Promise.resolve({ courseId: 'course', contentId: 'quiz' }) }
const quiz = JSON.stringify({ passingScore: 70, questions: [
  { id: 'choice', type: 'SINGLE_CHOICE', question: 'Frage?', options: ['A', 'B'], correctAnswers: [1], explanation: 'Never expose' },
  { id: 'text', type: 'TEXT_INPUT', question: 'Freitext?', correctAnswer: 'Secret' },
  { id: 'match', type: 'MATCHING', question: 'Ordne zu?', pairs: [{ left: 'A', right: 'Hidden' }] },
  { id: 'blank', type: 'FILL_BLANKS', question: 'Lücke?', text: '[blank]', answers: ['Hidden'] },
] })
const updatedAt = new Date('2026-10-01T12:00:00.000Z')
const content = { id: 'quiz', courseId: 'course', parentId: null, title: 'Quiz', type: 'TEXT', content: quiz, order: 1, updatedAt, children: [] }
const publicationId = 'publication-123'
function versionFields(row: typeof content, id = publicationId) {
  return { publicationId: id, contentVersionToken: contentVersionToken(id, row) }
}
function setPublishedContents(rows: typeof content[]) {
  db.courseContent.findMany.mockResolvedValue(rows)
  db.coursePublication.findUnique.mockResolvedValue({ courseId: 'course', payload: JSON.stringify({ schemaVersion: 1,
    contents: rows.map(({ id, parentId, order, title }) => ({ id, parentId, order, title, prerequisiteIds: [] })) }) })
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-only-publication-token-secret'
  jest.clearAllMocks()
  ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'learner', role: 'USER' } })
  db.course.findUnique.mockResolvedValue({ instructorId: 'editor', activePublicationId: publicationId })
  db.enrollment.findUnique.mockResolvedValue({ id: 'enrollment' })
  setPublishedContents([content])
  db.courseContent.findUnique.mockResolvedValue(content)
  db.courseContentProgress.findMany.mockResolvedValue([])
  db.certificate.findFirst.mockResolvedValue(null)
  db.quizAttempt.findUnique.mockResolvedValue(null)
  db.quizAttempt.findMany.mockResolvedValue([])
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))
})

test('redacts every quiz answer and explanation for enrolled learners but preserves editor data', async () => {
  const learnerResponse = await readContents(new Request('http://localhost/api/courses/course/contents') as never, params)
  expect(learnerResponse.status).toBe(200)
  const learner = (await learnerResponse.json())[0]
  expect(learner.type).toBe('QUIZ')
  expect(JSON.stringify(learner)).not.toMatch(/correctAnswer|Secret|Hidden|Never expose/)
  expect(JSON.parse(learner.content).questions[3].blankCount).toBe(1)
  ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'editor', role: 'INSTRUCTOR' } })
  const editorResponse = await readContents(new Request('http://localhost/api/courses/course/contents') as never, params)
  expect(JSON.stringify(await editorResponse.json())).toContain('Secret')
})

test('does not disclose lessons, progress or grading to a non-enrolled user', async () => {
  db.enrollment.findUnique.mockResolvedValue(null)
  const lessons = await readContents(new Request('http://localhost/api/courses/course/contents') as never, params)
  const progress = await readProgress(new Request('http://localhost/api/courses/course/progress') as never, params)
  const grading = await submitQuiz(new Request('http://localhost/api/courses/course/contents/quiz/attempts', { method: 'POST', body: JSON.stringify({ submissionId: 'attempt_123', ...versionFields(content), answers: {} }) }) as never, attemptParams)
  expect(lessons.status).toBe(403)
  expect(progress.status).toBe(403)
  expect(grading.status).toBe(403)
  expect(db.quizAttempt.create).not.toHaveBeenCalled()
})

test('fails closed for malformed legacy quiz JSON rather than leaking keys or allowing self-attestation', async () => {
  const malformed = { ...content, content: JSON.stringify({ questions: [{ id: 'bad', type: 'TEXT_INPUT', question: 'Secret?', correctAnswer: 123, explanation: 'Hidden' }] }) }
  setPublishedContents([malformed])
  db.courseContent.findUnique.mockResolvedValue(malformed)
  const response = await readContents(new Request('http://localhost/api/courses/course/contents') as never, params)
  const learner = (await response.json())[0]
  expect(learner.type).toBe('QUIZ')
  expect(JSON.stringify(learner)).not.toMatch(/correctAnswer|Secret|Hidden/)
  const marking = await markProgress(new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'quiz', completed: true, ...versionFields(malformed) }) }) as never, params)
  expect(marking.status).toBe(409)
})

test('fails closed for explicitly typed quizzes even when their JSON cannot be parsed', async () => {
  const malformed = { ...content, type: 'QUIZ', content: '{broken correctAnswer: Secret' }
  setPublishedContents([malformed])
  db.courseContent.findUnique.mockResolvedValue(malformed)
  const response = await readContents(new Request('http://localhost/api/courses/course/contents') as never, params)
  const learner = (await response.json())[0]
  expect(learner.type).toBe('QUIZ')
  expect(JSON.stringify(learner)).not.toMatch(/correctAnswer|Secret/)
  const marking = await markProgress(new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'quiz', completed: true, ...versionFields(malformed) }) }) as never, params)
  expect(marking.status).toBe(409)
  expect(db.courseContentProgress.upsert).not.toHaveBeenCalled()
})

test('fails closed for unparseable legacy TEXT quiz JSON with a questions key', async () => {
  const malformed = { ...content, content: '{"questions":[{"correctAnswer":"Secret"}' }
  setPublishedContents([malformed])
  db.courseContent.findUnique.mockResolvedValue(malformed)
  const response = await readContents(new Request('http://localhost/api/courses/course/contents') as never, params)
  expect(JSON.stringify(await response.json())).not.toMatch(/correctAnswer|Secret/)
  const marking = await markProgress(new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'quiz', completed: true, ...versionFields(malformed) }) }) as never, params)
  expect(marking.status).toBe(409)
})

test('grades all six answer types only on the server and rejects invalid answers', () => {
  const parsed = parseQuizContent(JSON.stringify({ questions: [
    ...JSON.parse(quiz).questions,
    { id: 'tf', type: 'TRUE_FALSE', question: 'Wahr?', options: ['Wahr', 'Falsch'], correctAnswers: [0] },
    { id: 'multi', type: 'MULTIPLE_CHOICE', question: 'Mehr?', options: ['A', 'B'], correctAnswers: [0, 1] },
  ] }))!
  const redacted = publicQuiz(parsed)
  expect(JSON.stringify(redacted)).not.toMatch(/correctAnswer|Secret|Hidden|Never expose/)
  expect(gradeQuiz(parsed, { choice: [1], text: ' secret ', match: ['hidden'], blank: [' hidden '], tf: [0], multi: [0, 1] })).toEqual({ score: 100, passed: true })
  expect(() => gradeQuiz(parsed, { choice: [2], text: 'Secret', match: ['Hidden'], blank: ['Hidden'], tf: [0], multi: [0, 1] })).toThrow()
})

test('tracks only current-revision leaf progress and rejects self-attesting a quiz', async () => {
  const oldRevision = 'old'
  db.courseContentProgress.findMany.mockResolvedValue([{ contentId: 'quiz', revision: oldRevision }])
  const before = await readProgress(new Request('http://localhost/api/courses/course/progress') as never, params)
  expect(await before.json()).toMatchObject({ complete: false, completedContentIds: [] })
  const quizMark = await markProgress(new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'quiz', completed: true, ...versionFields(content) }) }) as never, params)
  expect(quizMark.status).toBe(409)
  expect(db.courseContentProgress.upsert).not.toHaveBeenCalled()
  const lesson = { ...content, id: 'lesson', type: 'TEXT', content: '<p>Lesson</p>' }
  db.courseContent.findUnique.mockResolvedValue(lesson)
  setPublishedContents([lesson])
  db.courseContentProgress.findMany.mockResolvedValue([{ contentId: 'lesson', revision: courseContentRevision(lesson) }])
  const stale = await markProgress(new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'lesson', completed: true, ...versionFields(lesson, 'old-publication-123') }) }) as never, params)
  expect(stale.status).toBe(412)
  expect(db.courseContentProgress.upsert).not.toHaveBeenCalled()
  const marked = await markProgress(new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'lesson', completed: true, ...versionFields(lesson) }) }) as never, params)
  expect(marked.status).toBe(200)
  expect(await marked.json()).toMatchObject({ complete: true, completedContentIds: ['lesson'] })
  expect(db.enrollment.updateMany).toHaveBeenCalledTimes(1)
})

test('repeating a completed leaf request leaves the saved revision untouched', async () => {
  const lesson = { ...content, id: 'lesson', type: 'TEXT', content: '<p>Lesson</p>' }
  const revision = courseContentRevision(lesson)
  db.courseContent.findUnique.mockResolvedValue(lesson)
  setPublishedContents([lesson])
  db.courseContentProgress.findUnique.mockResolvedValue({ revision })
  db.courseContentProgress.findMany.mockResolvedValue([{ contentId: 'lesson', revision }])
  for (let index = 0; index < 2; index++) {
    const response = await markProgress(new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'lesson', completed: true, ...versionFields(lesson) }) }) as never, params)
    expect(response.status).toBe(200)
  }
  expect(db.courseContentProgress.upsert).not.toHaveBeenCalled()
  expect(db.enrollment.updateMany).toHaveBeenCalledTimes(2)
})

test('saves the verified first completion as a private snapshot without rewriting its course title', async () => {
  const lesson = { ...content, id: 'lesson', type: 'TEXT', content: '<p>Lesson</p>' }
  const revision = courseContentRevision(lesson)
  const firstCompletedAt = new Date('2026-10-01T13:00:00Z')
  db.courseContent.findUnique.mockResolvedValue(lesson)
  setPublishedContents([lesson])
  db.courseContentProgress.findMany.mockResolvedValue([{ contentId: 'lesson', revision }])
  db.enrollment.findUnique.mockResolvedValue({ id: 'enrollment', completedAt: firstCompletedAt })
  db.course.findUnique.mockResolvedValue({ instructorId: 'editor', title: 'Original course title', activePublicationId: publicationId })
  const request = () => new Request('http://localhost/api/courses/course/progress', { method: 'PATCH', body: JSON.stringify({ contentId: 'lesson', completed: true, ...versionFields(lesson) }) }) as never
  expect((await markProgress(request(), params)).status).toBe(200)
  expect(db.courseCompletionRecord.upsert).toHaveBeenCalledWith({
    where: { userId_courseId: { userId: 'learner', courseId: 'course' } },
    create: { userId: 'learner', courseId: 'course', courseTitle: 'Original course title', completedAt: firstCompletedAt },
    update: { completedAt: firstCompletedAt },
  })
  db.course.findUnique.mockResolvedValue({ instructorId: 'editor', title: 'Later title', activePublicationId: publicationId })
  expect((await markProgress(request(), params)).status).toBe(200)
  expect(db.courseCompletionRecord.upsert).toHaveBeenCalledTimes(2)
  expect(db.courseCompletionRecord.upsert.mock.calls[1][0].update).toEqual({ completedAt: firstCompletedAt })
})

test('submitting and retrying one quiz attempt returns a stable result without counting twice', async () => {
  const answer = { choice: [1], text: 'Secret', match: ['Hidden'], blank: ['Hidden'] }
  const request = () => new Request('http://localhost/api/courses/course/contents/quiz/attempts', { method: 'POST', body: JSON.stringify({ submissionId: 'attempt_123', ...versionFields(content), answers: answer }) }) as never
  const first = await submitQuiz(request(), attemptParams)
  expect(first.status).toBe(200)
  expect(await first.json()).toEqual({ score: 100, passed: true })
  expect(db.quizAttempt.create).toHaveBeenCalledTimes(1)
  const created = db.quizAttempt.create.mock.calls[0][0].data
  db.quizAttempt.findUnique.mockResolvedValue({ ...created, submittedAt: updatedAt })
  const second = await submitQuiz(request(), attemptParams)
  expect(second.status).toBe(200)
  expect(await second.json()).toEqual({ score: 100, passed: true })
  expect(db.quizAttempt.create).toHaveBeenCalledTimes(1)
})

test('rate-limits repeated failed guesses without disclosing the answer key', async () => {
  db.quizAttempt.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ submittedAt: new Date() })))
  const response = await submitQuiz(new Request('http://localhost/api/courses/course/contents/quiz/attempts', { method: 'POST', body: JSON.stringify({ submissionId: 'attempt_123', ...versionFields(content), answers: { choice: [0], text: 'guess', match: ['guess'], blank: ['guess'] } }) }) as never, attemptParams)
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBeTruthy()
  expect(JSON.stringify(await response.json())).not.toMatch(/correctAnswer|Secret|Hidden/)
  expect(db.quizAttempt.create).not.toHaveBeenCalled()
})

test('preserves issued certificates by rejecting direct course deletion', async () => {
  ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'editor', role: 'INSTRUCTOR' } })
  db.certificate.findFirst.mockResolvedValue({ id: 'issued' })
  const response = await deleteCourse(new Request('http://localhost/api/courses/course', { method: 'DELETE' }) as never, params)
  expect(response.status).toBe(409)
  expect(db.course.delete).not.toHaveBeenCalled()
})
