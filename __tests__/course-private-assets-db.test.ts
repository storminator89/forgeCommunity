/** @jest-environment node */

import { mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { GET as getAsset } from '@/app/api/courses/[courseId]/assets/[assetId]/route';
import { assertCanReferenceCourseAsset, saveCourseAsset } from '@/lib/server/course-assets';

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
