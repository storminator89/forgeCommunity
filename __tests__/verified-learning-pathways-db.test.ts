/** @jest-environment node */
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { GET as listAdmin, POST as createPathway } from '@/app/api/admin/learning-pathways/route';
import { GET as listMine } from '@/app/api/learning-pathways/me/route';
import { POST as joinPathway, DELETE as leavePathway } from '@/app/api/learning-pathways/[pathwayId]/participation/route';
import { courseApprovalFingerprint, courseQuizApprovalRevision, reconcileCourseRewards, reconcileLearnerCourseReward, reconcileUserRewards } from '@/lib/server/rewards';
import { courseContentRevision } from '@/lib/server/course-progress';
import { deleteCourseDependencies } from '@/lib/server/course-deletion';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { Prisma } from '@prisma/client';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  }
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
  const directory = mkdtempSync(join(tmpdir(), 'forge-pathways-'));
  const path = join(directory, 'test.db');
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.DATABASE_URL = `file:${path}`;
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __directory: directory, __path: path,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const quiz = JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Correct?', options: ['yes', 'no'], correctAnswers: [0] }] });
const ctx = (pathwayId: string) => ({ params: Promise.resolve({ pathwayId }) });
const req = (method: string, body?: unknown) => new Request('http://localhost/api/admin/learning-pathways', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const appOrigin = new URL(process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost').origin;
const originRequest = (method: string, path: string, origin: string, body?: unknown) => new Request(`${appOrigin}${path}`, {
  method, headers: { origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const actor = (id: string | null, role = 'USER') => jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
const createBody = (courseIds: string[], requestId = '27305cca-633f-4649-9346-ea856b9d5b6c') =>
  ({ requestId, title: 'Verified sequence', description: 'Two current courses', badgeLabel: 'Pathway complete', courseIds });

async function seedCourse(id: string, price: number | null = null, published = true) {
  const contentId = `quiz-${id}`;
  const approval = courseQuizApprovalRevision([{ id: contentId, courseId: id, parentId: null, type: 'TEXT', content: quiz, order: 1 }]);
  await prisma.course.create({ data: { id, title: `Course ${id}`, description: 'Description', instructorId: 'teacher', price,
    rewardEligible: true, rewardApprovalRevision: approval } });
  await prisma.courseContent.create({ data: { id: contentId, title: 'Quiz', courseId: id, type: 'TEXT', content: quiz, order: 1 } });
  if (published) {
    const payload = { schemaVersion: 1, contents: [{ id: contentId, parentId: null, title: 'Quiz', order: 1, type: 'TEXT', content: quiz }] };
    await prisma.coursePublication.create({ data: { id: `pub-${id}`, courseId: id, sequence: 1, source: 'AUTHOR', payload: JSON.stringify(payload),
      digest: `fixture-${id}`, contentCount: 1 } });
    await prisma.course.update({ where: { id }, data: { activePublicationId: `pub-${id}` } });
  }
}

async function makeCurrentReward(courseId: string) {
  const contentId = `quiz-${courseId}`;
  const content = await prisma.courseContent.findUniqueOrThrow({ where: { id: contentId } });
  await prisma.courseContentProgress.create({ data: { userId: 'member', courseId, contentId, revision: courseContentRevision(content) } });
  await prisma.quizAttempt.create({ data: { userId: 'member', courseId, contentId, revision: courseContentRevision(content),
    passed: true, score: 100, answerDigest: `fixture-${courseId}`, submissionId: `attempt-${courseId}` } });
  await prisma.$transaction(tx => reconcileLearnerCourseReward(tx, 'member', courseId));
}

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET ??= 'test-only-pathway-secret';
  for (const [id, role] of [['admin', 'ADMIN'], ['teacher', 'INSTRUCTOR'], ['member', 'USER'], ['other', 'USER']] as const) {
    await prisma.user.create({ data: { id, email: `${id}@example.invalid`, role } });
  }
  for (const [id, price, published] of [['c1', null, true], ['c2', 0, true], ['paid', 10, true], ['draft', null, false]] as const) {
    await seedCourse(id, price, published);
  }
  for (const id of ['c1', 'c2']) {
    await prisma.enrollment.create({ data: { userId: 'member', courseId: id, completedAt: new Date() } });
    await prisma.courseCompletionRecord.create({ data: { userId: 'member', courseId: id, courseTitle: `Course ${id}`, completedAt: new Date() } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__directory, { recursive: true, force: true });
});

test('strict admin creation validates immutable ordered published free approvals', async () => {
  actor(null);
  expect((await listAdmin()).status).toBe(401);
  expect((await createPathway(req('POST', createBody(['c1', 'c2'])))).status).toBe(401);
  actor('member', 'ADMIN'); // A forged or stale role claim must not authorize creation.
  expect((await createPathway(req('POST', createBody(['c1', 'c2'])))).status).toBe(403);
  actor('admin'); // Stored authority, not the session role hint, is decisive.
  for (const ids of [['c1'], ['c1', 'c1'], ['c1', 'paid'], ['c1', 'draft']]) {
    expect((await createPathway(req('POST', createBody(ids)))).status).toBeGreaterThanOrEqual(400);
  }
  await prisma.course.update({ where: { id: 'c2' }, data: { rewardApprovalRevision: 'stale' } });
  expect((await createPathway(req('POST', createBody(['c1', 'c2'])))).status).toBe(409);
  await prisma.course.update({ where: { id: 'c2' }, data: { rewardApprovalRevision: await prisma.$transaction(tx => courseApprovalFingerprint(tx, 'c2')) } });
  const made = await createPathway(req('POST', createBody(['c1', 'c2'])));
  expect(made.status).toBe(201);
  expect(made.headers.get('Cache-Control')).toBe('private, no-store');
  const { pathway } = await made.json();
  expect(pathway.courses.map((course: { courseId: string }) => course.courseId)).toEqual(['c1', 'c2']);
  expect(JSON.stringify(await (await listAdmin()).json())).not.toContain('member');
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    expect(() => db.prepare('UPDATE "LearningPathway" SET title = ? WHERE id = ?').run('Changed', pathway.id)).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM "LearningPathwayCourse" WHERE pathwayId = ?').run(pathway.id)).toThrow(/immutable/);
    expect(() => db.prepare('INSERT INTO "LearningPathwayCourse" (pathwayId, position, courseId, title) VALUES (?, ?, ?, ?)').run(pathway.id, 2, 'paid', 'Paid')).toThrow(/sealed/);
  } finally { db.close(); }
});

test('admin pathway creation has an exact-payload receipt across retries and concurrent requests', async () => {
  actor('admin');
  const id = '3992abe1-a342-4b38-a834-ce3094bc91ad';
  const body = createBody(['c2', 'c1'], id);
  const first = await createPathway(req('POST', body));
  expect(first.status).toBe(201);
  const firstPathway = (await first.json()).pathway;
  expect((await createPathway(req('POST', body))).status).toBe(200);
  expect((await createPathway(req('POST', body)).then(response => response.json())).pathway).toEqual(firstPathway);
  expect((await createPathway(req('POST', { ...body, title: 'Different title' }))).status).toBe(409);
  expect((await createPathway(req('POST', { ...body, courseIds: ['c1', 'c2'] }))).status).toBe(409);
  expect((await createPathway(req('POST', { ...body, requestId: 'not-a-uuid' }))).status).toBe(400);
  expect(await prisma.learningPathway.count({ where: { id } })).toBe(1);

  const concurrentId = '85a3aeee-099e-43af-b6b7-f21fca186f26';
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => createPathway(req('POST', createBody(['c1', 'c2'], concurrentId)))));
  expect(outcomes.map(response => response.status).sort()).toEqual([200, 200, 200, 201]);
  expect(await prisma.learningPathway.count({ where: { id: concurrentId } })).toBe(1);
});

test('pathway mutations reject cross-origin requests and accept same-origin requests', async () => {
  const path = '/api/admin/learning-pathways';
  const unchanged = await prisma.learningPathway.count();
  actor('admin');
  const deniedBody = createBody(['c1', 'c2'], 'ca31b9d3-d296-41c6-a6fa-b3adfbbe7c03');
  expect((await createPathway(originRequest('POST', path, 'https://attacker.example', deniedBody))).status).toBe(403);
  expect(await prisma.learningPathway.count()).toBe(unchanged);
  // A matching Origin must still reach the idempotent create receipt.
  expect((await createPathway(originRequest('POST', path, appOrigin, createBody(['c1', 'c2'])))).status).toBe(200);

  const pathwayId = createBody(['c1', 'c2']).requestId;
  const participationPath = `/api/learning-pathways/${pathwayId}/participation`;
  await prisma.user.create({ data: { id: 'csrf-member', email: 'csrf-member@example.invalid', role: 'USER' } });
  actor('csrf-member');
  expect((await joinPathway(originRequest('POST', participationPath, 'https://attacker.example'), ctx(pathwayId))).status).toBe(403);
  expect(await prisma.learningPathwayParticipation.count({ where: { userId: 'csrf-member', pathwayId } })).toBe(0);
  expect((await joinPathway(originRequest('POST', participationPath, appOrigin), ctx(pathwayId))).status).toBe(201);
  expect((await leavePathway(originRequest('DELETE', participationPath, 'https://attacker.example'), ctx(pathwayId))).status).toBe(403);
  expect((await prisma.learningPathwayParticipation.findUniqueOrThrow({
    where: { userId_pathwayId: { userId: 'csrf-member', pathwayId } },
  })).optedOutAt).toBeNull();
  expect((await leavePathway(originRequest('DELETE', participationPath, appOrigin), ctx(pathwayId))).status).toBe(200);
});

test('member pathway reads hold role, badge and active credits in a serializable snapshot', async () => {
  actor('member');
  const transaction = jest.spyOn(prisma, '$transaction');
  try {
    expect((await listMine()).status).toBe(200);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } finally { transaction.mockRestore(); }
});

test('private opt-in badge tracks only live reward ledger, revokes and reinstates once', async () => {
  actor('member');
  const initial = await listMine();
  expect(initial.status).toBe(200);
  const pathwayId = (await initial.json()).pathways[0].id as string;
  const joining = await Promise.all(Array.from({ length: 4 }, () => joinPathway(req('POST'), ctx(pathwayId))));
  expect(joining.map(result => result.status).every(status => status === 200 || status === 201)).toBe(true);
  const first = (await joining[0].json()).pathway;
  expect(first).toMatchObject({ creditedCount: 0, requiredCount: 2, participation: { badgeActive: false } });
  expect(await prisma.learningPathwayParticipation.count({ where: { userId: 'member', pathwayId } })).toBe(1);
  await makeCurrentReward('c1');
  expect((await listMine().then(response => response.json())).pathways[0].creditedCount).toBe(1);
  await makeCurrentReward('c2');
  let view = (await listMine().then(response => response.json())).pathways[0];
  expect(view).toMatchObject({ creditedCount: 2, participation: { badgeActive: true } });
  expect(view.history.map((entry: { type: string }) => entry.type)).toEqual(['AWARDED']);
  await prisma.$transaction(tx => reconcileLearnerCourseReward(tx, 'member', 'c2'));
  expect(await prisma.learningPathwayChange.count({ where: { userId: 'member', pathwayId } })).toBe(1);
  await prisma.course.update({ where: { id: 'c2' }, data: { rewardEligible: false } });
  await prisma.$transaction(tx => reconcileCourseRewards(tx, 'c2'));
  view = (await listMine().then(response => response.json())).pathways[0];
  expect(view).toMatchObject({ creditedCount: 1, participation: { badgeActive: false } });
  expect(view.history[0]).toMatchObject({ type: 'REVOKED', reason: 'REWARD_INVALIDATED' });
  actor('other');
  expect((await listMine().then(response => response.json())).pathways.find((row: { id: string }) => row.id === pathwayId))
    .toMatchObject({ unavailable: false, participation: null });
  actor('member');
  await prisma.course.update({ where: { id: 'c2' }, data: { rewardEligible: true } });
  await prisma.$transaction(tx => reconcileCourseRewards(tx, 'c2'));
  view = (await listMine().then(response => response.json())).pathways[0];
  expect(view).toMatchObject({ creditedCount: 2, participation: { badgeActive: true } });
  expect(view.history[0].type).toBe('REINSTATED');
  const left = await leavePathway(req('DELETE'), ctx(pathwayId));
  expect(left.status).toBe(200);
  view = (await left.json()).pathway;
  expect(view).toMatchObject({ creditedCount: 0, participation: { badgeActive: false } });
  expect(view.history[0]).toMatchObject({ type: 'REVOKED', reason: 'OPTED_OUT' });
  expect((await joinPathway(req('POST'), ctx(pathwayId))).status).toBe(200);
  view = (await listMine().then(response => response.json())).pathways[0];
  expect(view).toMatchObject({ creditedCount: 2, participation: { badgeActive: true } });
  expect(view.history[0].type).toBe('REINSTATED');
  expect(await prisma.rewardLedger.aggregate({ where: { userId: 'member', revokedAt: null }, _sum: { points: true } })).toMatchObject({ _sum: { points: 100 } });
  await prisma.user.update({ where: { id: 'member' }, data: { isTestAccount: true } });
  await prisma.$transaction(tx => reconcileUserRewards(tx, 'member'));
  expect((await prisma.learningPathwayParticipation.findUniqueOrThrow({ where: { userId_pathwayId: { userId: 'member', pathwayId } } })).badgeActive).toBe(false);
  expect((await listMine()).status).toBe(403);
  await prisma.user.update({ where: { id: 'member' }, data: { isTestAccount: false } });
  await prisma.$transaction(tx => reconcileUserRewards(tx, 'member'));
  expect((await listMine().then(response => response.json())).pathways[0].history[0].type).toBe('REINSTATED');
  await prisma.user.update({ where: { id: 'member' }, data: { role: 'MODERATOR' } });
  await prisma.$transaction(tx => reconcileUserRewards(tx, 'member'));
  expect((await prisma.learningPathwayParticipation.findUniqueOrThrow({ where: { userId_pathwayId: { userId: 'member', pathwayId } } })).badgeActive).toBe(false);
  await prisma.user.update({ where: { id: 'member' }, data: { role: 'USER' } });
  await prisma.$transaction(tx => reconcileUserRewards(tx, 'member'));
  expect((await listMine().then(response => response.json())).pathways[0].participation.badgeActive).toBe(true);

  // A material quiz edit withdraws reward approval in the same transaction.
  await prisma.courseContent.update({ where: { id: 'quiz-c2' }, data: { content: quiz.replace('Correct?', 'Revised?') } });
  await prisma.$transaction(tx => reconcileCourseRewards(tx, 'c2'));
  expect((await listMine().then(response => response.json())).pathways[0]).toMatchObject({ creditedCount: 1, participation: { badgeActive: false } });
  await prisma.courseContent.update({ where: { id: 'quiz-c2' }, data: { content: quiz } });
  await prisma.$transaction(async tx => {
    await tx.course.update({ where: { id: 'c2' }, data: { rewardEligible: true, rewardApprovalRevision: await courseApprovalFingerprint(tx, 'c2') } });
    await reconcileCourseRewards(tx, 'c2');
  });
  expect((await listMine().then(response => response.json())).pathways[0].participation.badgeActive).toBe(true);
  actor('other');
  expect((await joinPathway(req('POST'), ctx(pathwayId))).status).toBe(201);
  actor('member');
  await prisma.$transaction(async tx => {
    await deleteCourseDependencies(tx, ['c2']);
    await tx.course.delete({ where: { id: 'c2' } });
  });
  expect((await listMine().then(response => response.json())).pathways[0]).toMatchObject({
    courses: [{ courseId: 'c1', available: true, isEnrolled: true }, { courseId: 'c2', available: false }],
    unavailable: true, creditedCount: 1, participation: { badgeActive: false },
  });
  actor('admin');
  expect((await listAdmin().then(response => response.json())).pathways.find((row: { id: string }) => row.id === pathwayId))
    .toMatchObject({ unavailable: true });
  const db = new DatabaseSync(jest.requireMock('@/lib/prisma').__path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    expect(() => db.prepare('UPDATE "LearningPathwayChange" SET reason = ? WHERE pathwayId = ?').run('OPTED_OUT', pathwayId)).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM "LearningPathwayChange" WHERE pathwayId = ?').run(pathwayId)).toThrow(/append-only/);
  } finally { db.close(); }
  actor('other');
  const other = (await listMine().then(response => response.json())).pathways[0];
  expect(other.participation).not.toBeNull();
  expect(other.unavailable).toBe(true);
  expect(other.creditedCount).toBe(0);
  expect(other.history).toEqual([]);
  expect((await leavePathway(req('DELETE'), ctx(pathwayId))).status).toBe(200);
  expect((await joinPathway(req('POST'), ctx(pathwayId))).status).toBe(409);
  await prisma.user.create({ data: { id: 'late', email: 'late@example.invalid', role: 'USER' } });
  actor('late');
  expect((await listMine().then(response => response.json())).pathways).toEqual([]);
  expect((await joinPathway(req('POST'), ctx(pathwayId))).status).toBe(409);
  actor('other');
  await expect(prisma.learningPathwayParticipation.delete({ where: {
    userId_pathwayId: { userId: 'other', pathwayId },
  } })).rejects.toThrow();
  await prisma.user.delete({ where: { id: 'other' } });
  expect(await prisma.learningPathwayParticipation.count({ where: { userId: 'other' } })).toBe(0);
});
