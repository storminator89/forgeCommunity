/** @jest-environment node */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import prisma from '@/lib/prisma'
import { getServerSession } from '@/lib/sites-auth/server'
import { getServerSession as getSearchSession } from '@/lib/sites-auth/server'
import { GET as listQuestionsHttp, POST as askHttp } from '@/app/api/courses/[courseId]/qa/route'
import { GET as readQuestionHttp, PATCH as hideQuestionHttp } from '@/app/api/courses/[courseId]/qa/[questionId]/route'
import { POST as revalidateHttp } from '@/app/api/courses/[courseId]/qa/revalidate/route'
import { GET as searchHttp } from '@/app/api/search/route'
import { createCourseAnswer, createCourseQuestion, hideCourseAnswer, hideCourseQuestion,
  listCourseQuestions, readCourseQuestion, revalidateCourseQuestionIds, selectCourseAnswer } from '@/lib/server/course-qa'

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value),
    { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }) }
} }))
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))
// The DB suite tests authorization and storage. The sanitizer itself has separate security tests;
// current Jest cannot require jsdom's transitive ESM dependency in the Node environment.
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  sanitizeHtmlPreviewServer: (value: string) => value.replace(/<[^>]*>/g, '').trim(),
}))

jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const { DatabaseSync } = require('node:sqlite')
  const { PrismaClient } = jest.requireActual(process.env.QA_CLIENT_PATH || '@prisma/client')
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3')
  const directory = mkdtempSync(join(tmpdir(), 'forge-course-qa-api-'))
  const path = join(directory, 'test.db')
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'))
    }
  } finally { db.close() }
  return { __esModule: true, __directory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) }
})

const instructor = { id: 'qa-teacher', role: 'INSTRUCTOR' as const }
const learner = { id: 'qa-learner', role: 'USER' as const }
const peer = { id: 'qa-peer', role: 'USER' as const }
const outsider = { id: 'qa-outsider', role: 'USER' as const }
const admin = { id: 'qa-admin', role: 'ADMIN' as const }
const staleAdmin = { id: 'qa-stale-admin', role: 'ADMIN' as const }
const replacement = { id: 'qa-replacement', role: 'INSTRUCTOR' as const }
const capLearner = { id: 'qa-cap-learner', role: 'USER' as const }
const courseId = 'qa-course'
const otherCourseId = 'qa-other-course'
const draftCourseId = 'qa-draft-course'
const params = (filter = 'all') => new URLSearchParams({ filter })
const fail = (operation: () => Promise<unknown>, status: number) => expect(operation()).rejects.toMatchObject({ status })
// CI sets NEXTAUTH_URL to :3013. Keep the synthetic request and its browser
// Origin aligned with the deployment URL so the production CSRF gate stays real.
const appOrigin = new URL(process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost').origin
function setSession(actor: { id: string; role: string } | null) {
  jest.mocked(getServerSession).mockResolvedValue(actor ? { user: actor } as never : null)
}
function request(path = '', method = 'GET', body?: object, origin?: string) {
  const url = new URL(`/api/courses/${courseId}/qa${path}`, appOrigin)
  return Object.assign(new Request(url, { method, headers: {
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) }), { nextUrl: url }) as never
}

beforeAll(async () => {
  process.env.DATABASE_PROVIDER = 'sqlite'
  await prisma.user.createMany({ data: [instructor, learner, peer, outsider, admin, replacement, capLearner,
    { id: staleAdmin.id, role: 'USER' as const }].map(user => ({ ...user, email: `${user.id}@example.invalid` })) })
  await prisma.course.createMany({ data: [
    { id: courseId, title: 'Q&A', description: '', instructorId: instructor.id },
    { id: otherCourseId, title: 'Other', description: '', instructorId: instructor.id },
    { id: draftCourseId, title: 'Private draft', description: '', instructorId: instructor.id },
  ] })
  for (const id of [courseId, otherCourseId]) {
    const publication = await prisma.coursePublication.create({ data: {
      id: `pub-${id}`, courseId: id, sequence: 1, source: 'AUTHOR', payload: '{}', digest: 'digest', contentCount: 0,
    } })
    await prisma.course.update({ where: { id }, data: { activePublicationId: publication.id } })
  }
  await prisma.enrollment.createMany({ data: [
    { courseId, userId: learner.id }, { courseId, userId: peer.id },
    { courseId, userId: capLearner.id },
    { courseId: otherCourseId, userId: learner.id }, { courseId: draftCourseId, userId: learner.id },
  ] })
})
afterAll(async () => {
  await prisma.$disconnect()
  rmSync((jest.requireMock('@/lib/prisma') as { __directory: string }).__directory, { recursive: true, force: true })
})

test('course-only Q&A is private, sanitized and idempotent', async () => {
  await fail(() => listCourseQuestions(courseId, outsider, params()), 403)
  await fail(() => listCourseQuestions(courseId, staleAdmin, params()), 403)
  await fail(() => listCourseQuestions(draftCourseId, learner, params()), 404)
  await fail(() => createCourseQuestion(draftCourseId, learner, { title: 'Draft question', body: 'What is here?', requestId: 'draft-req-01' }), 404)
  const input = { title: '<b>Prüfungsfrage</b>', body: 'Wie <img src=x onerror=alert(1)> funktioniert das?', requestId: 'question-req-01' }
  const first = await createCourseQuestion(courseId, learner, input)
  expect(first.created).toBe(true)
  expect(first.question.title).toBe('Prüfungsfrage')
  expect(first.question.body).not.toMatch(/<|onerror/)
  const again = await createCourseQuestion(courseId, learner, input)
  expect(again.question.id).toBe(first.question.id)
  expect(again.created).toBe(false)
  await fail(() => createCourseQuestion(courseId, learner, { ...input, body: 'A different question altogether.' }), 409)
  expect((await listCourseQuestions(courseId, learner, params())).items.map(row => row.id)).toContain(first.question.id)
  await fail(() => readCourseQuestion(otherCourseId, first.question.id, learner), 404)
  await fail(() => readCourseQuestion(courseId, first.question.id, outsider), 403)
  await fail(() => listCourseQuestions(courseId, learner, params('hidden')), 403)
  expect((await listCourseQuestions(otherCourseId, learner, params())).items.map(row => row.id)).not.toContain(first.question.id)
  expect(await prisma.post.count()).toBe(0)
  expect(await prisma.comment.count()).toBe(0)
  jest.mocked(getSearchSession).mockResolvedValue({ user: learner } as never)
  const searchUrl = new URL('http://localhost/api/search?query=Pr%C3%BCfungsfrage&type=post')
  const search = await searchHttp(Object.assign(new Request(searchUrl), { nextUrl: searchUrl }) as never)
  expect(search.status).toBe(200)
  expect((await search.json()).results).toEqual([])
})

test('HTTP Q&A gates anonymous, outsider, cross-origin and cross-course requests', async () => {
  const context = { params: Promise.resolve({ courseId }) }
  setSession(null)
  const anonymous = await listQuestionsHttp(request(), context)
  expect(anonymous.status).toBe(401)
  expect(anonymous.headers.get('cache-control')).toBe('private, no-store')
  setSession(outsider)
  const denied = await listQuestionsHttp(request(), context)
  expect(denied.status).toBe(403)
  expect(await denied.text()).not.toContain('Prüfungsfrage')
  setSession(learner)
  const list = await listQuestionsHttp(request(), context)
  expect(list.status).toBe(200)
  expect(list.headers.get('cache-control')).toBe('private, no-store')
  const questionId = (await list.json()).items[0].id as string
  const detailContext = { params: Promise.resolve({ courseId, questionId }) }
  const foreignContext = { params: Promise.resolve({ courseId: otherCourseId, questionId }) }
  expect((await readQuestionHttp(request(`/${questionId}`), foreignContext)).status).toBe(404)
  expect((await hideQuestionHttp(request(`/${questionId}`, 'PATCH', { hidden: true }), detailContext)).status).toBe(403)
  const input = { title: 'Eine Kursfrage', body: 'Wie funktioniert diese Kursfrage?', requestId: 'http-question-01' }
  expect((await askHttp(request('', 'POST', input, 'https://evil.invalid'), context)).status).toBe(403)
  expect((await prisma.courseQuestion.count({ where: { requestId: input.requestId } }))).toBe(0)
  expect((await askHttp(request('', 'POST', input, appOrigin), context)).status).toBe(201)
  expect((await askHttp(request('', 'POST', input, appOrigin), context)).status).toBe(200)
})

test('answers, selected solution and hide states stay in the right course', async () => {
  const q = (await createCourseQuestion(courseId, learner,
    { title: 'Antwort auswählen', body: 'Wie geht das eigentlich?', requestId: 'question-req-02' })).question
  const other = (await createCourseQuestion(otherCourseId, learner,
    { title: 'Ein anderer Kurs', body: 'Andere Kursfrage?', requestId: 'question-req-03' })).question
  await fail(() => createCourseAnswer(courseId, q.id, outsider, { body: 'No access', requestId: 'answer-req-01' }), 403)
  const answer = (await createCourseAnswer(courseId, q.id, peer,
    { body: 'Eine Antwort.', requestId: 'answer-req-02' })).answer
  const repeat = await createCourseAnswer(courseId, q.id, peer,
    { body: 'Eine Antwort.', requestId: 'answer-req-02' })
  expect(repeat.created).toBe(false)
  expect(repeat.answer.id).toBe(answer.id)
  await fail(() => createCourseAnswer(courseId, q.id, peer,
    { body: 'Another answer', requestId: 'answer-req-02' }), 409)
  const cross = (await createCourseAnswer(otherCourseId, other.id, learner,
    { body: 'Andere Antwort.', requestId: 'answer-req-03' })).answer
  await fail(() => createCourseAnswer(courseId, other.id, peer, { body: 'Falscher Kurs.', requestId: 'answer-req-foreign' }), 404)
  await fail(() => hideCourseQuestion(courseId, other.id, instructor, true), 404)
  await fail(() => hideCourseAnswer(courseId, q.id, cross.id, instructor, true), 404)
  await fail(() => selectCourseAnswer(courseId, q.id, learner, { answerId: answer.id, expectedRevision: null }), 403)
  await fail(() => selectCourseAnswer(courseId, q.id, instructor, { answerId: cross.id, expectedRevision: null }), 404)
  const selected = await selectCourseAnswer(courseId, q.id, instructor, { answerId: answer.id, expectedRevision: null })
  expect(selected.acceptedAnswerId).toBe(answer.id)
  expect(selected.revision).toEqual(expect.any(String))
  expect((await listCourseQuestions(courseId, learner, params('answered'))).items.map(row => row.id)).toContain(q.id)
  await fail(() => selectCourseAnswer(courseId, q.id, instructor, { answerId: null, expectedRevision: null }), 409)
  const cleared = await selectCourseAnswer(courseId, q.id, admin, { answerId: null, expectedRevision: selected.revision })
  expect(cleared.acceptedAnswerId).toBeNull()
  expect(cleared.revision).toEqual(expect.any(String))
  expect(cleared.revision).not.toBe(selected.revision)
  await fail(() => selectCourseAnswer(courseId, q.id, instructor, { answerId: answer.id, expectedRevision: null }), 409)
  const alternative = (await createCourseAnswer(courseId, q.id, peer,
    { body: 'Eine andere Antwort.', requestId: 'answer-req-04' })).answer
  const races = await Promise.allSettled([
    selectCourseAnswer(courseId, q.id, instructor, { answerId: answer.id, expectedRevision: cleared.revision }),
    selectCourseAnswer(courseId, q.id, admin, { answerId: alternative.id, expectedRevision: cleared.revision }),
  ])
  expect(races.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(races.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect((races.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 })
  const current = (await readCourseQuestion(courseId, q.id, instructor)).question
  expect([answer.id, alternative.id]).toContain(current.acceptedAnswerId)
  const reset = await selectCourseAnswer(courseId, q.id, instructor, { answerId: null, expectedRevision: current.revision })
  const selectedAgain = await selectCourseAnswer(courseId, q.id, instructor, { answerId: answer.id, expectedRevision: reset.revision })
  await fail(() => hideCourseAnswer(courseId, q.id, answer.id, learner, true), 403)
  await hideCourseAnswer(courseId, q.id, answer.id, instructor, true)
  expect((await readCourseQuestion(courseId, q.id, learner)).answers.some(row => row.id === answer.id)).toBe(false)
  expect((await readCourseQuestion(courseId, q.id, instructor)).question.acceptedAnswerId).toBeNull()
  expect((await readCourseQuestion(courseId, q.id, instructor)).question.revision).not.toBe(selectedAgain.revision)
  await fail(() => selectCourseAnswer(courseId, q.id, instructor, { answerId: answer.id, expectedRevision: null }), 404)
  await fail(() => createCourseAnswer(courseId, q.id, peer,
    { body: 'Eine Antwort.', requestId: 'answer-req-02' }), 404)
  await hideCourseAnswer(courseId, q.id, answer.id, instructor, false)
  await hideCourseQuestion(courseId, q.id, instructor, true)
  await fail(() => readCourseQuestion(courseId, q.id, peer), 404)
  await fail(() => createCourseAnswer(courseId, q.id, peer,
    { body: 'Eine neue Antwort.', requestId: 'answer-req-06' }), 404)
  expect((await listCourseQuestions(courseId, instructor, params('hidden'))).items.map(row => row.id)).toContain(q.id)
  await hideCourseQuestion(courseId, q.id, instructor, false)
  expect((await readCourseQuestion(courseId, q.id, peer)).question.id).toBe(q.id)
})

test('cursor scope, pagination and per-learner daily cap are enforced', async () => {
  for (let index = 0; index < 10; index++) {
    const created = await createCourseQuestion(courseId, capLearner,
      { title: `Frage Nummer ${index}`, body: `Was geschieht mit Frage Nummer ${index}?`, requestId: `cap-question-${index}` })
    expect(created.created).toBe(true)
  }
  await fail(() => createCourseQuestion(courseId, capLearner,
    { title: 'Noch eine Frage', body: 'Darf ich eine weitere Frage stellen?', requestId: 'cap-question-10' }), 429)
  await prisma.courseQuestion.createMany({ data: Array.from({ length: 11 }, (_, index) => ({
    id: `qa-page-${index}`, courseId, authorId: peer.id, requestId: `page-question-${index}`,
    title: `Pagination ${index}`, body: `Question body ${index}`,
  })) })
  const first = await listCourseQuestions(courseId, peer, params())
  expect(first.items).toHaveLength(20)
  expect(first.nextCursor).toEqual(expect.any(String))
  const nextParams = new URLSearchParams({ cursor: first.nextCursor as string })
  const second = await listCourseQuestions(courseId, peer, nextParams)
  expect(second.items.length).toBeGreaterThan(0)
  expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(first.items.length + second.items.length)
  await fail(() => listCourseQuestions(otherCourseId, learner, nextParams), 400)
  await fail(() => listCourseQuestions(courseId, peer, new URLSearchParams({ filter: 'open', cursor: first.nextCursor as string })), 400)
  await fail(() => listCourseQuestions(courseId, peer, new URLSearchParams({ cursor: 'broken' })), 400)
})

test('learner replies are bounded daily without removing hidden moderation evidence', async () => {
  const question = await prisma.courseQuestion.findFirstOrThrow({ where: { courseId, title: 'Antwort auswählen' } })
  for (let index = 0; index < 10; index++) {
    const created = await createCourseAnswer(courseId, question.id, capLearner,
      { body: `Eigene Antwort Nummer ${index}.`, requestId: `cap-answer-${index}` })
    expect(created.created).toBe(true)
  }
  await fail(() => createCourseAnswer(courseId, question.id, capLearner,
    { body: 'Noch eine Antwort.', requestId: 'cap-answer-10' }), 429)
  expect(await prisma.courseAnswer.count({ where: { questionId: question.id, authorId: capLearner.id } })).toBe(10)
})

test('the 100-answer thread limit preserves hidden evidence and returns a clear full-thread state', async () => {
  const question = await prisma.courseQuestion.create({ data: {
    courseId, authorId: peer.id, requestId: 'full-thread-question', title: 'Volle Frage', body: 'Wie viele Antworten passen hier?',
  } })
  await prisma.courseAnswer.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
    questionId: question.id, authorId: instructor.id, requestId: `full-thread-answer-${index}`, body: `Antwort ${index}`,
  })) })
  await hideCourseAnswer(courseId, question.id, (await prisma.courseAnswer.findFirstOrThrow({ where: {
    questionId: question.id, requestId: 'full-thread-answer-0',
  } })).id, instructor, true)
  await expect(createCourseAnswer(courseId, question.id, peer,
    { body: 'Eine weitere Antwort.', requestId: 'full-thread-peer-reply' })).rejects.toMatchObject({
    status: 409, message: 'Diese Frage hat das Limit von 100 Antworten erreicht.',
  })
  expect(await prisma.courseAnswer.count({ where: { questionId: question.id } })).toBe(100)
  expect((await readCourseQuestion(courseId, question.id, peer)).answers).toHaveLength(99)
})

test('visibility batches re-authorize and remove hidden or foreign questions without disclosing bodies', async () => {
  const question = await prisma.courseQuestion.create({ data: {
    courseId, authorId: peer.id, requestId: 'visibility-question', title: 'Sichtbare Frage', body: 'Private visibility probe body',
  } })
  const foreign = await prisma.courseQuestion.create({ data: {
    courseId: otherCourseId, authorId: learner.id, requestId: 'foreign-visibility', title: 'Fremde Frage', body: 'Another course body',
  } })
  const input = { ids: [question.id, foreign.id], filter: 'all' }
  const visible = await revalidateCourseQuestionIds(courseId, learner, input)
  expect(visible.visibleIds).toEqual([question.id])
  expect(visible).not.toHaveProperty('items')
  await fail(() => revalidateCourseQuestionIds(courseId, outsider, input), 403)
  await fail(() => revalidateCourseQuestionIds(courseId, learner, { ...input, ids: [question.id, question.id] }), 400)
  await fail(() => revalidateCourseQuestionIds(courseId, learner, { ...input, ids: ['../other'] }), 400)
  await fail(() => revalidateCourseQuestionIds(courseId, learner, { ...input,
    ids: Array.from({ length: 201 }, (_, index) => `question-${index}`) }), 400)
  const context = { params: Promise.resolve({ courseId }) }
  setSession(null)
  expect((await revalidateHttp(request('/revalidate', 'POST', input), context)).status).toBe(401)
  setSession(learner)
  expect((await revalidateHttp(request('/revalidate', 'POST', input, 'https://evil.invalid'), context)).status).toBe(403)
  const http = await revalidateHttp(request('/revalidate', 'POST', input, appOrigin), context)
  expect(http.status).toBe(200)
  expect(http.headers.get('cache-control')).toBe('private, no-store')
  expect(await http.json()).toMatchObject({ visibleIds: [question.id], canModerate: false })
  await hideCourseQuestion(courseId, question.id, instructor, true)
  expect((await revalidateCourseQuestionIds(courseId, learner, input)).visibleIds).toEqual([])
  expect((await revalidateCourseQuestionIds(courseId, instructor, { ...input, filter: 'hidden' })).visibleIds).toEqual([question.id])
  expect((await revalidateCourseQuestionIds(courseId, learner, { ...input, filter: 'hidden' })).visibleIds).toEqual([])
})

test('withdrawal, unpublish and instructor reassignment are rechecked at every access', async () => {
  const q = (await createCourseQuestion(courseId, learner,
    { title: 'Berechtigung prüfen', body: 'Zugriff nach Rückzug?', requestId: 'question-req-04' })).question
  await prisma.enrollment.delete({ where: { userId_courseId: { userId: learner.id, courseId } } })
  await fail(() => readCourseQuestion(courseId, q.id, learner), 403)
  await fail(() => createCourseAnswer(courseId, q.id, learner, { body: 'Nein', requestId: 'answer-req-04' }), 403)
  await prisma.course.update({ where: { id: courseId }, data: { instructorId: replacement.id } })
  await fail(() => readCourseQuestion(courseId, q.id, instructor), 403)
  expect((await readCourseQuestion(courseId, q.id, replacement)).question.id).toBe(q.id)
  const republished = await prisma.coursePublication.create({ data: {
    id: 'pub-qa-course-second', courseId, sequence: 2, source: 'AUTHOR', payload: '{}', digest: 'digest-2', contentCount: 0,
  } })
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: republished.id } })
  expect((await readCourseQuestion(courseId, q.id, peer)).question.id).toBe(q.id)
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: null } })
  await fail(() => readCourseQuestion(courseId, q.id, peer), 404)
  expect((await readCourseQuestion(courseId, q.id, replacement)).question.id).toBe(q.id)
  await fail(() => createCourseAnswer(courseId, q.id, replacement, { body: 'Not published', requestId: 'answer-req-05' }), 404)
})
