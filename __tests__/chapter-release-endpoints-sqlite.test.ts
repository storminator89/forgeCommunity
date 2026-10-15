/** @jest-environment node */

import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { GET as readContents } from '@/app/api/courses/[courseId]/contents/route';
import { GET as readProgress, PATCH as markProgress } from '@/app/api/courses/[courseId]/progress/route';
import { POST as issueCertificate } from '@/app/api/courses/[courseId]/certificate/route';
import { GET as downloadCertificate } from '@/app/api/certificates/[certificateId]/download/route';
import { GET as verifyCertificate } from '@/app/api/verify-certificate/[certificateId]/route';
import { POST as submitQuiz } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/route';
import { GET as readEvidence } from '@/app/api/courses/[courseId]/contents/[contentId]/attempts/[submissionId]/evidence/route';
import { GET as readAssignment, POST as submitAssignment } from '@/app/api/courses/[courseId]/contents/[contentId]/assignment/route';
import { GET as getAsset, HEAD as headAsset } from '@/app/api/courses/[courseId]/assets/[assetId]/route';
import { GET as h5pMetadata } from '@/app/api/h5p/contents/[id]/route';
import { GET as h5pEmbed } from '@/app/h5p/embed/[id]/route';
import { GET as h5pAsset, HEAD as h5pHead } from '@/app/api/h5p/assets/[id]/[token]/[...path]/route';
import { contentVersionToken, courseContentRevision } from '@/lib/server/course-progress';
import { saveCourseAsset } from '@/lib/server/course-assets';
import { createH5PAssetToken } from '@/lib/server/h5p-access';
import { validateH5PPackage } from '@/lib/server/h5p-archive';
import { storeH5PPackage } from '@/lib/server/h5p-storage';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => require('next-auth/next').getServerSession(...args) }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('uuid', () => ({ v4: () => require('node:crypto').randomUUID() }));
// Sanitization has its own suite. Keep the actual endpoint transactions,
// release evaluator, cryptographic tokens, storage, and SQLite adapter here.
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.trim(),
  sanitizeCourseTextContentServer: (value: string) => value,
}));
jest.mock('@/lib/server/certificate-pdf', () => ({
  certificatePdfResponse: () => new Response('certificate', { status: 200 }),
}));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-chapter-release-api-'));
  const filename = join(directory, 'test.db');
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid SQLite fixture');
  } finally { db.close(); }
  return { __esModule: true, __directory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${filename}` }) }) };
});

const RELEASE = '2030-02-03';
const MIDNIGHT = Date.parse(`${RELEASE}T00:00:00.000Z`);
const actors = [
  { id: 'release-teacher', role: 'INSTRUCTOR' as const },
  { id: 'release-learner', role: 'USER' as const },
  { id: 'release-admin', role: 'ADMIN' as const },
  { id: 'release-other-teacher', role: 'INSTRUCTOR' as const },
  { id: 'release-moderator', role: 'MODERATOR' as const },
  { id: 'release-demoted-admin', role: 'USER' as const },
  { id: 'release-unenrolled', role: 'USER' as const },
];
const learner = actors[1].id;
const originalEnv = {
  DATABASE_PROVIDER: process.env.DATABASE_PROVIDER,
  DATABASE_URL: process.env.DATABASE_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  COURSE_ASSET_STORAGE_PATH: process.env.COURSE_ASSET_STORAGE_PATH,
  H5P_STORAGE_PATH: process.env.H5P_STORAGE_PATH,
};
let storage: string;
let serial = 0;
let clock: jest.SpiedFunction<typeof Date.now>;

type Node = {
  id: string; parentId: string | null; title: string; type: 'TEXT' | 'ASSIGNMENT' | 'H5P';
  content: string; order: number; releaseOn?: string | null; prerequisiteIds?: string[];
};
type Fixture = { courseId: string; publicationId: string; nodes: Node[]; sequence: number };
function viewer(id: string | null = learner, role?: string) {
  const account = actors.find(actor => actor.id === id);
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role: role ?? account?.role ?? 'USER' } } as never : null);
}
function request(url: string, method = 'GET', body?: object, headers?: Record<string, string>) {
  const nextUrl = new URL(url, 'http://localhost');
  return Object.assign(new Request(nextUrl, { method, ...(body && { body: JSON.stringify(body) }), headers }), { nextUrl }) as never;
}
const courseContext = (fixture: Fixture) => ({ params: Promise.resolve({ courseId: fixture.courseId }) });
const contentContext = (fixture: Fixture, node: Node) => ({ params: Promise.resolve({ courseId: fixture.courseId, contentId: node.id }) });
const endpoint = (fixture: Fixture, suffix: string) => `/api/courses/${fixture.courseId}${suffix}`;
function node(id: string, patch: Partial<Node> = {}): Node {
  const result = { id, parentId: null, title: id, type: 'TEXT' as const, content: `<p>Private ${id}</p>`, order: 1, ...patch };
  if (result.releaseOn === null) delete result.releaseOn;
  return result;
}
async function publish(fixture: Fixture) {
  fixture.sequence += 1;
  fixture.publicationId = `${fixture.courseId}-publication-${fixture.sequence}`;
  const payload = JSON.stringify({ schemaVersion: 1, title: fixture.courseId, description: 'Release endpoint fixture',
    startDate: null, endDate: null, imageUrl: null, contents: fixture.nodes });
  await prisma.coursePublication.create({ data: { id: fixture.publicationId, courseId: fixture.courseId,
    sequence: fixture.sequence, source: 'AUTHOR', payload, digest: createHash('sha256').update(payload).digest('hex'), contentCount: fixture.nodes.length } });
  await prisma.course.update({ where: { id: fixture.courseId }, data: { activePublicationId: fixture.publicationId } });
}
async function seed(build: (prefix: string) => Node[]): Promise<Fixture> {
  const courseId = `release-course-${++serial}`;
  const fixture: Fixture = { courseId, publicationId: '', sequence: 0, nodes: build(courseId) };
  await prisma.course.create({ data: { id: courseId, instructorId: actors[0].id, title: courseId, description: 'Release endpoint fixture' } });
  // Create parents before descendants so this also exercises real FK checks.
  for (const { releaseOn: _release, prerequisiteIds: _prerequisites, ...content } of fixture.nodes) {
    await prisma.courseContent.create({ data: { ...content, courseId } });
  }
  await prisma.enrollment.createMany({ data: actors.filter(actor => actor.id !== 'release-unenrolled').map(actor => ({ courseId, userId: actor.id })) });
  await publish(fixture);
  return fixture;
}
function flatten(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.flatMap(row => [row, ...flatten((row.subContents ?? []) as Array<Record<string, unknown>>)]);
}
async function contents(fixture: Fixture) {
  const response = await readContents(request(endpoint(fixture, '/contents')), courseContext(fixture));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return flatten(await response.json());
}
function tokenBody(fixture: Fixture, content: Node) {
  return { publicationId: fixture.publicationId, contentVersionToken: contentVersionToken(fixture.publicationId, content) };
}
const quiz = JSON.stringify({ passingScore: 70, questions: [
  { id: 'question-1', type: 'SINGLE_CHOICE', question: 'Which?', options: ['No', 'Yes'], correctAnswers: [1], explanation: 'Private answer explanation' },
] });

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'forge-release-bytes-'));
  process.env.DATABASE_PROVIDER = 'sqlite';
  process.env.DATABASE_URL = `file:${join(jest.requireMock('@/lib/prisma').__directory, 'test.db')}`;
  process.env.NEXTAUTH_SECRET = 'test-only-release-secret';
  process.env.COURSE_ASSET_STORAGE_PATH = join(storage, 'images');
  process.env.H5P_STORAGE_PATH = join(storage, 'h5p');
  await prisma.user.createMany({ data: actors.map(actor => ({ ...actor, email: `${actor.id}@example.invalid`, name: actor.id })) });
});
beforeEach(() => {
  // Mock only the evaluator's clock, leaving SQLite/Prisma's async timers real.
  clock = jest.spyOn(Date, 'now').mockReturnValue(MIDNIGHT - 1);
  viewer();
});
afterEach(() => { clock.mockRestore(); });
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__directory, { recursive: true, force: true });
  await rm(storage, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('withholds every nested body and execution token until exactly midnight UTC, without prerequisites', async () => {
  const fixture = await seed(prefix => [
    node(`${prefix}-chapter`, { releaseOn: RELEASE }),
    node(`${prefix}-section`, { parentId: `${prefix}-chapter` }),
    node(`${prefix}-lesson`, { parentId: `${prefix}-section` }),
    node(`${prefix}-quiz`, { parentId: `${prefix}-section`, content: quiz, order: 2 }),
    node(`${prefix}-open`, { order: 2 }),
  ]);
  const before = await contents(fixture);
  for (const content of before.filter(row => row.id !== fixture.nodes[4].id)) {
    expect(content).toMatchObject({ locked: true, releaseLocked: true, releaseOn: RELEASE,
      content: '', contentVersionToken: null, prerequisiteIds: [], missingPrerequisites: [] });
  }
  expect(before.find(row => row.id === fixture.nodes[4].id)).toMatchObject({ locked: false, releaseLocked: false, releaseOn: null });
  expect(JSON.stringify(before)).not.toContain('Private answer explanation');
  clock.mockReturnValue(MIDNIGHT);
  const released = await contents(fixture);
  for (const content of released) {
    expect(content).toMatchObject({ locked: false, releaseLocked: false });
    expect(content.content).not.toBe('');
    expect(content.contentVersionToken).toEqual(expect.any(String));
  }
  const releasedQuiz = released.find(row => row.id === fixture.nodes[3].id)!;
  expect(JSON.stringify(releasedQuiz)).not.toMatch(/correctAnswers|Private answer explanation/);
});

test.each([
  [actors[0].id, 'INSTRUCTOR', false], [actors[2].id, 'ADMIN', false],
  [actors[3].id, 'INSTRUCTOR', true], [actors[4].id, 'MODERATOR', true],
  [actors[5].id, 'ADMIN', true],
])('applies current editor preview authority, while release-gating completion for %s, session %s', async (id, role, locked) => {
  const fixture = await seed(prefix => [node(`${prefix}-chapter`, { releaseOn: RELEASE })]);
  viewer(id as string, role as string);
  const [content] = await contents(fixture);
  if (locked) expect(content).toMatchObject({ locked: true, content: '', contentVersionToken: null });
  else {
    expect(content.content).toBe(fixture.nodes[0].content);
    expect(content.contentVersionToken).toEqual(expect.any(String));
  }
  const leaf = fixture.nodes[0];
  const mark = () => markProgress(request(endpoint(fixture, '/progress'), 'PATCH', {
    contentId: leaf.id, completed: true, ...tokenBody(fixture, leaf),
  }), courseContext(fixture));
  // Preview privileges never waive the release gate for enrolled execution.
  expect((await mark()).status).toBe(423);
  expect(await prisma.courseContentProgress.count({ where: { courseId: fixture.courseId } })).toBe(0);
  clock.mockReturnValue(MIDNIGHT);
  expect((await mark()).status).toBe(200);
});

test('rejects a direct completion request with a valid token before release, and accepts it at the UTC boundary', async () => {
  const fixture = await seed(prefix => [node(`${prefix}-chapter`, { releaseOn: RELEASE }), node(`${prefix}-leaf`, { parentId: `${prefix}-chapter` })]);
  const leaf = fixture.nodes[1];
  const mark = () => markProgress(request(endpoint(fixture, '/progress'), 'PATCH', { contentId: leaf.id, completed: true, ...tokenBody(fixture, leaf) }), courseContext(fixture));
  expect((await mark()).status).toBe(423);
  expect(await prisma.courseContentProgress.count({ where: { courseId: fixture.courseId } })).toBe(0);
  expect((await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: learner, courseId: fixture.courseId } } })).completedAt).toBeNull();
  clock.mockReturnValue(MIDNIGHT);
  expect((await mark()).status).toBe(200);
  expect(await prisma.courseContentProgress.count({ where: { courseId: fixture.courseId } })).toBe(1);
});

test('earned same-revision credit survives rescheduling and unlocks dependants; new certificates still wait for release', async () => {
  const fixture = await seed(prefix => [
    node(`${prefix}-future`),
    node(`${prefix}-dependent`, { order: 2, prerequisiteIds: [`${prefix}-future`] }),
  ]);
  for (const content of fixture.nodes) expect((await markProgress(request(endpoint(fixture, '/progress'), 'PATCH', {
    contentId: content.id, completed: true, ...tokenBody(fixture, content),
  }), courseContext(fixture))).status).toBe(200);
  const earned = await prisma.courseContentProgress.findMany({ where: { courseId: fixture.courseId }, orderBy: { contentId: 'asc' } });
  fixture.nodes[0].releaseOn = RELEASE;
  await publish(fixture);
  const progress = () => readProgress(request(endpoint(fixture, '/progress')), courseContext(fixture));
  const certificate = () => issueCertificate(request(endpoint(fixture, '/certificate'), 'POST'), courseContext(fixture));
  expect(await (await progress()).json()).toMatchObject({ complete: true, canIssueCertificate: false, completedContentIds: expect.arrayContaining(fixture.nodes.map(content => content.id)), hasCertificate: false });
  expect((await certificate()).status).toBe(403);
  expect(await prisma.certificate.count({ where: { courseId: fixture.courseId } })).toBe(0);
  const before = await contents(fixture);
  expect(before.find(row => row.id === fixture.nodes[0].id)).toMatchObject({ locked: true, releaseLocked: true, content: '', contentVersionToken: null });
  expect(before.find(row => row.id === fixture.nodes[1].id)).toMatchObject({ locked: false, releaseLocked: false, missingPrerequisites: [] });
  expect((await markProgress(request(endpoint(fixture, '/progress'), 'PATCH', { contentId: fixture.nodes[0].id, completed: true, ...tokenBody(fixture, fixture.nodes[0]) }), courseContext(fixture))).status).toBe(423);
  expect((await markProgress(request(endpoint(fixture, '/progress'), 'PATCH', { contentId: fixture.nodes[0].id, completed: false, ...tokenBody(fixture, fixture.nodes[0]) }), courseContext(fixture))).status).toBe(423);
  clock.mockReturnValue(MIDNIGHT);
  expect(await (await progress()).json()).toMatchObject({ complete: true, canIssueCertificate: true, completedContentIds: expect.arrayContaining(fixture.nodes.map(content => content.id)) });
  expect((await certificate()).status).toBe(200);
  const saved = await prisma.certificate.findFirstOrThrow({ where: { userId: learner, courseId: fixture.courseId } });
  const completedAt = (await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: learner, courseId: fixture.courseId } } })).completedAt;
  fixture.nodes[0].releaseOn = '2030-02-04';
  await publish(fixture);
  expect(await (await progress()).json()).toMatchObject({ complete: true, canIssueCertificate: false, completedContentIds: expect.arrayContaining(fixture.nodes.map(content => content.id)), hasCertificate: true });
  expect((await certificate()).status).toBe(200);
  expect(await prisma.certificate.findFirstOrThrow({ where: { userId: learner, courseId: fixture.courseId } })).toEqual(saved);
  expect((await prisma.enrollment.findUniqueOrThrow({ where: { userId_courseId: { userId: learner, courseId: fixture.courseId } } })).completedAt).toEqual(completedAt);
  expect(await prisma.courseContentProgress.findMany({ where: { courseId: fixture.courseId }, orderBy: { contentId: 'asc' } })).toEqual(earned);
  const certificateContext = { params: Promise.resolve({ certificateId: saved.id }) };
  expect((await downloadCertificate(request(`/api/certificates/${saved.id}/download`), certificateContext)).status).toBe(200);
  const verification = await verifyCertificate(request(`/api/verify-certificate/${saved.id}`), certificateContext);
  expect(verification.status).toBe(200);
  expect(await verification.json()).toMatchObject({ valid: true, certificate: { id: saved.id } });
});

test('gates direct quiz submissions and evidence, while keeping an already committed retry a stable receipt', async () => {
  const fixture = await seed(prefix => [node(`${prefix}-chapter`, { releaseOn: RELEASE }), node(`${prefix}-quiz`, { parentId: `${prefix}-chapter`, content: quiz })]);
  const content = fixture.nodes[1];
  const submissionId = `${fixture.courseId}-attempt`;
  const body = { submissionId, answers: { 'question-1': [1] }, confidenceByQuestion: { 'question-1': 'SURE' }, ...tokenBody(fixture, content) };
  const submit = (value = body) => submitQuiz(request(endpoint(fixture, `/contents/${content.id}/attempts`), 'POST', value), contentContext(fixture, content));
  const evidence = () => readEvidence(request(endpoint(fixture, `/contents/${content.id}/attempts/${submissionId}/evidence`)),
    { params: Promise.resolve({ courseId: fixture.courseId, contentId: content.id, submissionId }) });
  expect((await submit()).status).toBe(423);
  expect((await evidence()).status).toBe(423);
  expect(await prisma.quizAttempt.count({ where: { courseId: fixture.courseId } })).toBe(0);
  expect(await prisma.quizAttemptItemEvidence.count()).toBe(0);
  clock.mockReturnValue(MIDNIGHT);
  const passed = await submit();
  expect(passed.status).toBe(200);
  expect(await passed.json()).toEqual({ score: 100, passed: true });
  const recorded = await evidence();
  expect(recorded.status).toBe(200);
  expect(await recorded.json()).toMatchObject({ evidenceRecorded: true, confidenceRecorded: true });
  fixture.nodes[0].releaseOn = '2030-02-04';
  await publish(fixture);
  expect((await evidence()).status).toBe(423);
  expect((await submit({ ...body, ...tokenBody(fixture, content), submissionId: `${submissionId}-new` })).status).toBe(423);
  expect((await submit()).status).toBe(200);
  expect(await prisma.quizAttempt.count({ where: { courseId: fixture.courseId } })).toBe(1);
  expect(await prisma.courseContentProgress.count({ where: { courseId: fixture.courseId } })).toBe(1);
  const progress = await readProgress(request(endpoint(fixture, '/progress')), courseContext(fixture));
  expect(await progress.json()).toMatchObject({ complete: true, canIssueCertificate: false, completedContentIds: [content.id] });
});

test('gates assignment history and new submissions, without invalidating an existing submission receipt', async () => {
  const assignment = JSON.stringify({ prompt: 'Private assignment prompt', passingScore: 70 });
  const fixture = await seed(prefix => [node(`${prefix}-chapter`, { releaseOn: RELEASE }),
    node(`${prefix}-assignment`, { parentId: `${prefix}-chapter`, type: 'ASSIGNMENT', content: assignment })]);
  const content = fixture.nodes[1];
  const url = endpoint(fixture, `/contents/${content.id}/assignment`);
  const body = { requestId: `${fixture.courseId}-request`, response: 'My solution', ...tokenBody(fixture, content) };
  const submit = (value = body) => submitAssignment(request(url, 'POST', value), contentContext(fixture, content));
  const read = () => readAssignment(request(url), contentContext(fixture, content));
  expect((await read()).status).toBe(423);
  expect((await submit()).status).toBe(423);
  expect(await prisma.assignmentSubmission.count({ where: { courseId: fixture.courseId } })).toBe(0);
  clock.mockReturnValue(MIDNIGHT);
  const available = await read();
  expect(available.status).toBe(200);
  expect(await available.json()).toMatchObject({ maySubmit: true, contentVersionToken: body.contentVersionToken });
  const committed = await submit();
  expect(committed.status).toBe(201);
  const receipt = await committed.json();
  fixture.nodes[0].releaseOn = '2030-02-04';
  await publish(fixture);
  expect((await read()).status).toBe(423);
  expect((await submit({ ...body, ...tokenBody(fixture, content), requestId: `${body.requestId}-new` })).status).toBe(423);
  const retried = await submit();
  expect(retried.status).toBe(201);
  expect(await retried.json()).toMatchObject({ id: receipt.id, unchanged: true });
  expect(await prisma.assignmentSubmission.count({ where: { courseId: fixture.courseId } })).toBe(1);
  expect(await prisma.courseContentProgress.count({ where: { courseId: fixture.courseId } })).toBe(0);
});

test('gates H5P metadata, embed and pre-issued token GET/HEAD/range reads, and allows an unlocked shared reference', async () => {
  const archive = zipSync({
    'h5p.json': strToU8(JSON.stringify({ title: 'Private release H5P', mainLibrary: 'H5P.Example', preloadedDependencies: [{ machineName: 'H5P.Example', majorVersion: 1, minorVersion: 0 }] })),
    'content/content.json': strToU8('{"private":"release-bytes"}'),
    'H5P.Example-1.0/library.json': strToU8(JSON.stringify({ title: 'Example', machineName: 'H5P.Example', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 1, preloadedJs: [{ path: 'example.js' }] })),
    'H5P.Example-1.0/example.js': strToU8('H5P.Example = function () {};'),
  });
  const imported = await storeH5PPackage(validateH5PPackage(archive), actors[0].id);
  const fixture = await seed(prefix => [node(`${prefix}-chapter`, { releaseOn: RELEASE }),
    node(`${prefix}-h5p`, { parentId: `${prefix}-chapter`, type: 'H5P', content: imported.embedUrl })]);
  const context = { params: Promise.resolve({ id: imported.id }) };
  const metadata = () => h5pMetadata(request(`/api/h5p/contents/${imported.id}`), context);
  const embed = () => h5pEmbed(request(imported.embedUrl), context);
  // A token is a capability to request reauthorization, not a release bypass.
  const token = createH5PAssetToken(imported.id, learner, MIDNIGHT - 60_000);
  const asset = (head = false, range = false, accessToken = token) => (head ? h5pHead : h5pAsset)(
    request(`/api/h5p/assets/${imported.id}/${accessToken}/content/content.json`, head ? 'HEAD' : 'GET', undefined, range ? { Range: 'bytes=0-3' } : undefined),
    { params: Promise.resolve({ id: imported.id, token: accessToken, path: ['content', 'content.json'] }) });
  expect((await metadata()).status).toBe(403);
  expect((await embed()).status).toBe(403);
  for (const response of [await asset(), await asset(true), await asset(false, true)]) expect(response.status).toBe(403);
  viewer(actors[0].id);
  expect((await embed()).status).toBe(200);
  viewer(actors[2].id);
  expect((await metadata()).status).toBe(200);
  viewer(actors[5].id, 'ADMIN');
  expect((await metadata()).status).toBe(403);
  const staleAdminToken = createH5PAssetToken(imported.id, actors[5].id);
  expect((await asset(true, false, staleAdminToken)).status).toBe(403);
  viewer();
  clock.mockReturnValue(MIDNIGHT);
  expect((await metadata()).status).toBe(200);
  expect((await embed()).status).toBe(200);
  expect((await asset()).status).toBe(200);
  expect((await asset(true)).status).toBe(200);
  expect((await asset(false, true)).status).toBe(206);
  clock.mockReturnValue(MIDNIGHT - 1);
  const shared = node(`${fixture.courseId}-shared`, { type: 'H5P', content: imported.embedUrl, order: 2 });
  fixture.nodes.push(shared);
  await prisma.courseContent.create({ data: { ...shared, courseId: fixture.courseId } });
  await publish(fixture);
  expect((await metadata()).status).toBe(200);
  expect((await asset(true)).status).toBe(200);
});

test('gates private image GET/HEAD while preserving author preview, shared unlocked references and public covers', async () => {
  const fixture = await seed(prefix => [node(`${prefix}-chapter`, { releaseOn: RELEASE }), node(`${prefix}-image`, { parentId: `${prefix}-chapter` })]);
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#2563eb' } }).png().toBuffer();
  const stored = await saveCourseAsset(fixture.courseId, { id: actors[0].id }, new File([new Uint8Array(png)], 'private.png', { type: 'image/png' }));
  fixture.nodes[1].content = `<p><img src="${stored.url}"></p>`;
  await prisma.courseContent.update({ where: { id: fixture.nodes[1].id }, data: { content: fixture.nodes[1].content } });
  await publish(fixture);
  const image = (head = false) => (head ? headAsset : getAsset)(request(stored.url, head ? 'HEAD' : 'GET'),
    { params: Promise.resolve({ courseId: fixture.courseId, assetId: stored.id }) });
  expect((await image()).status).toBe(404);
  expect((await image(true)).status).toBe(404);
  viewer(actors[0].id);
  expect((await image()).status).toBe(200);
  viewer(actors[2].id);
  expect((await image(true)).status).toBe(200);
  viewer(actors[5].id, 'ADMIN');
  expect((await image()).status).toBe(404);
  viewer('release-unenrolled');
  expect((await image()).status).toBe(404);
  viewer(null);
  expect((await image(true)).status).toBe(404);
  viewer();
  clock.mockReturnValue(MIDNIGHT);
  const released = await image();
  expect(released.status).toBe(200);
  expect(released.headers.get('cache-control')).toContain('no-store');
  expect((await released.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect((await image(true)).status).toBe(200);
  clock.mockReturnValue(MIDNIGHT - 1);
  const shared = node(`${fixture.courseId}-shared`, { content: fixture.nodes[1].content, order: 2 });
  fixture.nodes.push(shared);
  await prisma.courseContent.create({ data: { ...shared, courseId: fixture.courseId } });
  await publish(fixture);
  expect((await image()).status).toBe(200);
  expect((await image(true)).status).toBe(200);
  const current = await prisma.coursePublication.findUniqueOrThrow({ where: { id: fixture.publicationId } });
  const coverPayload = { ...JSON.parse(current.payload), imageUrl: stored.url };
  fixture.sequence += 1;
  const coverId = `${fixture.courseId}-publication-${fixture.sequence}`;
  await prisma.coursePublication.create({ data: { id: coverId, courseId: fixture.courseId, sequence: fixture.sequence, source: 'AUTHOR',
    payload: JSON.stringify(coverPayload), digest: 'release-cover-digest', contentCount: fixture.nodes.length } });
  await prisma.course.update({ where: { id: fixture.courseId }, data: { imageUrl: stored.url, activePublicationId: coverId } });
  viewer(null);
  expect((await image()).status).toBe(200);
  expect((await image(true)).status).toBe(200);
});

test('reads release schedules only from the active publication, ignoring opposite draft edits', async () => {
  for (const activeRelease of [null, RELEASE]) {
    const fixture = await seed(prefix => [node(`${prefix}-chapter`, { releaseOn: activeRelease })]);
    const active = await prisma.coursePublication.findUniqueOrThrow({ where: { id: fixture.publicationId } });
    const draft = JSON.parse(active.payload);
    draft.contents[0].releaseOn = activeRelease ? null : RELEASE;
    await prisma.courseDraft.create({ data: { courseId: fixture.courseId, basePublicationId: fixture.publicationId, revision: 1,
      payload: JSON.stringify(draft), digest: 'opposite-draft-release' } });
    const [content] = await contents(fixture);
    expect(content.locked).toBe(Boolean(activeRelease));
    expect(content.releaseOn).toBe(activeRelease);
  }
});
