/** @jest-environment node */

import { mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { getServerSession } from '@/lib/sites-auth/server';
import prisma from '@/lib/prisma';
import { GET as getAsset, HEAD as headAsset } from '@/app/api/courses/[courseId]/assets/[assetId]/route';
import { assertCanReferenceCourseAsset, saveCourseAsset } from '@/lib/server/course-assets';
import { courseContentRevision } from '@/lib/server/course-progress';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-course-assets-db-'));
  const filename = join(directory, 'test.db');
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${filename}` }) }) };
});

let root: string;
const originalRoot = process.env.COURSE_ASSET_STORAGE_PATH;
const params = (assetId: string) => ({ params: Promise.resolve({ courseId: 'course-1', assetId }) });
const read = (assetId: string) => getAsset(new Request(`http://localhost/api/courses/course-1/assets/${assetId}`) as never, params(assetId));
function viewer(id: string | null, role = 'USER') {
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
}
function payload(imageUrl: string | null, content = '') {
  return JSON.stringify({ schemaVersion: 1, title: 'Course', description: 'Private assets', startDate: null, endDate: null,
    imageUrl, contents: content ? [{ id: 'node-1', parentId: null, title: 'Lesson', type: 'TEXT', content, order: 1 }] : [] });
}

afterAll(async () => {
  if (originalRoot === undefined) delete process.env.COURSE_ASSET_STORAGE_PATH;
  else process.env.COURSE_ASSET_STORAGE_PATH = originalRoot;
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
  if (root) await rm(root, { recursive: true, force: true });
});

it('keeps a real SQLite asset private until the active publication references it, then revokes learner access on replacement', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'forge-course-asset-bytes-'));
  process.env.COURSE_ASSET_STORAGE_PATH = root;
  await prisma.user.createMany({ data: [
    { id: 'author', email: 'asset-author@example.invalid', role: 'INSTRUCTOR' },
    { id: 'learner', email: 'asset-learner@example.invalid', role: 'USER' },
    { id: 'admin', email: 'asset-admin@example.invalid', role: 'ADMIN' },
  ] });
  await prisma.course.create({ data: { id: 'course-1', title: 'Course', description: 'Private assets', instructorId: 'author' } });
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#2563eb' } }).png().toBuffer();
  const asset = await saveCourseAsset('course-1', { id: 'author' }, new File([new Uint8Array(png)], 'asset.png', { type: 'image/png' }));
  expect(await prisma.courseAsset.count({ where: { courseId: 'course-1' } })).toBe(1);
  viewer(null);
  expect((await read(asset.id)).status).toBe(404);
  viewer('learner');
  expect((await read(asset.id)).status).toBe(404);
  viewer('author', 'INSTRUCTOR');
  expect((await read(asset.id)).status).toBe(200);
  await expect(prisma.$transaction(tx => assertCanReferenceCourseAsset(tx, 'course-1', 'author', asset.url))).resolves.toBeUndefined();
  await expect(prisma.$transaction(tx => assertCanReferenceCourseAsset(tx, 'course-1', 'author', '/api/courses/course-1/assets/missing'))).rejects.toMatchObject({ status: 404 });

  await prisma.coursePublication.create({ data: { id: 'publication-1', courseId: 'course-1', sequence: 1, source: 'AUTHOR',
    payload: payload(asset.url), digest: 'test-digest-1', contentCount: 0 } });
  await prisma.course.update({ where: { id: 'course-1' }, data: { activePublicationId: 'publication-1', imageUrl: asset.url } });
  viewer(null);
  expect((await read(asset.id)).status).toBe(200);

  await prisma.coursePublication.create({ data: { id: 'publication-2', courseId: 'course-1', sequence: 2, source: 'AUTHOR',
    payload: payload(null, `<p><img src="${asset.url}"></p>`), digest: 'test-digest-2', contentCount: 1, previousPublicationId: 'publication-1' } });
  await prisma.courseContent.create({ data: { id: 'node-1', courseId: 'course-1', title: 'Lesson', type: 'TEXT', content: `<p><img src="${asset.url}"></p>`, order: 1 } });
  await prisma.course.update({ where: { id: 'course-1' }, data: { activePublicationId: 'publication-2', imageUrl: null } });
  viewer(null);
  expect((await read(asset.id)).status).toBe(404);
  viewer('learner');
  expect((await read(asset.id)).status).toBe(404);
  await prisma.enrollment.create({ data: { userId: 'learner', courseId: 'course-1' } });
  expect((await read(asset.id)).status).toBe(200);

  await prisma.coursePublication.create({ data: { id: 'publication-3', courseId: 'course-1', sequence: 3, source: 'AUTHOR',
    payload: payload(null), digest: 'test-digest-3', contentCount: 0, previousPublicationId: 'publication-2' } });
  await prisma.courseContent.update({ where: { id: 'node-1' }, data: { archivedAt: new Date() } });
  await prisma.course.update({ where: { id: 'course-1' }, data: { activePublicationId: 'publication-3' } });
  expect((await read(asset.id)).status).toBe(404);
  viewer('author', 'INSTRUCTOR');
  expect((await read(asset.id)).status).toBe(200);
  viewer('admin', 'ADMIN');
  expect((await read(asset.id)).status).toBe(200);
  await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
  expect((await read(asset.id)).status).toBe(404);
});

it('enforces locked inline image reads on GET and HEAD, but permits an unlocked shared reference and public cover', async () => {
  const id = 'course-asset-path';
  const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'forge-course-path-asset-'));
  process.env.COURSE_ASSET_STORAGE_PATH = assetRoot;
  try {
    await prisma.course.create({ data: { id, title: 'Path', description: 'Path assets', instructorId: 'author' } });
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#2563eb' } }).png().toBuffer();
    const asset = await saveCourseAsset(id, { id: 'author' }, new File([new Uint8Array(png)], 'path.png', { type: 'image/png' }));
    const first = { id: 'asset-path-a', parentId: null, title: 'Start', type: 'TEXT', content: '<p>Start</p>', order: 1 };
    const second = { id: 'asset-path-b', parentId: null, title: 'Locked', type: 'TEXT', content: `<p><img src="${asset.url}"></p>`, order: 2, prerequisiteIds: [first.id] };
    const publicationPayload = (imageUrl: string | null, a = first) => JSON.stringify({ schemaVersion: 1, title: 'Path', description: 'Path assets', startDate: null, endDate: null, imageUrl, contents: [a, second] });
    await prisma.courseContent.createMany({ data: [first, second].map(node => ({ id: node.id, courseId: id, title: node.title, type: 'TEXT', content: node.content, order: node.order })) });
    await prisma.coursePublication.create({ data: { id: 'asset-path-publication-1', courseId: id, sequence: 1, source: 'AUTHOR', payload: publicationPayload(null), digest: 'asset-path-digest-1', contentCount: 2 } });
    await prisma.course.update({ where: { id }, data: { activePublicationId: 'asset-path-publication-1' } });
    await prisma.enrollment.create({ data: { userId: 'learner', courseId: id } });
    const at = (head = false, assetId = asset.id) => {
      const request = new Request(`http://localhost/api/courses/${id}/assets/${assetId}`);
      return (head ? headAsset : getAsset)(request as never, { params: Promise.resolve({ courseId: id, assetId }) });
    };
    viewer('learner');
    expect((await at()).status).toBe(404);
    expect((await at(true)).status).toBe(404);
    expect((await at(false, 'unknown-asset')).status).toBe(404);
    await prisma.courseContentProgress.create({ data: { userId: 'learner', courseId: id, contentId: first.id, revision: courseContentRevision(first) } });
    expect((await at()).status).toBe(200);
    expect((await at(true)).status).toBe(200);
    await prisma.courseContentProgress.delete({ where: { userId_contentId: { userId: 'learner', contentId: first.id } } });
    const shared = { ...first, content: `<p>Start <img src="${asset.url}"></p>` };
    await prisma.courseContent.update({ where: { id: first.id }, data: { content: shared.content } });
    await prisma.coursePublication.create({ data: { id: 'asset-path-publication-2', courseId: id, sequence: 2, source: 'AUTHOR', payload: publicationPayload(null, shared), digest: 'asset-path-digest-2', contentCount: 2 } });
    await prisma.course.update({ where: { id }, data: { activePublicationId: 'asset-path-publication-2' } });
    expect((await at()).status).toBe(200); // Shared by unlocked first leaf, despite locked second leaf.
    await prisma.coursePublication.create({ data: { id: 'asset-path-publication-3', courseId: id, sequence: 3, source: 'AUTHOR', payload: publicationPayload(asset.url, first), digest: 'asset-path-digest-3', contentCount: 2 } });
    await prisma.courseContent.update({ where: { id: first.id }, data: { content: first.content } });
    await prisma.course.update({ where: { id }, data: { activePublicationId: 'asset-path-publication-3', imageUrl: asset.url } });
    viewer(null);
    expect((await at()).status).toBe(200); // An active public cover remains public.
  } finally {
    await rm(assetRoot, { recursive: true, force: true });
  }
});
