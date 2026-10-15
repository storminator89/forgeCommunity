/** @jest-environment node */
import { rmSync } from 'node:fs';
import prisma from '@/lib/prisma';
import { mutateDraft, publicationDigest, publishDraft, readAuthoring, restoreDraft, reviewPublication, type CoursePayload } from '@/lib/server/course-authoring';
import { assertCurrentPrerequisites } from '@/lib/server/course-prerequisites';
import { completionState, courseContentRevision } from '@/lib/server/course-progress';
import { chapterReleaseDates } from '@/lib/course-release';
jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    }
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => 'certificate-123' }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
// Jest's CommonJS runner cannot require the ESM-only jsdom dependency used by
// the sanitizer. These fixtures are already sanitized; database/API behavior
// remains real and sanitizer coverage lives in its dedicated suite.
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.trim(),
  sanitizeCourseTextContentServer: (value: string) => value,
}));
jest.mock('@/lib/server/certificate-pdf', () => ({ certificatePdfResponse: () => new Response('certificate', { status: 200 }) }));
jest.mock('@/lib/server/course-assets', () => ({
  CourseAssetError: class extends Error { status = 400 },
  extractCourseAssetUrls: () => [], assertCanReferenceCourseAsset: async () => {},
}), { virtual: true });
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-chapter-author-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((item: string) => item.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
    const integrity = db.prepare('PRAGMA foreign_key_check').all();
    if (integrity.length) throw new Error(`Foreign key check failed: ${JSON.stringify(integrity)}`);
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, __dbPath: path,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});


const owner = { id: 'release-author', role: 'INSTRUCTOR' as const };
let sequence = 0;
async function seed() {
  const n = ++sequence;
  const courseId = `chapter-author-course-${n}`;
  const publicationId = `chapter-author-publication-${n}`;
  const rootA = `chapter-author-root-a-${n}`;
  const rootB = `chapter-author-root-b-${n}`;
  const child = `chapter-author-child-${n}`;
  const payload: CoursePayload = { schemaVersion: 1, title: 'Werkstatt', description: 'Praxis',
    startDate: '2099-01-01', endDate: '2099-12-31', imageUrl: null, contents: [
      { id: rootA, parentId: null, order: 1, title: 'Kapitel A', type: 'TEXT', content: '<p>Kapitel A</p>' },
      { id: rootB, parentId: null, order: 2, title: 'Kapitel B', type: 'TEXT', content: '<p>Kapitel B</p>' },
      { id: child, parentId: rootA, order: 1, title: 'Lektion A', type: 'TEXT', content: '<p>Material</p>' },
    ] };
  await prisma.course.create({ data: { id: courseId, instructorId: owner.id, title: payload.title, description: payload.description } });
  for (const node of payload.contents) await prisma.courseContent.create({ data: { ...node, type: 'TEXT', courseId } });
  await prisma.coursePublication.create({ data: { id: publicationId, courseId, sequence: 1, source: 'AUTHOR',
    payload: JSON.stringify(payload), digest: publicationDigest(payload), contentCount: 3 } });
  await prisma.course.update({ where: { id: courseId }, data: { activePublicationId: publicationId } });
  await prisma.courseDraft.create({ data: { courseId, basePublicationId: publicationId, revision: 0,
    payload: JSON.stringify(payload), digest: publicationDigest(payload) } });
  await prisma.enrollment.create({ data: { userId: 'release-learner', courseId } });
  return { courseId, publicationId, rootA, rootB, child, payload };
}

beforeAll(async () => {
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.DATABASE_URL = `file:${jest.requireMock('@/lib/prisma').__dbPath}`;
  process.env.NEXTAUTH_SECRET = 'test-only-chapter-author-secret';
  await prisma.user.create({ data: { ...owner, email: 'chapter-author@example.invalid' } });
  await prisma.user.create({ data: { id: 'release-learner', email: 'chapter-learner@example.invalid', role: 'USER' } });
});
afterAll(async () => { await prisma.$disconnect(); rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true }); });

test('validated optional root schedules stay private until reviewed and explicitly published', async () => {
  const f = await seed();
  const initial = await readAuthoring(f.courseId, owner);
  expect(initial.draft.payload.contents.every(node => node.releaseOn === undefined)).toBe(true);
  const changed = await mutateDraft(f.courseId, owner, 0, { kind: 'setReleaseOn', id: f.rootA, releaseOn: '2026-11-01' });
  expect(changed.draft.revision).toBe(1);
  expect(changed.draft.digest).toBe(publicationDigest(changed.draft.payload));
  expect(changed.activePublication?.id).toBe(f.publicationId);
  const published = await prisma.coursePublication.findUniqueOrThrow({ where: { id: f.publicationId } });
  expect(published.payload).toBe(JSON.stringify(f.payload));
  expect(chapterReleaseDates(JSON.parse(published.payload).contents).get(f.child)).toBeNull();
  const review = await reviewPublication(f.courseId, owner, 1, f.publicationId);
  expect(review.ready).toBe(true);
  expect(review.impact.releaseScheduleChanged).toEqual(expect.arrayContaining([
    { id: f.rootA, title: 'Kapitel A', before: null, after: '2026-11-01' },
    { id: f.child, title: 'Lektion A', before: null, after: '2026-11-01' },
  ]));
  expect(review.impact.issuedCertificatesStayValid).toBe(true);
  expect(review.impact).toMatchObject({ completionMayChange: false, rewardsMayChange: false });
  await expect(mutateDraft(f.courseId, owner, 0, { kind: 'setReleaseOn', id: f.rootA, releaseOn: null })).rejects.toMatchObject({ status: 412 });
  for (const releaseOn of ['2026-02-30', '2026-11-01T00:00:00Z', 1, undefined]) {
    await expect(mutateDraft(f.courseId, owner, 1, { kind: 'setReleaseOn', id: f.rootA, releaseOn })).rejects.toMatchObject({ status: 400 });
  }
  await expect(mutateDraft(f.courseId, owner, 1, { kind: 'setReleaseOn', id: f.child, releaseOn: '2026-11-01' })).rejects.toMatchObject({ status: 400 });
  await expect(mutateDraft(f.courseId, { id: 'release-learner', role: 'ADMIN' }, 1, { kind: 'setReleaseOn', id: f.rootA, releaseOn: null })).rejects.toMatchObject({ status: 403 });
});

test('publishing a date changes access, preserves immutable payload/progress bytes and restores old immediate payloads', async () => {
  const f = await seed();
  for (const id of [f.child, f.rootB]) {
    const content = await prisma.courseContent.findUniqueOrThrow({ where: { id } });
    await prisma.courseContentProgress.create({ data: { userId: 'release-learner', courseId: f.courseId, contentId: id, revision: courseContentRevision(content) } });
  }
  const progress = await prisma.courseContentProgress.findMany({ where: { courseId: f.courseId }, orderBy: { contentId: 'asc' } });
  const before = Date.parse('2026-10-31T23:59:59.999Z');
  const at = before + 1;
  await mutateDraft(f.courseId, owner, 0, { kind: 'setReleaseOn', id: f.rootA, releaseOn: '2026-11-01' });
  await expect(prisma.$transaction(tx => assertCurrentPrerequisites(tx, 'release-learner', f.courseId, f.child, f.publicationId, before))).resolves.toBeUndefined();
  const result = await publishDraft(f.courseId, owner, 1, f.publicationId, `chapter-author-request-${sequence}`);
  expect(result.publication.id).not.toBe(f.publicationId);
  await expect(prisma.$transaction(tx => assertCurrentPrerequisites(tx, 'release-learner', f.courseId, f.child, result.publication.id, before))).rejects.toMatchObject({ status: 423 });
  await expect(prisma.$transaction(tx => assertCurrentPrerequisites(tx, 'release-learner', f.courseId, f.child, result.publication.id, at))).resolves.toBeUndefined();
  expect(await prisma.$transaction(tx => completionState(tx, 'release-learner', f.courseId, before))).toMatchObject({ complete: true, canIssueCertificate: false });
  expect(await prisma.$transaction(tx => completionState(tx, 'release-learner', f.courseId, at))).toMatchObject({ complete: true, canIssueCertificate: true });
  expect(await prisma.courseContentProgress.findMany({ where: { courseId: f.courseId }, orderBy: { contentId: 'asc' } })).toEqual(progress);
  expect((await prisma.coursePublication.findUniqueOrThrow({ where: { id: f.publicationId } })).payload).toBe(JSON.stringify(f.payload));
  const restored = await restoreDraft(f.courseId, owner, 1, f.publicationId);
  expect(restored.activePublication?.id).toBe(result.publication.id);
  expect(restored.draft.payload).toEqual(f.payload);
  expect((await reviewPublication(f.courseId, owner, restored.draft.revision, result.publication.id)).impact.releaseScheduleChanged).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: f.child, before: '2026-11-01', after: null }),
  ]));
});

test('moves inherit the destination date, remove hidden root dates and remain reviewable', async () => {
  const f = await seed();
  await mutateDraft(f.courseId, owner, 0, { kind: 'setReleaseOn', id: f.rootA, releaseOn: '2026-11-01' });
  const first = await publishDraft(f.courseId, owner, 1, f.publicationId, `chapter-move-request-${sequence}`);
  const moved = await mutateDraft(f.courseId, owner, 1, { kind: 'moveNode', id: f.child, parentId: f.rootB, afterId: null });
  expect(chapterReleaseDates(moved.draft.payload.contents).get(f.child)).toBeNull();
  expect((await reviewPublication(f.courseId, owner, 2, first.publication.id)).impact.releaseScheduleChanged).toEqual([
    { id: f.child, title: 'Lektion A', before: '2026-11-01', after: null },
  ]);
  const nested = await mutateDraft(f.courseId, owner, 2, { kind: 'moveNode', id: f.rootA, parentId: f.rootB, afterId: f.child });
  expect(nested.draft.payload.contents.find(node => node.id === f.rootA)?.releaseOn).toBeUndefined();
  const promoted = await mutateDraft(f.courseId, owner, 3, { kind: 'moveNode', id: f.rootA, parentId: null, afterId: f.rootB });
  expect(promoted.draft.payload.contents.find(node => node.id === f.rootA)?.releaseOn).toBeUndefined();
  const cleared = await mutateDraft(f.courseId, owner, 4, { kind: 'setReleaseOn', id: f.rootA, releaseOn: '2026-11-01' });
  const immediate = await mutateDraft(f.courseId, owner, cleared.draft.revision, { kind: 'setReleaseOn', id: f.rootA, releaseOn: null });
  expect(immediate.draft.payload.contents.find(node => node.id === f.rootA)).not.toHaveProperty('releaseOn');
});
