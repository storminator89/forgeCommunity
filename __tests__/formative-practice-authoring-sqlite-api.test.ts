/** @jest-environment node */
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GET as listObjectives, POST as createObjective } from '@/app/api/courses/practice/objectives/route';
import { GET as readObjective, PATCH as updateObjective } from '@/app/api/courses/practice/objectives/[objectiveId]/route';
import { GET as listItems, POST as createItem } from '@/app/api/courses/practice/objectives/[objectiveId]/items/route';
import { GET as readItem, PATCH as updateItem } from '@/app/api/courses/practice/items/[itemId]/route';
import { GET as readRevision } from '@/app/api/courses/practice/items/[itemId]/revisions/[revision]/route';
import { GET as readDraft, PATCH as saveDraft } from '@/app/api/courses/[courseId]/practice/authoring/route';
import { POST as publish } from '@/app/api/courses/[courseId]/practice/authoring/publish/route';
import { GET as history } from '@/app/api/courses/[courseId]/practice/authoring/history/route';
import { POST as previewPins } from '@/app/api/courses/[courseId]/practice/authoring/preview/route';
import { credentialOverlapKey, normalizeOverlapText } from '@/lib/server/formative-practice';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value),
    { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); }
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-formative-authoring-'));
  const path = join(directory, 'practice.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, __dbPath: path,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const courseId = 'practice-course-123';
const teacherId = 'practice-teacher-123';
const outsiderId = 'practice-other-123';
const adminId = 'practice-admin-123';
const learnerId = 'practice-learner-123';
const initialPublicationId = 'practice-course-pub-1';
const context = { params: Promise.resolve({ courseId }) };
const baseQuiz = JSON.stringify({ passingScore: 70, questions: [
  { id: 'credential-1', type: 'SINGLE_CHOICE', question: 'Capital of France?', options: ['Berlin', 'Paris'], correctAnswers: [1], explanation: 'Secret key' },
] });
const coursePayload = (quiz = baseQuiz) => ({ schemaVersion: 1, title: 'Course', description: 'Description',
  startDate: null, endDate: null, imageUrl: null, contents: [
    { id: 'practice-course-quiz-1', parentId: null, title: 'Credential quiz', type: 'QUIZ', content: quiz, order: 1 },
  ] });
const digest = (payload: object) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
function actor(id: string, role: string) { jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never); }
function anonymous() { jest.mocked(getServerSession).mockResolvedValue(null); }
function request(path: string, method = 'GET', body?: object) {
  const url = new URL(`http://localhost/api/courses/${courseId}${path}`);
  return Object.assign(new Request(url, { method, ...(body && { body: JSON.stringify(body) }) }), { nextUrl: url }) as never;
}
const choice = (prompt: string, options = ['Berlin', 'Paris']) => ({ type: 'SINGLE_CHOICE', prompt, options, correctIndex: 1, explanation: 'Why it works' });
let objectiveId: string;
let overlappingItemId: string;
let distinctItemId: string;

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: teacherId, email: 'practice-teacher@example.invalid', role: 'INSTRUCTOR' },
    { id: outsiderId, email: 'practice-other@example.invalid', role: 'INSTRUCTOR' },
    { id: adminId, email: 'practice-admin@example.invalid', role: 'ADMIN' },
    { id: learnerId, email: 'practice-learner@example.invalid', role: 'USER' },
  ] });
  await prisma.course.create({ data: { id: courseId, instructorId: teacherId, title: 'Course', description: 'Description' } });
  const payload = coursePayload();
  await prisma.coursePublication.create({ data: { id: initialPublicationId, courseId, sequence: 1,
    source: 'AUTHOR', payload: JSON.stringify(payload), digest: digest(payload), contentCount: 1 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: initialPublicationId } });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('objective and item authoring is private, revisioned and immutable', async () => {
  anonymous();
  expect((await listObjectives(request('/practice/objectives'))).status).toBe(401);
  actor(learnerId, 'USER');
  expect((await createObjective(request('/practice/objectives', 'POST', { title: 'Fundamentals' }))).status).toBe(403);
  actor(teacherId, 'INSTRUCTOR');
  const made = await createObjective(request('/practice/objectives', 'POST', { title: 'Capital cities', description: 'Recall capitals' }));
  expect(made.status).toBe(201);
  objectiveId = (await made.json()).id;
  const updated = await updateObjective(request('/practice/objectives/x', 'PATCH', { expectedRevision: 1, patch: { title: 'European capitals' } }),
    { params: Promise.resolve({ objectiveId }) });
  expect(updated.status).toBe(200);
  expect((await updated.json()).revision).toBe(2);
  expect((await updateObjective(request('/practice/objectives/x', 'PATCH', { expectedRevision: 1, patch: { title: 'Stale' } }),
    { params: Promise.resolve({ objectiveId }) })).status).toBe(412);
  const overlap = await createItem(request('/practice/objectives/x/items', 'POST', { choice: choice('  CAPITAL  of France?  ', [' PARIS ', 'Berlin']) }),
    { params: Promise.resolve({ objectiveId }) });
  expect(overlap.status).toBe(201);
  overlappingItemId = (await overlap.json()).id;
  const distinct = await createItem(request('/practice/objectives/x/items', 'POST', { choice: choice('Capital of Italy?', ['Rome', 'Milan']) }),
    { params: Promise.resolve({ objectiveId }) });
  expect(distinct.status).toBe(201);
  distinctItemId = (await distinct.json()).id;
  const listing = await listItems(request('/practice/objectives/x/items'), { params: Promise.resolve({ objectiveId }) });
  expect(listing.status).toBe(200);
  expect(JSON.stringify(await listing.json())).not.toContain('Why it works');
  const revised = await updateItem(request('/practice/items/x', 'PATCH', { expectedRevision: 1, choice: choice('Capital of Italy (revised)?', ['Rome', 'Milan']) }),
    { params: Promise.resolve({ itemId: distinctItemId }) });
  expect(revised.status).toBe(200);
  expect((await revised.json()).latestRevision).toBe(2);
  expect((await updateItem(request('/practice/items/x', 'PATCH', { expectedRevision: 1, choice: choice('Stale') }),
    { params: Promise.resolve({ itemId: distinctItemId }) })).status).toBe(412);
  const firstRevision = await readRevision(request('/practice/items/x/revisions/1'), { params: Promise.resolve({ itemId: distinctItemId, revision: '1' }) });
  expect((await firstRevision.json()).choice.prompt).toBe('Capital of Italy?');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__dbPath);
  try {
    expect(() => db.prepare('UPDATE "PracticeItemRevision" SET "payload"=? WHERE "itemId"=? AND "revision"=1').run('{}', distinctItemId)).toThrow(/immutable/);
    expect(() => db.prepare('INSERT OR REPLACE INTO "PracticeItemRevision" ("itemId", "revision", "payload") VALUES (?, 1, ?)').run(distinctItemId, '{}')).toThrow(/immutable/);
  } finally { db.close(); }
  actor(outsiderId, 'INSTRUCTOR');
  expect((await readRevision(request('/practice/items/x/revisions/1'), { params: Promise.resolve({ itemId: distinctItemId, revision: '1' }) })).status).toBe(404);
  expect((await listItems(request('/practice/objectives/x/items'), { params: Promise.resolve({ objectiveId }) })).status).toBe(404);
});

test('course draft CAS, owner/role checks, normalized exact credential overlap and publish replay', async () => {
  actor(outsiderId, 'INSTRUCTOR');
  expect((await readDraft(request('/practice/authoring'), context)).status).toBe(403);
  actor(learnerId, 'USER');
  expect((await readDraft(request('/practice/authoring'), context)).status).toBe(403);
  actor(teacherId, 'INSTRUCTOR');
  expect((await readDraft(request('/practice/authoring'), context)).status).toBe(200);
  const overlapRef = [{ objectiveId, objectiveRevision: 2, itemId: overlappingItemId, itemRevision: 1 }];
  const saved = await saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: 0, items: overlapRef }), context);
  expect(saved.status).toBe(200);
  expect((await saved.json()).draft.revision).toBe(1);
  expect((await saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: 0, items: overlapRef }), context)).status).toBe(412);
  expect((await publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 1, expectedActivePublicationId: initialPublicationId,
    requestId: 'practice-overlap-request-123' }), context)).status).toBe(409);
  expect(await prisma.practiceSnapshot.count({ where: { courseId } })).toBe(0);
  const distinctRef = [{ objectiveId, objectiveRevision: 2, itemId: distinctItemId, itemRevision: 1 }];
  expect((await saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: 1, items: distinctRef }), context)).status).toBe(200);
  const stale = await publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 1, expectedActivePublicationId: initialPublicationId,
    requestId: 'practice-stale-request-123' }), context);
  expect(stale.status).toBe(412);
  expect((await publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 2, expectedActivePublicationId: 'wrong-pub-123',
    requestId: 'practice-wrong-pub-123' }), context)).status).toBe(412);
  const body = { expectedRevision: 2, expectedActivePublicationId: initialPublicationId, requestId: 'practice-publish-123' };
  const first = await publish(request('/practice/authoring/publish', 'POST', body), context);
  expect(first.status).toBe(200);
  const published = await first.json();
  expect(published.unchanged).toBe(false);
  expect(published.snapshot.coursePublicationId).toBe(initialPublicationId);
  const stored = await prisma.practiceSnapshot.findUniqueOrThrow({ where: { id: published.snapshot.id } });
  expect(JSON.parse(stored.payload).items[0].prompt).toBe('Capital of Italy?');
  expect(JSON.parse(stored.payload).items[0].correctIndex).toBe(1);
  expect(JSON.stringify(stored)).not.toContain('Secret key');
  const retry = await publish(request('/practice/authoring/publish', 'POST', body), context);
  expect(retry.status).toBe(200);
  expect((await retry.json()).snapshot).toEqual(published.snapshot);
  expect((await publish(request('/practice/authoring/publish', 'POST', { ...body, expectedRevision: 1 }), context)).status).toBe(409);
  const unchanged = await publish(request('/practice/authoring/publish', 'POST', { ...body, requestId: 'practice-other-request-123' }), context);
  expect((await unchanged.json()).unchanged).toBe(true);
  expect(await prisma.practiceSnapshot.count({ where: { courseId } })).toBe(1);
  expect(await prisma.quizAttempt.count({ where: { courseId } })).toBe(0);
  const historyResponse = await history(request('/practice/authoring/history'), context);
  expect((await historyResponse.json()).snapshots).toHaveLength(1);
  actor(outsiderId, 'INSTRUCTOR');
  expect((await history(request('/practice/authoring/history'), context)).status).toBe(403);
  actor(adminId, 'ADMIN');
  expect((await history(request('/practice/authoring/history'), context)).status).toBe(200);
});

test('snapshot is only current for its exact course publication and pinned revision survives an item edit', async () => {
  actor(teacherId, 'INSTRUCTOR');
  const changed = await saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: 2,
    items: [{ objectiveId, objectiveRevision: 2, itemId: distinctItemId, itemRevision: 2 }] }), context);
  expect(changed.status).toBe(200);
  const newerPayload = coursePayload();
  const nextPublicationId = 'practice-course-pub-2';
  await prisma.coursePublication.create({ data: { id: nextPublicationId, courseId, sequence: 2,
    source: 'AUTHOR', payload: JSON.stringify(newerPayload), digest: digest(newerPayload), contentCount: 1 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: nextPublicationId } });
  const read = await readDraft(request('/practice/authoring'), context);
  const current = await read.json();
  expect(current.activeSnapshot).toBeNull();
  expect((await publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 3, expectedActivePublicationId: initialPublicationId,
    requestId: 'practice-old-course-pub-123' }), context)).status).toBe(412);
  const next = await publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 3, expectedActivePublicationId: nextPublicationId,
    requestId: 'practice-new-course-pub-123' }), context);
  expect(next.status).toBe(200);
  const nextJson = await next.json();
  expect(nextJson.snapshot.sequence).toBe(2);
  const stored = await prisma.practiceSnapshot.findUniqueOrThrow({ where: { id: nextJson.snapshot.id } });
  expect(JSON.parse(stored.payload).items[0].prompt).toBe('Capital of Italy (revised)?');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__dbPath);
  try {
    expect(() => db.prepare('UPDATE "PracticeSnapshot" SET "payload"=? WHERE "id"=?').run('{}', stored.id)).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM "PracticeSnapshot" WHERE "id"=?').run(stored.id)).toThrow(/immutable/);
    expect(() => db.prepare(`INSERT OR REPLACE INTO "PracticeSnapshot"
      ("id", "courseId", "coursePublicationId", "sequence", "draftRevision", "payload", "digest", "itemCount", "actorId")
      VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)`).run(stored.id, stored.courseId, stored.coursePublicationId,
      stored.sequence, stored.draftRevision, stored.digest, stored.itemCount, stored.actorId)).toThrow(/immutable/);
    expect(() => db.prepare(`INSERT OR REPLACE INTO "PracticeSnapshot"
      ("id", "courseId", "coursePublicationId", "sequence", "draftRevision", "payload", "digest", "itemCount", "actorId")
      VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)`).run('alternate-snapshot-id-123', stored.courseId, stored.coursePublicationId,
      stored.sequence, stored.draftRevision, stored.digest, stored.itemCount, stored.actorId)).toThrow(/immutable/);
    expect(() => db.prepare('INSERT OR REPLACE INTO "PracticePublicationRequest" ("courseId", "requestId", "actorId", "requestDigest", "snapshotId") VALUES (?, ?, ?, ?, ?)')
      .run(courseId, 'practice-new-course-pub-123', adminId, 'changed-digest', stored.id)).toThrow(/immutable/);
  } finally { db.close(); }
  const replay = await publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 2,
    expectedActivePublicationId: initialPublicationId, requestId: 'practice-publish-123' }), context);
  expect(replay.status).toBe(200);
  expect((await replay.json()).snapshot.coursePublicationId).toBe(initialPublicationId);
});

test('normalization is deliberately exact, not semantic', () => {
  expect(normalizeOverlapText('  CAFÉ\u00a0? ')).toBe('café ?');
  expect(credentialOverlapKey('CAPITAL  of France?', [' Paris ', 'BERLIN'])).toBe(
    credentialOverlapKey('capital of france?', ['berlin', 'paris']));
  expect(credentialOverlapKey('What is the capital of France?', ['Berlin', 'Paris'])).not.toBe(
    credentialOverlapKey('Capital of France?', ['Berlin', 'Paris']));
});

test('composite FKs forbid cross-course publication and receipt binding', async () => {
  const otherCourseId = 'practice-cross-course-123';
  await prisma.course.create({ data: { id: otherCourseId, instructorId: teacherId, title: 'Other course', description: 'Other' } });
  const ownSnapshot = await prisma.practiceSnapshot.findFirstOrThrow({ where: { courseId }, select: { id: true } });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    expect(() => db.prepare(`INSERT INTO "PracticeSnapshot"
      ("id", "courseId", "coursePublicationId", "sequence", "draftRevision", "payload", "digest", "itemCount", "actorId")
      VALUES (?, ?, ?, 1, 0, '{}', 'digest', 1, ?)`).run('invalid-cross-snapshot-123', otherCourseId,
      initialPublicationId, teacherId)).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(`INSERT INTO "PracticePublicationRequest"
      ("courseId", "requestId", "actorId", "requestDigest", "snapshotId") VALUES (?, ?, ?, 'digest', ?)`)
      .run(otherCourseId, 'invalid-cross-receipt-123', teacherId, ownSnapshot.id)).toThrow(/FOREIGN KEY/);
  } finally { db.close(); }
  await prisma.course.delete({ where: { id: otherCourseId } });
});

test('parallel draft CAS and publish request settle to one revision and one receipt', async () => {
  actor(teacherId, 'INSTRUCTOR');
  const current = await readDraft(request('/practice/authoring'), context);
  const { draft, activeCoursePublicationId } = await current.json();
  const refs = [{ objectiveId, objectiveRevision: 2, itemId: distinctItemId, itemRevision: 1 }];
  const results = await Promise.all([
    saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: draft.revision, items: refs }), context),
    saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: draft.revision, items: refs }), context),
  ]);
  expect(results.map(result => result.status).sort()).toEqual([200, 412]);
  const nextRevision = draft.revision + 1;
  const before = await prisma.practiceSnapshot.count({ where: { courseId } });
  const body = { expectedRevision: nextRevision, expectedActivePublicationId: activeCoursePublicationId,
    requestId: 'practice-concurrent-publish-123' };
  const publishes = await Promise.all([
    publish(request('/practice/authoring/publish', 'POST', body), context),
    publish(request('/practice/authoring/publish', 'POST', body), context),
  ]);
  expect(publishes.map(result => result.status)).toEqual([200, 200]);
  const ids = await Promise.all(publishes.map(async result => (await result.json()).snapshot.id));
  expect(ids[0]).toBe(ids[1]);
  expect(await prisma.practiceSnapshot.count({ where: { courseId } })).toBe(before + 1);
  expect(await prisma.practicePublicationRequest.count({ where: { courseId, requestId: body.requestId } })).toBe(1);
});

test('item/objective FK cannot cross owners, and account cascade preserves deletion rights', async () => {
  actor(outsiderId, 'INSTRUCTOR');
  const own = await createObjective(request('/practice/objectives', 'POST', { title: 'Other objective' }));
  const otherObjectiveId = (await own.json()).id;
  actor(teacherId, 'INSTRUCTOR');
  await expect(prisma.practiceItem.create({ data: { ownerId: teacherId, objectiveId: otherObjectiveId,
    revisions: { create: { revision: 1, payload: JSON.stringify({ schemaVersion: 1, ...choice('Invalid cross owner') }) } } } })).rejects.toThrow();
  actor(outsiderId, 'INSTRUCTOR');
  const ownItem = await createItem(request('/practice/objectives/x/items', 'POST', { choice: choice('Other prompt') }),
    { params: Promise.resolve({ objectiveId: otherObjectiveId }) });
  const otherItemId = (await ownItem.json()).id;
  actor(teacherId, 'INSTRUCTOR');
  expect((await saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: 4,
    items: [{ objectiveId: otherObjectiveId, objectiveRevision: 1, itemId: otherItemId, itemRevision: 1 }] }), context)).status).toBe(409);
  await prisma.user.delete({ where: { id: outsiderId } });
  expect(await prisma.practiceObjective.count({ where: { id: otherObjectiveId } })).toBe(0);
  expect(await prisma.practiceItem.count({ where: { id: otherItemId } })).toBe(0);
});

test('an objective edit cannot silently change a saved practice publication', async () => {
  actor(teacherId, 'INSTRUCTOR');
  const changed = await updateObjective(request('/practice/objectives/x', 'PATCH', { expectedRevision: 2,
    patch: { title: 'Updated European capitals' } }), { params: Promise.resolve({ objectiveId }) });
  expect(changed.status).toBe(200);
  expect((await changed.json()).revision).toBe(3);
  const activeCoursePublicationId = 'practice-course-pub-2';
  const blocked = await publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 4,
    expectedActivePublicationId: activeCoursePublicationId, requestId: 'practice-stale-objective-123' }), context);
  expect(blocked.status).toBe(412);
  expect((await saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: 4,
    items: [{ objectiveId, objectiveRevision: 2, itemId: distinctItemId, itemRevision: 1 }] }), context)).status).toBe(412);
  expect((await saveDraft(request('/practice/authoring', 'PATCH', { expectedRevision: 4,
    items: [{ objectiveId, objectiveRevision: 3, itemId: distinctItemId, itemRevision: 1 }] }), context)).status).toBe(200);
  const publications = await Promise.all(['practice-updated-objective-123', 'practice-updated-objective-456'].map(requestId =>
    publish(request('/practice/authoring/publish', 'POST', { expectedRevision: 5,
      expectedActivePublicationId: activeCoursePublicationId, requestId }), context)));
  expect(publications.map(response => response.status)).toEqual([200, 200]);
  const results = await Promise.all(publications.map(response => response.json()));
  expect(results[0].snapshot.id).toBe(results[1].snapshot.id);
  const snapshot = await prisma.practiceSnapshot.findUniqueOrThrow({ where: { id: results[0].snapshot.id } });
  expect(JSON.parse(snapshot.payload).items[0].objectiveTitle).toBe('Updated European capitals');
});

test('SQLite direct DELETE and REPLACE cannot erase item/objective or publication history', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    expect(db.prepare('PRAGMA recursive_triggers').get().recursive_triggers).toBe(0);
    const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count);
    const before = {
      objectives: count('PracticeObjective'), items: count('PracticeItem'), revisions: count('PracticeItemRevision'),
      snapshots: count('PracticeSnapshot'), receipts: count('PracticePublicationRequest'),
    };
    expect(() => db.prepare('DELETE FROM "PracticeItem" WHERE "id"=?').run(distinctItemId)).toThrow(/directly deleted/);
    expect(() => db.prepare('DELETE FROM "PracticeObjective" WHERE "id"=?').run(objectiveId)).toThrow(/directly deleted/);
    expect(() => db.prepare('DELETE FROM "PracticePublicationRequest" WHERE "courseId"=? AND "requestId"=?')
      .run(courseId, 'practice-updated-objective-123')).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM "CoursePublication" WHERE "id"=?')
      .run('practice-course-pub-2')).toThrow(/immutable/);
    expect(() => db.prepare('INSERT OR REPLACE INTO "PracticeItem" ("id", "ownerId", "objectiveId") VALUES (?, ?, ?)')
      .run(distinctItemId, teacherId, objectiveId)).toThrow(/cannot be replaced/);
    expect(() => db.prepare('INSERT OR REPLACE INTO "PracticeObjective" ("id", "ownerId", "title") VALUES (?, ?, ?)')
      .run(objectiveId, teacherId, 'Replacement')).toThrow(/cannot be replaced/);
    expect(() => db.prepare(`INSERT OR REPLACE INTO "CoursePublication"
      ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
      VALUES (?, ?, 2, 'AUTHOR', '{}', 'other', 1)`).run('practice-course-pub-2', courseId)).toThrow(/cannot be replaced/);
    expect(() => db.prepare(`INSERT OR REPLACE INTO "CoursePublication"
      ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
      VALUES (?, ?, 2, 'AUTHOR', '{}', 'other', 1)`).run('practice-replacement-pub-123', courseId)).toThrow(/cannot be replaced/);
    expect(count('PracticeObjective')).toBe(before.objectives);
    expect(count('PracticeItem')).toBe(before.items);
    expect(count('PracticeItemRevision')).toBe(before.revisions);
    expect(count('PracticeSnapshot')).toBe(before.snapshots);
    expect(count('PracticePublicationRequest')).toBe(before.receipts);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

test('normal User and Course UPSERTs remain supported with existing practice history', async () => {
  const before = {
    revisions: await prisma.practiceItemRevision.count(), snapshots: await prisma.practiceSnapshot.count(),
    receipts: await prisma.practicePublicationRequest.count(),
  };
  const user = await prisma.user.upsert({ where: { email: 'practice-teacher@example.invalid' },
    update: { isTestAccount: true },
    create: { email: 'practice-teacher@example.invalid', role: 'INSTRUCTOR' } });
  expect(user.id).toBe(teacherId);
  const course = await prisma.course.upsert({ where: { id: courseId },
    update: { title: 'Updated course title' },
    create: { id: courseId, instructorId: teacherId, title: 'Unexpected course', description: 'Unexpected' } });
  expect(course.title).toBe('Updated course title');
  expect(await prisma.practiceItemRevision.count()).toBe(before.revisions);
  expect(await prisma.practiceSnapshot.count()).toBe(before.snapshots);
  expect(await prisma.practicePublicationRequest.count()).toBe(before.receipts);
});

test('101 objectives, 101 items and 101 snapshots remain owner-reachable after paging and pin reload', async () => {
  const pagingCourseId = 'practice-paged-course-123';
  const pagingOutsiderId = 'practice-paged-outsider-123';
  await prisma.user.create({ data: { id: pagingOutsiderId, email: 'practice-paged-outsider@example.invalid', role: 'INSTRUCTOR' } });
  const pagingContext = { params: Promise.resolve({ courseId: pagingCourseId }) };
  const pagingRequest = (path: string, method = 'GET', body?: object) => {
    const url = new URL(`http://localhost/api/courses/${pagingCourseId}${path}`);
    return Object.assign(new Request(url, { method, ...(body && { body: JSON.stringify(body) }) }), { nextUrl: url }) as never;
  };
  const stamp = new Date('2025-01-01T00:00:00.000Z');
  const objectives = Array.from({ length: 101 }, (_, index) => ({
    id: `practice-paged-objective-${String(index).padStart(3, '0')}`, ownerId: teacherId,
    title: `Learning objective ${index}`, description: '', updatedAt: stamp,
  }));
  const oldestObjective = objectives[0];
  const items = Array.from({ length: 101 }, (_, index) => ({
    id: `practice-paged-item-${String(index).padStart(3, '0')}`, ownerId: teacherId,
    objectiveId: oldestObjective.id, latestRevision: 1, updatedAt: stamp,
  }));
  const oldestItem = items[0];
  const publicationId = 'practice-paged-publication-123';
  const payload = coursePayload();
  await prisma.course.create({ data: { id: pagingCourseId, instructorId: teacherId, title: 'Paged course', description: '' } });
  await prisma.coursePublication.create({ data: { id: publicationId, courseId: pagingCourseId, sequence: 1,
    source: 'AUTHOR', payload: JSON.stringify(payload), digest: digest(payload), contentCount: 1 } });
  await prisma.course.update({ where: { id: pagingCourseId }, data: { activePublicationId: publicationId } });
  await prisma.practiceObjective.createMany({ data: objectives });
  await prisma.practiceItem.createMany({ data: items });
  await prisma.practiceItemRevision.createMany({ data: items.map((row, index) => ({ itemId: row.id, revision: 1,
    payload: JSON.stringify({ schemaVersion: 1, ...choice(`Archived practice question ${index}?`) }) })) });

  actor(teacherId, 'INSTRUCTOR');
  const firstObjectivesResponse = await listObjectives(pagingRequest('/practice/objectives'));
  expect(firstObjectivesResponse.status).toBe(200);
  const firstObjectives = await firstObjectivesResponse.json();
  expect(firstObjectives.objectives).toHaveLength(100);
  expect(firstObjectives.objectives.some((row: { id: string }) => row.id === oldestObjective.id)).toBe(false);
  expect(firstObjectives.nextCursor).toEqual(expect.any(String));
  const secondObjectives = await (await listObjectives(pagingRequest(`/practice/objectives?cursor=${firstObjectives.nextCursor}`))).json();
  expect(secondObjectives.objectives.map((row: { id: string }) => row.id)).toContain(oldestObjective.id);
  expect(secondObjectives.nextCursor).toBeNull();
  expect((await listObjectives(pagingRequest('/practice/objectives?cursor=broken!'))).status).toBe(400);
  const itemContext = { params: Promise.resolve({ objectiveId: oldestObjective.id }) };
  const firstItems = await (await listItems(pagingRequest(`/practice/objectives/${oldestObjective.id}/items`), itemContext)).json();
  expect(firstItems.items).toHaveLength(100);
  expect(firstItems.items.some((row: { id: string }) => row.id === oldestItem.id)).toBe(false);
  const secondItems = await (await listItems(pagingRequest(`/practice/objectives/${oldestObjective.id}/items?cursor=${firstItems.nextCursor}`), itemContext)).json();
  expect(secondItems.items.map((row: { id: string }) => row.id)).toEqual([oldestItem.id]);
  expect(secondItems.nextCursor).toBeNull();
  expect((await readObjective(pagingRequest(`/practice/objectives/${oldestObjective.id}`), itemContext)).status).toBe(200);
  expect((await readItem(pagingRequest(`/practice/items/${oldestItem.id}`), { params: Promise.resolve({ itemId: oldestItem.id }) })).status).toBe(200);

  const oldRef = [{ objectiveId: oldestObjective.id, objectiveRevision: 1, itemId: oldestItem.id, itemRevision: 1 }];
  const saved = await saveDraft(pagingRequest('/practice/authoring', 'PATCH', { expectedRevision: 0, items: oldRef }), pagingContext);
  expect(saved.status).toBe(200);
  const reloaded = await (await readDraft(pagingRequest('/practice/authoring'), pagingContext)).json();
  expect(reloaded.draft.payload.items).toEqual(oldRef);
  const preview = await previewPins(pagingRequest('/practice/authoring/preview', 'POST', { items: reloaded.draft.payload.items }), pagingContext);
  expect(preview.status).toBe(200);
  expect((await preview.json()).items[0]).toMatchObject({ objectiveTitle: oldestObjective.title, prompt: 'Archived practice question 0?' });
  const published = await publish(pagingRequest('/practice/authoring/publish', 'POST', {
    expectedRevision: 1, expectedActivePublicationId: publicationId, requestId: 'practice-paged-publish-123',
  }), pagingContext);
  expect(published.status).toBe(200);
  const publishedSnapshot = await prisma.practiceSnapshot.findFirstOrThrow({ where: { courseId: pagingCourseId } });
  const snapshots = Array.from({ length: 100 }, (_, index) => ({
    id: `practice-paged-snapshot-${String(index + 2).padStart(3, '0')}`, courseId: pagingCourseId,
    coursePublicationId: publicationId, sequence: index + 2, draftRevision: 1,
    payload: publishedSnapshot.payload, digest: publishedSnapshot.digest, itemCount: 1, actorId: teacherId,
  }));
  await prisma.practiceSnapshot.createMany({ data: snapshots });
  const firstHistory = await (await history(pagingRequest('/practice/authoring/history'), pagingContext)).json();
  expect(firstHistory.snapshots).toHaveLength(100);
  expect(firstHistory.snapshots[0].sequence).toBe(101);
  expect(firstHistory.nextCursor).toBe('2');
  const secondHistory = await (await history(pagingRequest(`/practice/authoring/history?cursor=${firstHistory.nextCursor}`), pagingContext)).json();
  expect(secondHistory.snapshots.map((row: { sequence: number }) => row.sequence)).toEqual([1]);
  expect(secondHistory.nextCursor).toBeNull();
  expect((await history(pagingRequest('/practice/authoring/history?cursor=invalid'), pagingContext)).status).toBe(400);
  actor(pagingOutsiderId, 'INSTRUCTOR');
  expect((await listObjectives(pagingRequest('/practice/objectives'))).status).toBe(200);
  expect((await listItems(pagingRequest(`/practice/objectives/${oldestObjective.id}/items`), itemContext)).status).toBe(404);
  expect((await readObjective(pagingRequest(`/practice/objectives/${oldestObjective.id}`), itemContext)).status).toBe(404);
  expect((await readItem(pagingRequest(`/practice/items/${oldestItem.id}`), { params: Promise.resolve({ itemId: oldestItem.id }) })).status).toBe(404);
  expect((await previewPins(pagingRequest('/practice/authoring/preview', 'POST', { items: oldRef }), pagingContext)).status).toBe(403);
  expect((await history(pagingRequest('/practice/authoring/history'), pagingContext)).status).toBe(403);
});

test('course and account deletion may cascade private authoring without leaving FK damage', async () => {
  await prisma.course.delete({ where: { id: courseId } });
  expect(await prisma.practiceSnapshot.count({ where: { courseId } })).toBe(0);
  expect(await prisma.practicePublicationRequest.count({ where: { courseId } })).toBe(0);
  expect(await prisma.coursePracticeDraft.count({ where: { courseId } })).toBe(0);
  await prisma.user.delete({ where: { id: teacherId } });
  expect(await prisma.practiceObjective.count({ where: { ownerId: teacherId } })).toBe(0);
  expect(await prisma.practiceItem.count({ where: { ownerId: teacherId } })).toBe(0);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__dbPath);
  try { expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); } finally { db.close(); }
});
