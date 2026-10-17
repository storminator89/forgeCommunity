/** @jest-environment node */
import { rmSync } from 'node:fs';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';
import { GET as listHttp, POST as createHttp } from '@/app/api/courses/[courseId]/qa/route';
import { POST as probeHttp } from '@/app/api/courses/[courseId]/qa/revalidate/route';
import { createCourseQuestion, createCourseAnswer, hideCourseQuestion, listCourseQuestions,
  readCourseQuestion, revalidateCourseQuestionIds, selectCourseAnswer } from '@/lib/server/course-qa';
import { courseContentRevision } from '@/lib/server/course-progress';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value),
    { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); }
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  sanitizeHtmlPreviewServer: (value: string) => value.replace(/<[^>]*>/g, '').trim(),
}));
jest.mock('@/lib/server/course-progress', () => {
  const actual = jest.requireActual('@/lib/server/course-progress');
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(actual), completionState: {
    value: jest.fn((...args: unknown[]) => actual.completionState(...args)), enumerable: true, configurable: true, writable: true,
  } });
});
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual(process.env.QA_CLIENT_PATH || '@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-qa-context-backend-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma/sqlite-migrations')).filter((name: string) => name.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma/sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __directory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const learner = { id: 'context-learner', role: 'USER' };
const peer = { id: 'context-peer', role: 'USER' };
const owner = { id: 'context-owner', role: 'INSTRUCTOR' };
const admin = { id: 'context-admin', role: 'ADMIN' };
const staleAdmin = { id: 'context-stale-admin', role: 'ADMIN' };
const outsider = { id: 'context-outsider', role: 'USER' };
type Node = { id: string; parentId: string | null; title: string; order: number; type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ' | 'ASSIGNMENT' | null; content: string; prerequisiteIds?: string[]; releaseOn?: string };
let sequence = 0;
function node(id: string, patch: Partial<Node> = {}): Node { return { id, parentId: null, title: `Private lesson ${id}`, order: 1, type: 'TEXT', content: '<p>Private lesson body</p>', ...patch }; }
async function fixture(nodes?: Node[]) {
  const id = `context-course-${++sequence}`;
  const contents = nodes ?? [node(`context-leaf-${sequence}`)];
  await prisma.course.create({ data: { id, title: 'Context course', description: '', instructorId: owner.id } });
  const publicationId = `${id}-pub-1`;
  await prisma.coursePublication.create({ data: { id: publicationId, courseId: id, sequence: 1, source: 'AUTHOR',
    payload: JSON.stringify({ schemaVersion: 1, contents }), digest: 'test', contentCount: contents.length } });
  for (const content of contents) await prisma.courseContent.create({ data: {
    id: content.id, courseId: id, parentId: content.parentId, title: content.title, order: content.order,
    type: content.type === 'QUIZ' ? 'TEXT' : content.type, content: content.content,
  } });
  await prisma.course.update({ where: { id }, data: { activePublicationId: publicationId } });
  await prisma.enrollment.createMany({ data: [learner, peer, staleAdmin].map(user => ({ courseId: id, userId: user.id })) });
  const pair = { publicationId, contentId: contents[contents.length - 1].id };
  return { id, pair, contents };
}
function input(lessonContext?: unknown, suffix = 'one') { return { title: '<b>Generic question</b>', body: 'How does this work?', requestId: `context-request-${suffix}`, ...(lessonContext !== undefined ? { lessonContext } : {}) }; }
const fail = (work: () => Promise<unknown>, status: number) => expect(work()).rejects.toMatchObject({ status });
const query = (pair?: { publicationId: string; contentId: string }, more = {}) => new URLSearchParams({ ...(pair ?? {}), ...more });
async function republish(f: Awaited<ReturnType<typeof fixture>>, contents = f.contents) {
  const id = `${f.id}-pub-2`;
  await prisma.coursePublication.create({ data: { id, courseId: f.id, sequence: 2, source: 'AUTHOR', previousPublicationId: f.pair.publicationId,
    payload: JSON.stringify({ schemaVersion: 1, contents }), digest: 'new-test', contentCount: contents.length } });
  await prisma.course.update({ where: { id: f.id }, data: { activePublicationId: id } });
  return { publicationId: id, contentId: f.pair.contentId };
}
const origin = new URL(process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost').origin;
function request(courseId: string, method = 'GET', body?: unknown, search = '', givenOrigin = origin) {
  const url = new URL(`/api/courses/${courseId}/qa${search}`, origin);
  return Object.assign(new Request(url, { method, headers: { Origin: givenOrigin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { nextUrl: url }) as never;
}
beforeAll(async () => {
  process.env.DATABASE_PROVIDER = 'sqlite';
  await prisma.user.createMany({ data: [learner, peer, owner, admin, outsider, { ...staleAdmin, role: 'USER' }].map(user => ({
    ...user, role: user.role as 'USER' | 'ADMIN' | 'INSTRUCTOR', email: `${user.id}@example.invalid`,
  })) });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync((jest.requireMock('@/lib/prisma') as { __directory: string }).__directory, { recursive: true, force: true });
});
afterEach(() => jest.restoreAllMocks());

test('current pair persists once and all DTOs expose only the server-built current label/link', async () => {
  const f = await fixture();
  const first = await createCourseQuestion(f.id, learner, input(f.pair));
  expect(first.created).toBe(true);
  const expected = { status: 'current', ...f.pair, title: f.contents[0].title, href: `/courses/${f.id}/contents?content=${f.pair.contentId}` };
  expect(first.question.lessonContext).toEqual(expected);
  const stored = await prisma.courseQuestion.findUniqueOrThrow({ where: { id: first.question.id } });
  expect([stored.contextPublicationId, stored.contextContentId]).toEqual([f.pair.publicationId, f.pair.contentId]);
  expect(stored).not.toHaveProperty('contextTitle');
  const again = await createCourseQuestion(f.id, learner, input(f.pair));
  expect(again).toMatchObject({ created: false, question: { id: first.question.id, lessonContext: expected } });
  const listed = await listCourseQuestions(f.id, learner, query(f.pair));
  expect(listed).toMatchObject({ scope: { kind: 'lesson', lessonContext: expected }, canAsk: true, canAskInScope: true });
  expect(listed.items[0].lessonContext).toEqual(expected);
  expect((await readCourseQuestion(f.id, first.question.id, peer)).question.lessonContext).toEqual(expected);
  expect(JSON.stringify(expected)).not.toContain('body');
});

test('legacy omitted and explicit null replay identically and remain course-wide after republish', async () => {
  const f = await fixture();
  const first = await createCourseQuestion(f.id, learner, input());
  expect(first.question.lessonContext).toBeNull();
  expect((await createCourseQuestion(f.id, learner, input(null))).question.id).toBe(first.question.id);
  await fail(() => createCourseQuestion(f.id, learner, input(f.pair)), 409);
  await republish(f);
  expect((await readCourseQuestion(f.id, first.question.id, learner)).question.lessonContext).toBeNull();
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).items).toEqual([]);
  expect((await listCourseQuestions(f.id, learner, query())).scope).toEqual({ kind: 'course' });
});

test.each([{}, [], 'leaf', { publicationId: 'pub' }, { publicationId: 'pub', contentId: '' },
  { publicationId: 'pub', contentId: 'leaf', title: 'Do not copy' }, { publicationId: 'pub', contentId: 'bad/id' }])('rejects malformed context %j without writing', async lessonContext => {
  const f = await fixture();
  await fail(() => createCourseQuestion(f.id, learner, input(lessonContext)), 400);
  expect(await prisma.courseQuestion.count({ where: { courseId: f.id } })).toBe(0);
});

test('query pairs are exact, duplicate/unsupported/partial parameters fail, and foreign scope is neutral', async () => {
  const f = await fixture();
  for (const raw of ['publicationId=pub', 'contentId=leaf', 'publicationId=&contentId=leaf',
    `publicationId=${f.pair.publicationId}&publicationId=${f.pair.publicationId}&contentId=${f.pair.contentId}`, 'ask=1', 'filter=all&filter=open']) {
    await fail(() => listCourseQuestions(f.id, learner, new URLSearchParams(raw)), 400);
  }
  const foreign = await listCourseQuestions(f.id, learner, query({ publicationId: 'unknown', contentId: 'unknown' }));
  expect(foreign).toMatchObject({ items: [], scope: { kind: 'lesson', lessonContext: { status: 'unavailable' } }, canAskInScope: false });
  await fail(() => listCourseQuestions(f.id, outsider, query(f.pair)), 403);
});

test('new anchors reject historical, absent, cross-course and parent nodes without leaking target details', async () => {
  const first = node('context-parent'); const leaf = node('context-child', { parentId: first.id });
  const f = await fixture([first, leaf]);
  const other = await fixture();
  await fail(() => createCourseQuestion(f.id, learner, input({ ...f.pair, contentId: first.id })), 404);
  await fail(() => createCourseQuestion(f.id, learner, input({ ...f.pair, contentId: 'missing' })), 404);
  await fail(() => createCourseQuestion(f.id, learner, input({ ...f.pair, contentId: other.pair.contentId })), 404);
  await fail(() => createCourseQuestion(f.id, learner, input(other.pair)), 412);
  await republish(f);
  await fail(() => createCourseQuestion(f.id, learner, input(f.pair)), 412);
});

test.each(['TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ', 'ASSIGNMENT', null] as const)('readable %s leaves can carry context without copying lesson material', async type => {
  const f = await fixture([node(`context-kind-${type}`, { type, content: type === 'QUIZ' ? '{"questions":[]}' : 'Private content' })]);
  const created = await createCourseQuestion(f.id, learner, input(f.pair));
  expect(created.question.lessonContext).toMatchObject({ status: 'current', ...f.pair });
  expect(JSON.stringify(created)).not.toContain('Private content');
  expect(JSON.stringify(created)).not.toContain('questions');
});

test('UTC root release and current prerequisites apply to staff labels as well as learner creation', async () => {
  const first = node('context-required');
  const last = node('context-locked', { order: 2, prerequisiteIds: [first.id] });
  const f = await fixture([first, last]);
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).canAskInScope).toBe(false);
  await fail(() => createCourseQuestion(f.id, learner, input(f.pair)), 423);
  expect((await listCourseQuestions(f.id, owner, query(f.pair))).scope).toEqual({ kind: 'lesson', lessonContext: { status: 'unavailable' } });
  expect((await listCourseQuestions(f.id, admin, query(f.pair))).scope).toEqual({ kind: 'lesson', lessonContext: { status: 'unavailable' } });
  await prisma.courseContentProgress.create({ data: { userId: learner.id, courseId: f.id, contentId: first.id, revision: courseContentRevision(first) } });
  expect((await createCourseQuestion(f.id, learner, input(f.pair))).question.lessonContext?.status).toBe('current');
  await prisma.courseContent.update({ where: { id: first.id }, data: { content: 'Changed current revision' } });
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).canAskInScope).toBe(false);
  const dated = await fixture([node('context-release-root', { releaseOn: '2026-10-17' }), node('context-release-child', { parentId: 'context-release-root' })]);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T23:59:59.999Z'));
  await fail(() => createCourseQuestion(dated.id, learner, input(dated.pair)), 423);
  jest.mocked(Date.now).mockReturnValue(Date.parse('2026-10-17T00:00:00.000Z'));
  expect((await createCourseQuestion(dated.id, learner, input(dated.pair))).question.lessonContext?.status).toBe('current');
});

test('retained rows and replay redact after republish without reading historical payload or changing chosen solution', async () => {
  const f = await fixture();
  const receipt = await createCourseQuestion(f.id, learner, input(f.pair));
  const reply = await createCourseAnswer(f.id, receipt.question.id, peer, { body: 'A peer explanation.', requestId: 'context-peer-answer' });
  const solution = await selectCourseAnswer(f.id, receipt.question.id, owner, { answerId: reply.answer.id, expectedRevision: null });
  const currentPair = await republish(f);
  // Invalid historical bytes prove that projection never parses the old payload.
  await prisma.coursePublication.update({ where: { id: f.pair.publicationId }, data: { payload: 'historical-private-bytes-invalid-json' } });
  const replay = await createCourseQuestion(f.id, learner, input(f.pair));
  expect(replay).toMatchObject({ created: false, question: { id: receipt.question.id, lessonContext: { status: 'unavailable' }, acceptedAnswerId: reply.answer.id } });
  for (const changed of [null, currentPair, { ...f.pair, contentId: 'another' }]) await fail(() => createCourseQuestion(f.id, learner, input(changed)), 409);
  const detail = await readCourseQuestion(f.id, receipt.question.id, learner);
  expect(detail.question.revision).toBe(solution.revision);
  expect(detail.answers).toHaveLength(1);
  const probe = await revalidateCourseQuestionIds(f.id, learner, { ids: [receipt.question.id], filter: 'answered', q: 'Generic', lessonContext: f.pair });
  expect(probe.contexts).toEqual([{ id: receipt.question.id, lessonContext: { status: 'unavailable' } }]);
  expect(probe).not.toHaveProperty('items');
  const serialized = JSON.stringify(probe);
  for (const forbidden of [f.pair.publicationId, f.pair.contentId, f.contents[0].title, 'body', 'Generic question', 'historical-private', 'href']) expect(serialized).not.toContain(forbidden);
  expect((await listCourseQuestions(f.id, learner, query(currentPair, { filter: 'answered' }))).items).toEqual([]);
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).items).toHaveLength(1);
  expect(await prisma.courseQuestion.count({ where: { courseId: f.id } })).toBe(1);
});

test.each(['archive', 'remove', 'parent', 'title', 'body', 'type', 'topology', 'prerequisite', 'release'] as const)('context becomes neutral after %s while exact replay remains recoverable', async change => {
  const required = node(`context-change-first-${change}`);
  const selected = node(`context-change-last-${change}`, { order: 2 });
  const f = await fixture([required, selected]);
  const receipt = await createCourseQuestion(f.id, learner, input(f.pair));
  if (change === 'archive') await prisma.courseContent.update({ where: { id: selected.id }, data: { archivedAt: new Date() } });
  if (change === 'remove') await prisma.courseContent.delete({ where: { id: selected.id } });
  if (change === 'title' || change === 'body' || change === 'type' || change === 'topology') await prisma.courseContent.update({ where: { id: selected.id }, data:
    change === 'title' ? { title: 'Changed private title' } : change === 'body' ? { content: 'Changed private body' } : change === 'type' ? { type: 'VIDEO' } : { order: 99 } });
  if (change === 'parent' || change === 'prerequisite' || change === 'release') {
    const updated = change === 'parent' ? [...f.contents, node(`context-grandchild-${change}`, { parentId: selected.id })] : f.contents.map(row => row.id === selected.id ? { ...row,
      ...(change === 'prerequisite' ? { prerequisiteIds: [required.id] } : { releaseOn: '2099-01-01' }) } : row);
    await prisma.coursePublication.update({ where: { id: f.pair.publicationId }, data: { payload: JSON.stringify({ schemaVersion: 1, contents: updated }) } });
    if (change === 'parent') await prisma.courseContent.create({ data: { ...node(`context-grandchild-${change}`, { parentId: selected.id }), type: 'TEXT', courseId: f.id } });
  }
  if (change === 'archive' || change === 'remove' || change === 'parent') {
    await fail(() => createCourseQuestion(f.id, learner, input(f.pair, 'new-anchor')), 404);
  }
  expect((await readCourseQuestion(f.id, receipt.question.id, learner)).question.lessonContext).toEqual({ status: 'unavailable' });
  expect((await createCourseQuestion(f.id, learner, input(f.pair))).question.lessonContext).toEqual({ status: 'unavailable' });
  expect((await revalidateCourseQuestionIds(f.id, learner, { ids: [receipt.question.id], filter: 'all' })).contexts).toEqual([{ id: receipt.question.id, lessonContext: { status: 'unavailable' } }]);
  expect(await prisma.courseQuestion.count({ where: { courseId: f.id } })).toBe(1);
});

test('replay still rechecks current enrollment, publication, hidden status and database-backed role', async () => {
  const f = await fixture();
  const receipt = await createCourseQuestion(f.id, staleAdmin, input(f.pair));
  await prisma.enrollment.delete({ where: { userId_courseId: { userId: staleAdmin.id, courseId: f.id } } });
  await fail(() => createCourseQuestion(f.id, staleAdmin, input(f.pair)), 403);
  await prisma.enrollment.create({ data: { userId: staleAdmin.id, courseId: f.id } });
  expect((await createCourseQuestion(f.id, staleAdmin, input(f.pair))).created).toBe(false);
  await hideCourseQuestion(f.id, receipt.question.id, owner, true);
  await fail(() => createCourseQuestion(f.id, staleAdmin, input(f.pair)), 404);
  await hideCourseQuestion(f.id, receipt.question.id, owner, false);
  await prisma.course.update({ where: { id: f.id }, data: { activePublicationId: null } });
  await fail(() => createCourseQuestion(f.id, staleAdmin, input(f.pair)), 404);
  expect((await readCourseQuestion(f.id, receipt.question.id, owner)).question.lessonContext).toEqual({ status: 'unavailable' });
});

test('exact pair/filter/search pagination and v2 cursor cannot cross any scope, v1 stays course-only', async () => {
  const f = await fixture([node('context-page-a'), node('context-page-b', { order: 2 })]);
  const timestamp = new Date('2026-01-01T00:00:00Z');
  await prisma.courseQuestion.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ id: `context-page-${String(i).padStart(3, '0')}`, courseId: f.id, authorId: learner.id,
    title: 'Pagination target', body: 'The same searchable body.', requestId: `context-page-req-${i}`, contextPublicationId: f.pair.publicationId, contextContentId: f.pair.contentId, createdAt: timestamp })) });
  await createCourseQuestion(f.id, learner, input(null));
  const first = await listCourseQuestions(f.id, learner, query(f.pair, { q: 'Pagination' }));
  expect(first.items).toHaveLength(20);
  const cursor = first.nextCursor!;
  expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toMatchObject({ v: 2, lessonContext: f.pair });
  const next = await listCourseQuestions(f.id, learner, query(f.pair, { q: 'Pagination', cursor }));
  expect(next.items).toHaveLength(5);
  expect(new Set([...first.items, ...next.items].map(row => row.id)).size).toBe(25);
  for (const params of [query(undefined, { q: 'Pagination', cursor }), query({ ...f.pair, contentId: 'context-page-a' }, { q: 'Pagination', cursor }),
    query({ ...f.pair, publicationId: 'old-publication' }, { q: 'Pagination', cursor }), query(f.pair, { q: 'Other', cursor }), query(f.pair, { q: 'Pagination', filter: 'open', cursor })]) {
    await fail(() => listCourseQuestions(f.id, learner, params), 400);
  }
  const v1 = Buffer.from(JSON.stringify({ v: 1, courseId: f.id, filter: 'all', q: '', id: first.items[0].id, createdAt: timestamp.toISOString() })).toString('base64url');
  await expect(listCourseQuestions(f.id, learner, query(undefined, { cursor: v1 }))).resolves.toHaveProperty('items');
  await fail(() => listCourseQuestions(f.id, learner, query(f.pair, { cursor: v1 })), 400);
});

test('body-free retained probe is search/filter/pair-bound, complete and capped at 200 unique IDs', async () => {
  const f = await fixture();
  const anchored = (await createCourseQuestion(f.id, learner, input(f.pair))).question;
  const plain = (await createCourseQuestion(f.id, learner, { ...input(null, 'plain'), title: 'Different wording' })).question;
  const probe = await revalidateCourseQuestionIds(f.id, learner, { ids: [anchored.id, plain.id, 'missing'], filter: 'all', q: 'Generic', lessonContext: f.pair });
  expect(probe.visibleIds).toEqual([anchored.id]);
  expect(probe.contexts).toEqual([{ id: anchored.id, lessonContext: anchored.lessonContext }]);
  expect(JSON.stringify(probe)).not.toContain('How does');
  expect((await revalidateCourseQuestionIds(f.id, learner, { ids: [anchored.id], filter: 'answered', lessonContext: f.pair })).contexts).toEqual([]);
  await fail(() => revalidateCourseQuestionIds(f.id, learner, { ids: [anchored.id, anchored.id], filter: 'all' }), 400);
  await fail(() => revalidateCourseQuestionIds(f.id, learner, { ids: Array.from({ length: 201 }, (_, i) => `q-${i}`), filter: 'all' }), 400);
  await fail(() => revalidateCourseQuestionIds(f.id, learner, { ids: [], filter: 'all', q: '\u0000' }), 400);
  await hideCourseQuestion(f.id, anchored.id, owner, true);
  expect((await revalidateCourseQuestionIds(f.id, learner, { ids: [anchored.id], filter: 'all' })).contexts).toEqual([]);
  expect((await revalidateCourseQuestionIds(f.id, owner, { ids: [anchored.id], filter: 'hidden' })).contexts).toHaveLength(1);
});

test('HTTP uses existing origin/no-store gates for anchored create, exact replay and redacted errors', async () => {
  const f = await fixture(); const context = { params: Promise.resolve({ courseId: f.id }) };
  jest.mocked(getServerSession).mockResolvedValue({ user: learner } as never);
  expect((await createHttp(request(f.id, 'POST', input(f.pair), '', 'https://evil.invalid'), context)).status).toBe(403);
  const created = await createHttp(request(f.id, 'POST', input(f.pair)), context);
  expect(created.status).toBe(201); expect(created.headers.get('cache-control')).toBe('private, no-store');
  expect((await createHttp(request(f.id, 'POST', input(f.pair)), context)).status).toBe(200);
  const listing = await listHttp(request(f.id, 'GET', undefined, `?publicationId=${f.pair.publicationId}&contentId=${f.pair.contentId}`), context);
  expect(listing.status).toBe(200); expect(listing.headers.get('cache-control')).toBe('private, no-store');
  const id = (await created.json()).question.id;
  const probe = await probeHttp(request(f.id, 'POST', { ids: [id], filter: 'all', lessonContext: f.pair }), context);
  expect(probe.status).toBe(200); expect(probe.headers.get('cache-control')).toBe('private, no-store');
  await republish(f);
  const denied = await createHttp(request(f.id, 'POST', input(f.pair, 'new')), context);
  expect(denied.status).toBe(412); expect(denied.headers.get('cache-control')).toBe('private, no-store');
  expect(await denied.text()).not.toContain(f.contents[0].title);
});

test('context reads create no learning, public, notification or reward records', async () => {
  const f = await fixture();
  const q = (await createCourseQuestion(f.id, learner, input(f.pair))).question;
  const counts = async () => Promise.all([prisma.enrollment.count(), prisma.courseContentProgress.count(), prisma.certificate.count(),
    prisma.rewardLedger.count(), prisma.post.count(), prisma.comment.count(), prisma.notification.count()]);
  const before = await counts();
  await listCourseQuestions(f.id, learner, query(f.pair));
  await readCourseQuestion(f.id, q.id, owner);
  await revalidateCourseQuestionIds(f.id, admin, { ids: [q.id], filter: 'all', lessonContext: f.pair });
  expect(await counts()).toEqual(before);
});

test('latest current assignment grade, not a mirror row or older pass, controls prerequisite labels', async () => {
  const first = node('context-assignment-proof', { type: 'ASSIGNMENT', content: JSON.stringify({ prompt: 'Private prompt', passingScore: 70 }) });
  const f = await fixture([first, node('context-after-assignment', { order: 2, prerequisiteIds: [first.id] })]);
  await prisma.courseContentProgress.create({ data: { userId: learner.id, courseId: f.id, contentId: first.id, revision: courseContentRevision(first) } });
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).canAskInScope).toBe(false);
  const submission = await prisma.assignmentSubmission.create({ data: { userId: learner.id, courseId: f.id, contentId: first.id,
    publicationId: f.pair.publicationId, revision: courseContentRevision(first), passingScore: 70, requestId: 'context-assignment-first',
    response: 'Private learner response', responseDigest: 'digest', attemptNumber: 1 } });
  await prisma.assignmentGradeDecision.create({ data: { submissionId: submission.id, requestId: 'context-assignment-pass', graderId: owner.id, action: 'GRADED', score: 90, sequence: 1 } });
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).canAskInScope).toBe(true);
  await prisma.assignmentGradeDecision.create({ data: { submissionId: submission.id, requestId: 'context-assignment-fail', graderId: owner.id, action: 'GRADED', score: 20, sequence: 2 } });
  await fail(() => createCourseQuestion(f.id, learner, input(f.pair)), 423);
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).scope).toEqual({ kind: 'lesson', lessonContext: { status: 'unavailable' } });
});

test('earned current credit does not bypass a newly future-dated published root', async () => {
  const first = node('context-earned-dated', { releaseOn: '2099-01-01' });
  const f = await fixture([first]);
  await prisma.courseContentProgress.create({ data: { userId: learner.id, courseId: f.id, contentId: first.id, revision: courseContentRevision(first) } });
  await fail(() => createCourseQuestion(f.id, learner, input(f.pair)), 423);
  expect((await listCourseQuestions(f.id, learner, query(f.pair))).canAskInScope).toBe(false);
});

test('current moderator authority is live-checked after owner reassignment and admin downgrade', async () => {
  const f = await fixture();
  const receipt = await createCourseQuestion(f.id, learner, input(f.pair));
  await hideCourseQuestion(f.id, receipt.question.id, owner, true);
  await prisma.course.update({ where: { id: f.id }, data: { instructorId: peer.id } });
  await fail(() => readCourseQuestion(f.id, receipt.question.id, owner), 403);
  await prisma.enrollment.create({ data: { userId: owner.id, courseId: f.id } });
  await fail(() => readCourseQuestion(f.id, receipt.question.id, owner), 404);
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'USER' } });
  try { await fail(() => listCourseQuestions(f.id, admin, query()), 403); }
  finally { await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
  const probe = await revalidateCourseQuestionIds(f.id, owner, { ids: [receipt.question.id], filter: 'hidden' });
  expect(probe.contexts).toEqual([]); expect(probe.canModerate).toBe(false);
});

test('200 retained current anchors share one completion projection and unexpected service failure fails closed', async () => {
  const progress = await import('@/lib/server/course-progress');
  const f = await fixture();
  await prisma.courseQuestion.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ id: `context-batch-${i}`, courseId: f.id, authorId: learner.id,
    title: 'Retained generic question', body: 'Question content stays separate.', requestId: `context-batch-request-${i}`,
    contextPublicationId: f.pair.publicationId, contextContentId: f.pair.contentId })) });
  const completed = jest.mocked(progress.completionState); completed.mockClear();
  const probe = await revalidateCourseQuestionIds(f.id, learner, { ids: Array.from({ length: 200 }, (_, i) => `context-batch-${i}`), filter: 'all' });
  expect(probe.contexts).toHaveLength(200); expect(completed).toHaveBeenCalledTimes(1);
  completed.mockRejectedValueOnce(new Error('simulated unavailable database'));
  await expect(listCourseQuestions(f.id, learner, query(f.pair))).rejects.toThrow('simulated unavailable database');

});

test('competing duplicate anchored creates and removal race remain serializable; replay never consumes the daily cap', async () => {
  const f = await fixture();
  const duplicate = await Promise.all([createCourseQuestion(f.id, learner, input(f.pair)), createCourseQuestion(f.id, learner, input(f.pair))]);
  expect(duplicate.map(row => row.question.id)).toEqual([duplicate[0].question.id, duplicate[0].question.id]);
  expect(duplicate.map(row => row.created).sort()).toEqual([false, true]);
  await prisma.courseQuestion.createMany({ data: Array.from({ length: 9 }, (_, i) => ({ courseId: f.id, authorId: learner.id,
    title: 'Daily question', body: 'Daily course question text.', requestId: `context-cap-${i}` })) });
  expect((await createCourseQuestion(f.id, learner, input(f.pair))).created).toBe(false);
  await fail(() => createCourseQuestion(f.id, learner, input(f.pair, 'over-cap')), 429);
  const other = await fixture();
  const race = await Promise.allSettled([
    createCourseQuestion(other.id, learner, input(other.pair)),
    prisma.courseContent.delete({ where: { id: other.pair.contentId } }),
  ]);
  expect(race[1].status).toBe('fulfilled');
  if (race[0].status === 'fulfilled') {
    expect((await readCourseQuestion(other.id, race[0].value.question.id, learner)).question.lessonContext).toEqual({ status: 'unavailable' });
  } else expect([404, 409]).toContain(race[0].reason.status);
});

test('a target moved beneath a future published root follows its new ancestry even with earned credit', async () => {
  const open = node('context-move-open');
  const future = node('context-move-future', { order: 2, releaseOn: '2099-01-01' });
  const leaf = node('context-move-leaf', { parentId: open.id });
  const f = await fixture([open, future, leaf]);
  const receipt = await createCourseQuestion(f.id, learner, input(f.pair));
  await prisma.courseContentProgress.create({ data: { userId: learner.id, courseId: f.id, contentId: leaf.id, revision: courseContentRevision(leaf) } });
  const contents = f.contents.map(row => row.id === leaf.id ? { ...row, parentId: future.id } : row);
  await prisma.coursePublication.update({ where: { id: f.pair.publicationId }, data: { payload: JSON.stringify({ schemaVersion: 1, contents }) } });
  await prisma.courseContent.update({ where: { id: leaf.id }, data: { parentId: future.id } });
  expect((await readCourseQuestion(f.id, receipt.question.id, learner)).question.lessonContext).toEqual({ status: 'unavailable' });
  await fail(() => createCourseQuestion(f.id, learner, input(f.pair, 'after-move')), 423);
});
