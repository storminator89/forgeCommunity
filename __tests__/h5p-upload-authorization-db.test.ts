/** @jest-environment node */
import { POST as upload } from '@/app/api/h5p/upload/route';
import { storeH5PPackage, readH5PAsset } from '@/lib/server/h5p-storage';
import { validateH5PPackage } from '@/lib/server/h5p-archive';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { Prisma } from '@prisma/client';
import { zipSync, strToU8 } from 'fflate';
import { mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/rate-limit', () => ({ consumeRateLimit: () => ({ allowed: true }), rateLimitHeaders: () => ({}), UPLOAD_RATE_LIMIT: {} }));
jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises');
  return { ...actual, rename: jest.fn(actual.rename) };
});
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-h5p-upload-db-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const originalStorage = process.env.H5P_STORAGE_PATH;
const originalAuthUrl = process.env.NEXTAUTH_URL;
const originalPublicUrl = process.env.NEXT_PUBLIC_APP_URL;
const actualRename = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises').rename;
let storage: string;
const archive = () => zipSync({
  'h5p.json': strToU8(JSON.stringify({ title: 'Role boundary fixture', mainLibrary: 'H5P.Example', preloadedDependencies: [{ machineName: 'H5P.Example', majorVersion: 1, minorVersion: 0 }] })),
  'content/content.json': strToU8('{}'),
  'H5P.Example-1.0/library.json': strToU8(JSON.stringify({ title: 'Example', machineName: 'H5P.Example', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 1, preloadedJs: [{ path: 'example.js' }] })),
  'H5P.Example-1.0/example.js': strToU8('H5P.Example = function () {};'),
});
// Use the real bounded body reader, multipart parser, ZIP validator and storage.
// The app-wide Jest setup replaces FormData, so construct the multipart wire body.
function request(title = '  Uploaded fixture  ') {
  const boundary = 'forge-h5p-role-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}\r\nContent-Disposition: form-data; name="h5p"; filename="fixture.h5p"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    archive(), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Request('http://localhost/api/h5p/upload', {
    method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Origin: 'http://localhost' }, body,
  }) as never;
}

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.mocked(rename).mockReset().mockImplementation(actualRename);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  storage = await mkdtemp(join(tmpdir(), 'forge-h5p-upload-files-'));
  process.env.H5P_STORAGE_PATH = storage;
  delete process.env.NEXTAUTH_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  await prisma.h5PContent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' },
    { id: 'teacher', email: 'teacher@example.invalid', role: 'INSTRUCTOR' },
  ] });
  jest.mocked(getServerSession).mockImplementation(async () => ({
    user: await prisma.user.findUniqueOrThrow({ where: { id: 'teacher' }, select: { id: true, role: true } }),
  }) as never);
});
afterEach(async () => {
  await rm(storage, { recursive: true, force: true });
  for (const [key, value] of [['H5P_STORAGE_PATH', originalStorage], ['NEXTAUTH_URL', originalAuthUrl], ['NEXT_PUBLIC_APP_URL', originalPublicUrl]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
afterAll(async () => {
  await prisma.$disconnect();
  await rm(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

const revocations = ['USER', 'MODERATOR', 'deleted'] as const;
async function revoke(id: string, change: typeof revocations[number]) {
  if (change === 'deleted') await prisma.user.delete({ where: { id } });
  else await prisma.user.update({ where: { id }, data: { role: change } });
}

describe.each(['admin', 'teacher'])('%s upload authority', id => {
  test.each(revocations)('rejects %s committed after the session role lookup', async change => {
    jest.mocked(getServerSession).mockImplementationOnce(async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true, role: true } });
      await revoke(id, change);
      return { user } as never;
    });
    const response = await upload(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Insufficient permissions' });
    expect(await prisma.h5PContent.count()).toBe(0);
    expect(await readdir(storage)).toEqual([]);
  });

  test.each(revocations)('rejects %s committed while package files are being staged', async change => {
    jest.mocked(getServerSession).mockImplementationOnce(async () => ({
      user: await prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true, role: true } }),
    }) as never);
    jest.mocked(rename).mockImplementationOnce(async (from, to) => {
      await actualRename(from, to);
      expect(await readdir(String(to))).toEqual(['metadata.json', 'package']);
      await revoke(id, change);
    });
    expect((await upload(request())).status).toBe(403);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await prisma.h5PContent.count()).toBe(0);
    expect(await readdir(storage)).toEqual([]);
  });

  test('permits a current role and preserves the response, title and private files', async () => {
    jest.mocked(getServerSession).mockImplementationOnce(async () => ({
      user: await prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true, role: true } }),
    }) as never);
    const response = await upload(request());
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({ id: expect.any(String), title: 'Uploaded fixture', contentType: 'H5P.Example', createdAt: expect.any(String), embedUrl: `/h5p/embed/${body.id}` });
    expect(await prisma.h5PContent.findUnique({ where: { id: body.id } })).toMatchObject({ userId: id, title: 'Uploaded fixture' });
    expect(await readdir(storage)).toEqual([body.id]);
    expect((await readH5PAsset(body.id, ['content', 'content.json'])).bytes.toString()).toBe('{}');
    expect(JSON.parse(await readFile(join(storage, body.id, 'metadata.json'), 'utf8'))).toMatchObject({ title: 'Uploaded fixture', mainLibrary: 'H5P.Example', version: 1 });
  });
});

test.each(revocations)('direct storage also denies %s without leaving orphan files or a row', async change => {
  await revoke('teacher', change);
  await expect(storeH5PPackage(validateH5PPackage(archive()), 'teacher')).rejects.toMatchObject({ status: 403 });
  expect(await prisma.h5PContent.count()).toBe(0);
  expect(await readdir(storage)).toEqual([]);
});

test.each(['ADMIN', 'INSTRUCTOR'] as const)('a role change that retains %s upload permission still succeeds', async role => {
  await prisma.user.update({ where: { id: 'teacher' }, data: { role: role === 'ADMIN' ? 'INSTRUCTOR' : 'ADMIN' } });
  jest.mocked(rename).mockImplementationOnce(async (from, to) => {
    await actualRename(from, to);
    await prisma.user.update({ where: { id: 'teacher' }, data: { role } });
  });
  expect((await upload(request())).status).toBe(201);
  expect(await prisma.h5PContent.count()).toBe(1);
  expect(await readdir(storage)).toHaveLength(1);
});

test('a denied upload preserves unrelated previously stored content and files', async () => {
  const existing = await storeH5PPackage(validateH5PPackage(archive()), 'admin');
  const before = await prisma.h5PContent.findMany();
  jest.mocked(rename).mockImplementationOnce(async (from, to) => {
    await actualRename(from, to);
    await revoke('teacher', 'USER');
  });
  expect((await upload(request())).status).toBe(403);
  expect(await prisma.h5PContent.findMany()).toEqual(before);
  expect(await readdir(storage)).toEqual([existing.id]);
  expect((await readH5PAsset(existing.id, ['content', 'content.json'])).bytes.toString()).toBe('{}');
});

test('cleans up all files after a database transaction rolls back a created row', async () => {
  const transaction = prisma.$transaction.bind(prisma);
  const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
    return transaction(async tx => { await work(tx); throw new Error('fixture rollback'); }, options);
  }) as never);
  expect((await upload(request())).status).toBe(500);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(await prisma.h5PContent.count()).toBe(0);
  expect(await readdir(storage)).toEqual([]);
});

test('rechecks persisted authority after a serialization rollback without restaging files', async () => {
  const transaction = prisma.$transaction.bind(prisma);
  const conflict = new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
  const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
    try {
      return await transaction(async tx => { await work(tx); throw conflict; }, options);
    } catch (error) {
      await prisma.user.update({ where: { id: 'teacher' }, data: { role: 'USER' } });
      throw error;
    }
  }) as never);
  expect((await upload(request())).status).toBe(403);
  expect(spy).toHaveBeenCalledTimes(2);
  for (const call of spy.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'Serializable' });
  expect(rename).toHaveBeenCalledTimes(1);
  expect(await prisma.h5PContent.count()).toBe(0);
  expect(await readdir(storage)).toEqual([]);
});

test('a current instructor succeeds on serialization retry with exactly one package and row', async () => {
  const transaction = prisma.$transaction.bind(prisma);
  const conflict = new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
  const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
    return transaction(async tx => { await work(tx); throw conflict; }, options);
  }) as never);
  const response = await upload(request(''));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.title).toBe('Role boundary fixture');
  expect(spy).toHaveBeenCalledTimes(2);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(await prisma.h5PContent.count()).toBe(1);
  expect(await readdir(storage)).toEqual([body.id]);
});

test('bounded serialization failures return a conflict and remove all staged files', async () => {
  const transaction = prisma.$transaction.bind(prisma);
  const conflict = new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
    return transaction(async tx => { await work(tx); throw conflict; }, options);
  }) as never);
  expect((await upload(request())).status).toBe(409);
  expect(spy).toHaveBeenCalledTimes(4);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(await prisma.h5PContent.count()).toBe(0);
  expect(await readdir(storage)).toEqual([]);
});
