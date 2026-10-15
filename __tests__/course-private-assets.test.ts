/** @jest-environment node */

import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { POST as upload } from '@/app/api/courses/[courseId]/authoring/assets/route';
import { GET as getAsset, HEAD as headAsset } from '@/app/api/courses/[courseId]/assets/[assetId]/route';
import {
  assertCanReferenceCourseAsset, courseAssetUrl, extractCourseAssetUrls,
  parseCourseAssetUrl, readCourseAsset,
} from '@/lib/server/course-assets';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/rate-limit', () => ({ consumeRateLimit: () => ({ allowed: true }), rateLimitHeaders: () => ({}), UPLOAD_RATE_LIMIT: {} }));
jest.mock('@/lib/server/request-body', () => ({ requestWithBodyLimit: async (request: Request) => request, RequestBodyLimitError: class extends Error {} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  $transaction: jest.fn(),
  user: { findUnique: jest.fn() },
  course: { findUnique: jest.fn() },
  courseAsset: { create: jest.fn(), findUnique: jest.fn() },
  coursePublication: { findUnique: jest.fn() },
  enrollment: { findUnique: jest.fn() },
} }));

const db = prisma as unknown as {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock };
  course: { findUnique: jest.Mock };
  courseAsset: { create: jest.Mock; findUnique: jest.Mock };
  coursePublication: { findUnique: jest.Mock };
  enrollment: { findUnique: jest.Mock };
};

let root: string;
let png: Buffer;
let users: Map<string, { role: string }>;
let courses: Map<string, { instructorId: string; activePublicationId: string | null; imageUrl: string | null }>;
let assets: Map<string, { courseId: string; storageKey: string; contentType: string; byteSize: number }>;
let publications: Map<string, { courseId: string; payload: string }>;
let enrolled: Set<string>;
let nextId: number;
const originalRoot = process.env.COURSE_ASSET_STORAGE_PATH;

function session(id: string | null, role = 'USER') {
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
}

function assetParams(courseId: string, assetId: string) { return { params: Promise.resolve({ courseId, assetId }) }; }

async function postImage(courseId = 'course-a', bytes = png, type = 'image/png', headers: HeadersInit = {}) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'image.png', { type }));
  const request = { url: `http://localhost:3013/api/courses/${courseId}/authoring/assets`, method: 'POST', headers: new Headers(headers), formData: async () => form };
  return upload(request as never,
    { params: Promise.resolve({ courseId }) });
}

beforeEach(async () => {
  jest.clearAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), 'forge-course-assets-'));
  process.env.COURSE_ASSET_STORAGE_PATH = root;
  png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#1d4ed8' } }).png().toBuffer();
  users = new Map([['owner', { role: 'INSTRUCTOR' }], ['student', { role: 'USER' }], ['viewer', { role: 'USER' }], ['admin', { role: 'ADMIN' }]]);
  courses = new Map([['course-a', { instructorId: 'owner', activePublicationId: null, imageUrl: null }], ['course-b', { instructorId: 'other', activePublicationId: null, imageUrl: null }]]);
  assets = new Map();
  publications = new Map();
  enrolled = new Set();
  nextId = 1;
  db.user.findUnique.mockImplementation(async ({ where }) => users.get(where.id) ?? null);
  db.course.findUnique.mockImplementation(async ({ where }) => courses.get(where.id) ?? null);
  db.courseAsset.findUnique.mockImplementation(async ({ where }) => assets.get(where.id) ?? null);
  db.courseAsset.create.mockImplementation(async ({ data }) => {
    const id = `asset-${nextId++}`;
    assets.set(id, data);
    return { id, ...data };
  });
  db.coursePublication.findUnique.mockImplementation(async ({ where }) => publications.get(where.id) ?? null);
  db.enrollment.findUnique.mockImplementation(async ({ where }) => enrolled.has(`${where.userId_courseId.userId}:${where.userId_courseId.courseId}`) ? { id: 'enrolled' } : null);
  db.$transaction.mockImplementation(async work => work(db));
  session('owner', 'INSTRUCTOR');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.COURSE_ASSET_STORAGE_PATH;
  else process.env.COURSE_ASSET_STORAGE_PATH = originalRoot;
});

it('stores a normalized image outside public, private before first publication', async () => {
  const response = await postImage();
  expect(response.status).toBe(201);
  const saved = await response.json();
  expect(saved).toEqual({ id: 'asset-1', url: '/api/courses/course-a/assets/asset-1', mimeType: 'image/png', size: expect.any(Number) });
  expect((await readdir(root)).length).toBe(1);
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(200);
  session('student');
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(404);
  session(null);
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(404);
});

it('allows the published cover in the directory, but gates lesson bytes to enrollment', async () => {
  const saved = await (await postImage()).json();
  courses.get('course-a')!.activePublicationId = 'publication-1';
  courses.get('course-a')!.imageUrl = saved.url;
  publications.set('publication-1', { courseId: 'course-a', payload: JSON.stringify({ imageUrl: saved.url, contents: [] }) });
  session(null);
  let response = await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect((await headAsset(new Request(`http://localhost:3013${saved.url}`, { method: 'HEAD' }) as never, assetParams('course-a', saved.id))).status).toBe(200);

  publications.set('publication-1', { courseId: 'course-a', payload: JSON.stringify({ imageUrl: null, contents: [{ type: 'TEXT', content: `<p><img src="${saved.url}"></p>` }] }) });
  courses.get('course-a')!.imageUrl = null;
  response = await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id));
  expect(response.status).toBe(404);
  session('viewer');
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(404);
  enrolled.add('student:course-a');
  session('student');
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(200);
  publications.set('publication-1', { courseId: 'course-a', payload: JSON.stringify({ imageUrl: null, contents: [{ type: 'QUIZ', content: JSON.stringify({ questions: [{ correctAnswer: `<img src="${saved.url}">` }] }) }] }) });
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(404);
  publications.set('publication-1', { courseId: 'course-a', payload: JSON.stringify({ imageUrl: null, contents: [] }) });
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(404);
  session('admin', 'ADMIN');
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(200);
  users.set('admin', { role: 'USER' });
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(404);
});

it('rechecks course and account authority after image processing and on serialization retry', async () => {
  let calls = 0;
  db.$transaction.mockImplementation(async work => {
    calls++;
    if (calls === 1) throw new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: '7.10.0' });
    users.set('admin', { role: 'USER' });
    return work(db);
  });
  session('admin', 'ADMIN');
  expect((await postImage()).status).toBe(403);
  expect(db.courseAsset.create).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});

it('rechecks the active publication after a read serialization retry', async () => {
  const saved = await (await postImage()).json();
  courses.get('course-a')!.activePublicationId = 'publication-1';
  courses.get('course-a')!.imageUrl = saved.url;
  publications.set('publication-1', { courseId: 'course-a', payload: JSON.stringify({ imageUrl: saved.url, contents: [] }) });
  session(null);
  let attempts = 0;
  db.$transaction.mockImplementation(async work => {
    attempts++;
    if (attempts === 1) {
      courses.get('course-a')!.activePublicationId = null;
      throw new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: '7.10.0' });
    }
    return work(db);
  });
  expect((await getAsset(new Request(`http://localhost:3013${saved.url}`) as never, assetParams('course-a', saved.id))).status).toBe(404);
  expect(attempts).toBe(2);
});

it('does not create files for a guessed course, deleted actor, or cross-origin browser request', async () => {
  session('viewer');
  expect((await postImage()).status).toBe(403);
  session('owner', 'INSTRUCTOR');
  users.delete('owner');
  expect((await postImage()).status).toBe(404);
  users.set('owner', { role: 'INSTRUCTOR' });
  expect((await postImage('course-a', png, 'image/png', { Origin: 'https://foreign.example' })).status).toBe(403);
  expect(db.courseAsset.create).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});

it('rejects foreign references, malformed paths, symlinks and mismatched uploads', async () => {
  const saved = await (await postImage()).json();
  await expect(assertCanReferenceCourseAsset(db as never, 'course-b', 'admin', saved.url)).rejects.toMatchObject({ status: 403 });
  await expect(assertCanReferenceCourseAsset(db as never, 'course-a', 'owner', '/api/courses/course-a/assets/missing')).rejects.toMatchObject({ status: 404 });
  await expect(assertCanReferenceCourseAsset(db as never, 'course-a', 'owner', saved.url)).resolves.toBeUndefined();
  expect(() => parseCourseAssetUrl('/api/courses/course-a/assets/../asset-1')).toThrow();
  expect(() => parseCourseAssetUrl('/api/courses/course-a/assets/asset-1?download=1')).toThrow();
  expect(extractCourseAssetUrls({ imageUrl: saved.url, contents: [{ content: `<img src="&#47;api/courses/course-a/assets/asset-1">` }] })).toEqual([saved.url]);

  const asset = assets.get(saved.id)!;
  await rm(path.join(root, asset.storageKey));
  await symlink('/etc/hosts', path.join(root, asset.storageKey));
  await expect(readCourseAsset(asset)).rejects.toMatchObject({ code: 'ELOOP' });
  await expect(readCourseAsset({ ...asset, storageKey: '../hosts' })).rejects.toMatchObject({ status: 404 });
  expect((await postImage('course-a', Buffer.from('not an image'))).status).toBe(400);
});

it('rejects a private storage root redirected into public assets', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'forge-course-public-link-'));
  try {
    await rm(root, { recursive: true, force: true });
    await symlink(path.join(process.cwd(), 'public'), root);
    expect((await postImage()).status).toBe(500);
    expect(db.courseAsset.create).not.toHaveBeenCalled();
  } finally { await rm(outside, { recursive: true, force: true }); }
});
