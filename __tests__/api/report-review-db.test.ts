/** @jest-environment node */
import { PATCH as reviewReport } from '@/app/api/reports/[reportId]/route';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
// The sanitization suite covers HTML. Exercise the real transaction and data here.
jest.mock('@/lib/server/sanitize-html', () => ({ sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').trim() }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-report-review-'));
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

type ReviewWork = (tx: Prisma.TransactionClient) => Promise<unknown>;
const params = (reportId = 'report') => ({ params: Promise.resolve({ reportId }) });
const dismissed = { status: 'DISMISSED', resolutionNote: 'No violation found' };
const resolved = { status: 'RESOLVED', resolutionNote: 'Previously removed by an administrator', actionTaken: true };
const request = (body: object = dismissed) => new Request('http://localhost/api/reports/report', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as never;
const viewer = (id = 'moderator', role = 'MODERATOR') => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
const snapshot = () => prisma.contentReport.findMany({ orderBy: { id: 'asc' } });
const conflict = () => new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.contentReport.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' },
    { id: 'moderator', email: 'moderator@example.invalid', role: 'MODERATOR' },
    { id: 'member', email: 'member@example.invalid', role: 'USER' },
    { id: 'instructor', email: 'instructor@example.invalid', role: 'INSTRUCTOR' },
  ] });
  // Reports intentionally have no user/target FKs and retain their audit data.
  await prisma.contentReport.createMany({ data: [
    { id: 'report', reporterId: 'member', targetType: 'POST', targetId: 'removed-post', reason: 'SPAM', details: 'Retained report evidence' },
    { id: 'history', reporterId: 'former-reporter', targetType: 'COMMENT', targetId: 'removed-comment', reason: 'UNSAFE',
      details: 'Historical evidence', status: 'RESOLVED', reviewedById: 'former-reviewer',
      reviewedAt: new Date('2026-10-01'), resolutionNote: 'Retained historical decision' },
  ] });
  viewer();
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test.each(['ADMIN', 'MODERATOR'])('rejects committed %s demotion after the early guard and before the decision transaction', async role => {
  const id = role === 'ADMIN' ? 'admin' : 'moderator';
  viewer(id, role);
  const before = await snapshot();
  const delayedBody = { url: 'http://localhost/api/reports/report', headers: new Headers(), body: null, json: async () => {
    await prisma.user.update({ where: { id }, data: { role: 'USER' } });
    return dismissed;
  } } as never;
  const response = await reviewReport(delayedBody, params());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'Nicht autorisiert' });
  expect(await snapshot()).toEqual(before);
});

test('rejects committed reviewer deletion between the early guard and decision, preserving retained evidence', async () => {
  const before = await snapshot();
  const delayedBody = { url: 'http://localhost/api/reports/report', headers: new Headers(), body: null, json: async () => {
    await prisma.user.delete({ where: { id: 'moderator' } });
    return dismissed;
  } } as never;
  expect((await reviewReport(delayedBody, params())).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test.each(['member', 'instructor', 'deleted-actor'])('rejects %s despite a session ADMIN claim, without exposing missing reports', async id => {
  viewer(id, 'ADMIN');
  const before = await snapshot();
  expect((await reviewReport(request(), params())).status).toBe(403);
  expect((await reviewReport(request(), params('missing'))).status).toBe(403);
  expect(await snapshot()).toEqual(before);
});

test('anonymous callers receive 401; authorized callers retain the missing-report 404 contract', async () => {
  const before = await snapshot();
  jest.mocked(getServerSession).mockResolvedValueOnce(null);
  expect((await reviewReport(request(), params())).status).toBe(401);
  expect((await reviewReport(request(), params('missing'))).status).toBe(404);
  expect(await snapshot()).toEqual(before);
});

test.each([dismissed, resolved])('records one server-owned decision and preserves the first review on replay: %j', async body => {
  const before = await snapshot();
  const first = await reviewReport(request({ ...body, reviewedById: 'spoofed', reviewedAt: '2000-01-01' }), params());
  expect(first.status).toBe(200);
  expect(first.headers.get('Cache-Control')).toBe('private, no-store');
  const result = await first.json();
  expect(result).toMatchObject({ id: 'report', status: body.status, reviewedById: 'moderator' });
  const reviewed = await snapshot();
  expect(reviewed.find(row => row.id === 'history')).toEqual(before.find(row => row.id === 'history'));
  expect(reviewed.find(row => row.id === 'report')).toMatchObject({
    reporterId: 'member', targetId: 'removed-post', details: 'Retained report evidence',
    status: body.status, resolutionNote: body.resolutionNote, reviewedById: 'moderator', reviewedAt: new Date(result.reviewedAt),
  });
  expect((await reviewReport(request(body), params())).status).toBe(409);
  viewer('admin', 'ADMIN');
  expect((await reviewReport(request(body.status === 'DISMISSED' ? resolved : dismissed), params())).status).toBe(409);
  expect(await snapshot()).toEqual(reviewed);
});

test('competing authorized reviews retain one decision and a conflict for the other request', async () => {
  jest.mocked(getServerSession)
    .mockResolvedValueOnce({ user: { id: 'moderator', role: 'MODERATOR' } } as never)
    .mockResolvedValueOnce({ user: { id: 'admin', role: 'ADMIN' } } as never);
  const before = await snapshot();
  const responses = await Promise.all([reviewReport(request(dismissed), params()), reviewReport(request(resolved), params())]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  const winner = await responses.find(response => response.status === 200)!.json();
  const after = await snapshot();
  expect(after.find(row => row.id === 'report')).toMatchObject({ status: winner.status, reviewedById: winner.reviewedById, reviewedAt: new Date(winner.reviewedAt) });
  expect(after.find(row => row.id === 'history')).toEqual(before.find(row => row.id === 'history'));
});

test('an error after the conditional write rolls back the entire review without retry', async () => {
  const before = await snapshot();
  const transact = prisma.$transaction.bind(prisma);
  const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: ReviewWork, options: unknown) =>
    transact(async tx => { await work(tx); throw new Error('Failure after decision write'); }, options as never)) as never);
  expect((await reviewReport(request(), params())).status).toBe(500);
  expect(transactions).toHaveBeenCalledTimes(1);
  expect(await snapshot()).toEqual(before);
});

test('a known serialization conflict rolls back and retries in a new serializable transaction', async () => {
  const transact = prisma.$transaction.bind(prisma);
  let attempts = 0;
  const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: ReviewWork, options: unknown) =>
    transact(async tx => { const result = await work(tx); if (++attempts === 1) throw conflict(); return result; }, options as never)) as never);
  expect((await reviewReport(request(), params())).status).toBe(200);
  expect(transactions).toHaveBeenCalledTimes(2);
  for (const [, options] of transactions.mock.calls) expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  expect(await prisma.contentReport.findUnique({ where: { id: 'report' } })).toMatchObject({ status: 'DISMISSED', reviewedById: 'moderator' });
});

test.each(['demoted', 'deleted'])('a serialization retry rereads the actor after a committed %s change', async change => {
  const before = await snapshot();
  const transact = prisma.$transaction.bind(prisma);
  let attempts = 0;
  const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: ReviewWork, options: unknown) => {
    if (++attempts !== 1) return transact(work, options as never);
    try {
      return await transact(async tx => { await work(tx); throw conflict(); }, options as never);
    } catch (error) {
      if (change === 'deleted') await prisma.user.delete({ where: { id: 'moderator' } });
      else await prisma.user.update({ where: { id: 'moderator' }, data: { role: 'USER' } });
      throw error;
    }
  }) as never);
  expect((await reviewReport(request(), params())).status).toBe(403);
  expect(transactions).toHaveBeenCalledTimes(2);
  expect(await snapshot()).toEqual(before);
});

test('four known serialization failures return 409 and retain an untouched OPEN report', async () => {
  const before = await snapshot();
  const transact = prisma.$transaction.bind(prisma);
  const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: ReviewWork, options: unknown) =>
    transact(async tx => { await work(tx); throw conflict(); }, options as never)) as never);
  expect((await reviewReport(request(), params())).status).toBe(409);
  expect(transactions).toHaveBeenCalledTimes(4);
  expect(await snapshot()).toEqual(before);
});

test.each(['P2002', 'P2003', 'P2028', 'P1008'])('does not retry unrelated known error %s or preserve a partial decision', async code => {
  const before = await snapshot();
  const transact = prisma.$transaction.bind(prisma);
  const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: ReviewWork, options: unknown) =>
    transact(async tx => {
      await work(tx);
      throw new Prisma.PrismaClientKnownRequestError('Unrelated error', { code, clientVersion: '7.10.0' });
    }, options as never)) as never);
  expect((await reviewReport(request(), params())).status).toBe(500);
  expect(transactions).toHaveBeenCalledTimes(1);
  expect(await snapshot()).toEqual(before);
});

test('a lookalike P2034 object is not treated as a verified serialization conflict', async () => {
  const before = await snapshot();
  const transactions = jest.spyOn(prisma, '$transaction').mockRejectedValue({ code: 'P2034' });
  expect((await reviewReport(request(), params())).status).toBe(500);
  expect(transactions).toHaveBeenCalledTimes(1);
  expect(await snapshot()).toEqual(before);
});
