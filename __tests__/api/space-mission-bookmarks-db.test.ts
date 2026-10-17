/** @jest-environment node */

import prisma from '@/lib/prisma';
import { Prisma, type PrismaClient } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { getServerSession } from '@/lib/sites-auth/server';
import { PUT, dynamic } from '@/app/api/spaces/[spaceId]/missions/[missionId]/bookmark/route';
import { GET as overview } from '@/app/api/space-missions/route';
import { GET as detail, PATCH as closeMission } from '@/app/api/spaces/[spaceId]/missions/[missionId]/route';
import { DELETE as removeMember } from '@/app/api/spaces/[spaceId]/members/[userId]/route';
import { DELETE as leaveMission } from '@/app/api/spaces/[spaceId]/missions/[missionId]/participation/route';
import { closeMission as closeMissionService } from '@/lib/server/space-missions';
import { bookmarkTransaction, revokeSpaceMissionBookmarks, setMissionBookmark } from '@/lib/server/space-mission-bookmarks';

jest.setTimeout(30000);
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({ sanitizeTextServer: (value: string) => value }));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const queries: string[] = [];
  const log = [{ emit: 'event', level: 'query' }];
  if (process.env.SPACE_MISSIONS_POSTGRESQL_DISPOSABLE === '1') {
    const { missionTestDatabaseUrl } = require('../../scripts/space-mission-test-database.cjs');
    const validatedUrl = missionTestDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER);
    const { randomUUID } = require('node:crypto');
    const { spawnSync } = require('node:child_process');
    const { Client } = require('pg');
    const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
    const schema = `forge_bookmark_${randomUUID().replaceAll('-', '_')}`;
    const scopedUrl = new URL(validatedUrl); scopedUrl.searchParams.set('schema', schema);
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: validatedUrl }, { schema }), log });
    runtime.$on('query', (event: { query: string }) => queries.push(event.query));
    return { __esModule: true, default: runtime, __queries: queries, __newClient: () => new PrismaClient({ adapter: new PrismaPg({ connectionString: validatedUrl }, { schema }) }),
      __initialize: async () => {
        const db = new Client({ connectionString: validatedUrl }); await db.connect();
        try { await db.query(`CREATE SCHEMA "${schema}"`); } finally { await db.end(); }
        const result = spawnSync(process.execPath, ['scripts/db-deploy.mjs', '--initialize-empty-schema'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
          env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: scopedUrl.toString() },
        });
        if (result.status !== 0) throw new Error(`Bookmark PostgreSQL deployment failed: ${result.error?.message ?? result.stderr}`);
      },
      __finalize: async () => {
        const db = new Client({ connectionString: validatedUrl }); await db.connect();
        try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); }
      },
    };
  }
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const path = join(mkdtempSync(join(tmpdir(), 'forge-mission-bookmark-')), 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  const runtime = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }), log });
  runtime.$on('query', (event: { query: string }) => queries.push(event.query));
  return { __esModule: true, default: runtime, __queries: queries, __newClient: () => new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}`, timeout: 10 }) }) };
});

const session = (id: string | null = 'learner') => jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role: 'ADMIN' } } as never : null);
const request = (method = 'GET', body?: unknown, url = '/api/space-missions', headers = {}) => new Request(`http://localhost${url}`, {
  method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}) as never;
const context = (missionId = 'mission', spaceId = 'private') => ({ params: Promise.resolve({ spaceId, missionId }) });
const input = (saved = true, expectedRevision = 0, accessEpoch = 0) => ({ saved, expectedRevision, accessEpoch });
const put = (body: unknown = input(), missionId = 'mission', spaceId = 'private', headers = {}) => PUT(request('PUT', body, '/api/spaces/private/missions/mission/bookmark', headers), context(missionId, spaceId));
const list = (query = '') => overview(request('GET', undefined, `/api/space-missions${query}`));
const read = (missionId = 'mission', spaceId = 'private') => detail(request(), context(missionId, spaceId));
const noStore = (response: Response) => expect(response.headers.get('cache-control')).toBe('private, no-store');
const remove = () => removeMember(request('DELETE'), { params: Promise.resolve({ spaceId: 'private', userId: 'learner' }) });
type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;

async function seedMission(id: string, spaceId: string, members = ['learner'], createdAt = new Date('2026-10-12T12:00:00Z')) {
  await prisma.space.create({ data: { id: spaceId, name: `Space ${id}`, description: 'Private canary description', visibility: 'PRIVATE',
    members: { create: members.map(userId => ({ userId })) } } });
  return prisma.spaceMission.create({ data: { id, spaceId, creatorId: 'admin', title: `Mission ${id}`, prompt: 'Private canary mission content',
    requestId: id, payloadDigest: 'private-canary-digest', createdAt } });
}
beforeAll(async () => { await jest.requireMock('@/lib/prisma').__initialize?.(); }, 120000);
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks(); jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.spaceMission.deleteMany(); await prisma.spaceMember.deleteMany(); await prisma.space.deleteMany(); await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'learner', email: 'bookmark-learner@example.invalid', role: 'USER' },
    { id: 'other', email: 'bookmark-other@example.invalid', role: 'USER' },
    { id: 'admin', email: 'bookmark-admin@example.invalid', role: 'ADMIN' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `member${i}`, email: `bookmark-member${i}@example.invalid`, role: 'USER' as const })),
  ] });
  await seedMission('mission', 'private', ['learner', 'admin', ...Array.from({ length: 5 }, (_, i) => `member${i}`)]);
  session();
});
afterAll(async () => { await prisma.$disconnect(); await jest.requireMock('@/lib/prisma').__finalize?.(); });

test('save before participation persists self-only intent; reads stay write-free and no participation, rewards or delivery are created', async () => {
  expect(dynamic).toBe('force-dynamic');
  expect((await (await read()).json()).ownBookmark).toEqual({ saved: false, revision: 0, accessEpoch: 0 });
  expect(await prisma.spaceMissionBookmarkAccess.count()).toBe(0);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
  const saved = await put(); expect(saved.status).toBe(200); noStore(saved);
  expect(await saved.json()).toEqual({ saved: true, revision: 1, accessEpoch: 0 });
  const reloaded = await (await read()).json();
  expect(reloaded.ownBookmark).toEqual({ saved: true, revision: 1, accessEpoch: 0 });
  expect(reloaded.participation).toMatchObject({ active: false, epoch: 0 });
  expect((await (await list('?view=saved')).json()).items).toEqual([expect.objectContaining({ id: 'mission', ownBookmark: reloaded.ownBookmark })]);
  for (const table of [prisma.spaceMissionParticipation, prisma.spaceMissionContribution, prisma.notification, prisma.rewardLedger,
    prisma.learningGoal, prisma.enrollment, prisma.courseCompletionRecord, prisma.userBadge]) {
    expect(await (table.count as () => Promise<number>)()).toBe(0);
  }
});

test('tombstone unsave advances revision and fences stale first-save and stale later-save intent', async () => {
  expect(await (await put(input(false))).json()).toEqual({ saved: false, revision: 1, accessEpoch: 0 });
  for (const body of [input(true), input(false)]) { const response = await put(body); expect(response.status).toBe(409); noStore(response); }
  expect(await (await put(input(true, 1))).json()).toEqual({ saved: true, revision: 2, accessEpoch: 0 });
  expect(await (await put(input(false, 2))).json()).toEqual({ saved: false, revision: 3, accessEpoch: 0 });
  expect((await put(input(true, 2))).status).toBe(409);
  expect(await prisma.spaceMissionBookmarkSetting.findUnique({ where: { missionId_userId: { missionId: 'mission', userId: 'learner' } } })).toMatchObject({ revision: 3, savedAt: null });
  expect((await (await list('?view=saved')).json()).items).toEqual([]);
});

test('actual membership is mandatory for every role and another account cannot infer or mutate the owner bookmark', async () => {
  await put(); session('other');
  expect((await put()).status).toBe(404);
  expect((await (await list('?view=saved')).json()).items).toEqual([]);
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'other' } });
  expect((await (await read()).json()).ownBookmark).toEqual({ saved: false, revision: 0, accessEpoch: 0 });
  expect((await (await list('?view=saved')).json()).items).toEqual([]);
  session('admin'); expect((await put()).status).toBe(200);
  await prisma.spaceMember.delete({ where: { spaceId_userId: { spaceId: 'private', userId: 'admin' } } });
  expect((await (await read()).json()).ownBookmark).toBeNull();
  expect((await put(input(false, 1))).status).toBe(404);
  expect((await (await list('?view=saved')).json()).items).toEqual([]);
  for (const role of ['ADMIN', 'INSTRUCTOR', 'MODERATOR', 'USER'] as const) {
    await prisma.user.update({ where: { id: 'learner' }, data: { role } }); session();
    expect((await (await read()).json()).ownBookmark).toEqual({ saved: true, revision: 1, accessEpoch: 0 });
  }
});

test('full capacity, soft-week expiry and participation opt-out are independent of bookmarks', async () => {
  await prisma.spaceMission.update({ where: { id: 'mission' }, data: { weekStartsOn: '2020-01-06', weekTimezone: 'UTC',
    weekStartsAt: new Date('2020-01-06T00:00:00Z'), weekEndsAt: new Date('2020-01-13T00:00:00Z') } });
  await prisma.spaceMissionParticipation.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ missionId: 'mission', userId: `member${i}`, epoch: 1 })) });
  expect((await put()).status).toBe(200);
  expect(await prisma.spaceMissionParticipation.count()).toBe(5);
  await prisma.spaceMissionParticipation.deleteMany();
  await prisma.spaceMissionParticipation.create({ data: { missionId: 'mission', userId: 'learner', epoch: 1 } });
  expect((await leaveMission(request('DELETE', { epoch: 1 }), context())).status).toBe(200);
  expect((await (await read()).json()).ownBookmark).toEqual({ saved: true, revision: 1, accessEpoch: 0 });
});

test('official revocation clears only affected Space settings and fences an old first save across rejoin', async () => {
  await seedMission('elsewhere', 'elsewhere');
  await put(); await put(input(), 'elsewhere', 'elsewhere');
  session('admin'); expect((await remove()).status).toBe(200);
  expect(await prisma.spaceMissionBookmarkSetting.findMany({ where: { userId: 'learner' }, select: { missionId: true } })).toEqual([{ missionId: 'elsewhere' }]);
  session(); expect((await put(input())).status).toBe(404);
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'learner' } });
  expect((await put(input())).status).toBe(409);
  expect((await put(input(false, 1), 'elsewhere', 'elsewhere')).status).toBe(409);
  expect((await (await read()).json()).ownBookmark).toEqual({ saved: false, revision: 0, accessEpoch: 1 });
  expect((await put(input(true, 0, 1))).status).toBe(200);
});

test('revocation without any prior setting/access row still rejects a delayed first save after rejoin', async () => {
  session('admin'); expect((await remove()).status).toBe(200);
  expect(await prisma.spaceMissionBookmarkAccess.findUnique({ where: { userId: 'learner' } })).toEqual({ userId: 'learner', epoch: 1 });
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'learner' } }); session();
  expect((await put()).status).toBe(409);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
  expect((await put(input(true, 0, 1))).status).toBe(200);
});

test('mission close clears settings atomically, full DTO becomes null and future saves fail closed', async () => {
  await put(); session('admin'); expect((await closeMission(request('PATCH', { closed: true }), context())).status).toBe(200);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
  session(); expect((await (await read()).json()).ownBookmark).toBeNull();
  expect((await put(input(true, 1))).status).toBe(404);
  expect((await (await list('?view=saved')).json()).items).toEqual([]);
});

test('bookmark-clearing failure rolls back mission close and membership removal, with no partial epoch fence', async () => {
  await put(); session('admin');
  const transact = prisma.$transaction.bind(prisma);
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) => transact(async tx => {
    jest.spyOn(tx.spaceMissionBookmarkSetting, 'deleteMany').mockRejectedValue(new Error('Storage canary'));
    return work(tx);
  }, options as never)) as never);
  expect((await closeMission(request('PATCH', { closed: true }), context())).status).toBe(500);
  expect((await remove()).status).toBe(500);
  expect(await prisma.spaceMission.findUnique({ where: { id: 'mission' } })).toMatchObject({ closedAt: null });
  expect(await prisma.spaceMember.count({ where: { spaceId: 'private', userId: 'learner' } })).toBe(1);
  expect(await prisma.spaceMissionBookmarkAccess.findUnique({ where: { userId: 'learner' } })).toMatchObject({ epoch: 0 });
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(1);
});

test.each([null, 'missing', 'invalid/id'])('missing live account %s is rejected 401 without exposing mission state', async id => {
  session(id); const response = await put(); expect(response.status).toBe(401); noStore(response);
});
test.each([null, [], {}, { saved: true }, { ...input(), userId: 'other' }, { ...input(), savedAt: '2026-01-01' },
  { ...input(), saved: 'true' }, { ...input(), accessEpoch: -1 }, { ...input(), expectedRevision: 1.5 },
  { ...input(), expectedRevision: 2147483648 }, { ...input(), accessEpoch: '0' }])('strict bookmark body rejects %j', async body => {
  const response = await put(body); expect(response.status).toBe(400); noStore(response);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
});
test('origin, bounded body, wrong Space/mission and public visibility failures are private no-store', async () => {
  const denied = [await put(input(), 'mission', 'private', { origin: 'https://evil.example.invalid' }),
    await put({ ...input(), padding: 'x'.repeat(2000) }), await put(input(), 'missing'), await put(input(), 'mission', 'missing')];
  expect(denied.map(response => response.status)).toEqual([403, 413, 404, 404]); denied.forEach(noStore);
  await prisma.space.update({ where: { id: 'private' }, data: { visibility: 'PUBLIC' } });
  const publicResponse = await put(); expect(publicResponse.status).toBe(404); noStore(publicResponse);
});

test('versions cannot overflow or reset; failed fence at maximum retains membership and saved state', async () => {
  await put();
  await prisma.spaceMissionBookmarkSetting.updateMany({ data: { revision: 2147483647 } });
  expect((await put(input(false, 2147483647))).status).toBe(409);
  await prisma.spaceMissionBookmarkAccess.update({ where: { userId: 'learner' }, data: { epoch: 2147483647 } });
  session('admin'); expect((await remove()).status).toBe(409);
  expect(await prisma.spaceMember.count({ where: { spaceId: 'private', userId: 'learner' } })).toBe(1);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(1);
});

test('saved filtering precedes bounded keyset pagination, handles equal times, and isolates foreign saved rows', async () => {
  const ids = Array.from({ length: 44 }, (_, i) => `page-${i.toString().padStart(3, '0')}`);
  for (const id of ids) await seedMission(id, `space-${id}`, ['learner', 'other']);
  const savedIds = ids.filter((_, i) => i % 2 === 0).reverse();
  await prisma.spaceMissionBookmarkSetting.createMany({ data: ids.map((missionId, i) => ({ missionId,
    userId: i % 2 === 0 ? 'learner' : 'other', revision: 1, savedAt: new Date() })) });
  const first = await (await list('?view=saved')).json(); expect(first.items).toHaveLength(20);
  expect(first.items.map((item: { id: string }) => item.id)).toEqual(savedIds.slice(0, 20));
  const second = await (await list(`?view=saved&cursor=${first.nextCursor}`)).json();
  expect(second.items.map((item: { id: string }) => item.id)).toEqual(savedIds.slice(20));
  expect(second.nextCursor).toBeNull();
  expect(first.items.every((item: { ownBookmark: unknown }) => JSON.stringify(item.ownBookmark) === JSON.stringify({ saved: true, revision: 1, accessEpoch: 0 }))).toBe(true);
  expect(JSON.stringify(first)).not.toMatch(/private-canary|prompt|email|password|participants|savedAt|userId/);
  const allCursor = (await (await list()).json()).nextCursor;
  for (const query of [`?view=all&cursor=${first.nextCursor}`, `?view=saved&cursor=${allCursor}`, '?view=unknown', '?view=', '?view=saved&view=all']) {
    const response = await list(query); expect(response.status).toBe(400); noStore(response);
  }
  session('admin'); expect((await remove()).status).toBe(200); session();
  expect((await list(`?view=saved&cursor=${first.nextCursor}`)).status).toBe(400);
});

test('saved prefix refresh removes current raw access loss and close while GET does not claim historical raw rejoin detection', async () => {
  await put(); await prisma.spaceMember.deleteMany({ where: { userId: 'learner' } });
  expect((await (await list('?view=saved')).json()).items).toEqual([]);
  expect((await put(input(false, 1))).status).toBe(404);
  // Direct SQL/legacy mutation bypasses official hooks; only live absence is observable.
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'learner' } });
  expect((await (await list('?view=saved')).json()).items).toHaveLength(1);
});

test('mission/account erasure cascades bookmark rows and account erasure also clears its fence', async () => {
  await put(); await prisma.spaceMission.delete({ where: { id: 'mission' } });
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
  expect(await prisma.spaceMissionBookmarkAccess.count()).toBe(1);
  await prisma.user.delete({ where: { id: 'learner' } });
  expect(await prisma.spaceMissionBookmarkAccess.count()).toBe(0);
});

test('parallel same-revision actions serialize with exactly one success and no lost tombstone', async () => {
  const responses = await Promise.all([put(input(false)), put(input(true)), put(input(true))]);
  expect(responses.filter(response => response.status === 200)).toHaveLength(1);
  expect(responses.filter(response => response.status === 409)).toHaveLength(2);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(1);
  expect((await (await read()).json()).ownBookmark.revision).toBe(1);
});

test('a unique first-create retry reauthorizes and rejects an intervening official revoke/rejoin', async () => {
  const transact = prisma.$transaction.bind(prisma); let attempts = 0;
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) => {
    if (++attempts !== 1) return transact(work, options as never);
    try { return await transact(async tx => { await work(tx); throw new Prisma.PrismaClientKnownRequestError('Unique race', { code: 'P2002', clientVersion: '7.10.0' }); }, options as never); }
    catch (error) {
      await transact(async tx => { await revokeSpaceMissionBookmarks('private', 'learner', tx); await tx.spaceMember.deleteMany({ where: { spaceId: 'private', userId: 'learner' } }); });
      await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'learner' } }); throw error;
    }
  }) as never);
  expect((await put()).status).toBe(409); expect(attempts).toBe(2);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
});

/** Two independent installed-provider adapters see the same absent access row.
 * PostgreSQL must abort a real concurrent transaction, then our complete retry
 * rechecks membership, epoch and CAS. No mocked conflict creates this evidence. */
const providerName = process.env.SPACE_MISSIONS_POSTGRESQL_DISPOSABLE === '1' ? 'PostgreSQL' : 'SQLite';
async function withIndependentRace(run: () => Promise<void>, barrier: 'access' | 'mission' = 'access') {
  const clients: PrismaClient[] = Array.from({ length: 2 }, () => jest.requireMock('@/lib/prisma').__newClient());
  let arrivals = 0; let attempts = 0; const realFailures: unknown[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) => {
    const ordinal = attempts++; const client = clients[ordinal % clients.length];
    return client.$transaction(async tx => {
      if (ordinal < 2) {
        const delegate = (barrier === 'access' ? tx.spaceMissionBookmarkAccess : tx.spaceMission) as unknown as {
          findUnique: (args: unknown) => Promise<unknown>; findFirst: (args: unknown) => Promise<unknown>;
        };
        const method = barrier === 'access' ? 'findUnique' : 'findFirst';
        const find = delegate[method].bind(delegate);
        jest.spyOn(delegate, method).mockImplementation(async (args: unknown) => {
          const row = await find(args); if (++arrivals === 2) release(); await gate; return row;
        });
      }
      return work(tx);
    }, options as never).catch(error => { realFailures.push(error); throw error; });
  }) as never);
  try { await run(); expect(attempts).toBeGreaterThanOrEqual(3); expect(realFailures.length).toBeGreaterThanOrEqual(1); }
  finally { transactions.mockRestore(); await Promise.all(clients.map(client => client.$disconnect())); }
}

test(`actual ${providerName} independent first-save access-row collision retries without dropping either mission setting`, async () => {
  await seedMission('second', 'second');
  await withIndependentRace(async () => {
    const results = await Promise.all([setMissionBookmark('private', 'mission', 'learner', input()), setMissionBookmark('second', 'second', 'learner', input())]);
    expect(results).toEqual([{ saved: true, revision: 1, accessEpoch: 0 }, { saved: true, revision: 1, accessEpoch: 0 }]);
  });
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(2);
  expect(await prisma.spaceMissionBookmarkAccess.count()).toBe(1);
});

test(`actual ${providerName} first-save versus revoke fence cannot resurrect a bookmark after rejoin`, async () => {
  await withIndependentRace(async () => {
    const results = await Promise.allSettled([
      setMissionBookmark('private', 'mission', 'learner', input()),
      bookmarkTransaction(async tx => { await revokeSpaceMissionBookmarks('private', 'learner', tx); await tx.spaceMember.deleteMany({ where: { spaceId: 'private', userId: 'learner' } }); }),
    ]);
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') expect(results[0].reason).toMatchObject({ status: 404 });
  });
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
  expect(await prisma.spaceMissionBookmarkAccess.findUnique({ where: { userId: 'learner' } })).toMatchObject({ epoch: 1 });
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'learner' } });
  expect((await put()).status).toBe(409);
});


test.each([
  { name: 'DriverAdapterError', cause: { kind: 'SocketTimeout', originalCode: 'SQLITE_BUSY' } },
  new DriverAdapterError({ kind: 'SocketTimeout', originalCode: 'OTHER_TIMEOUT' }),
  new Prisma.PrismaClientKnownRequestError('Unrelated timeout', { code: 'P1008', clientVersion: '7.10.0', meta: { driverAdapterError: { cause: { kind: 'SocketTimeout', originalCode: 'SQLITE_BUSY' } } } }),
])('unverified or unrelated timeout is not retried: %j', async error => {
  const transaction = jest.spyOn(prisma, '$transaction').mockRejectedValue(error);
  const response = await put(); expect(response.status).toBe(500); noStore(response);
  expect(transaction).toHaveBeenCalledTimes(1);
});

test('known unique retry exhaustion returns private409 with no partial bookmark or fence', async () => {
  const transact = prisma.$transaction.bind(prisma);
  const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) =>
    transact(async tx => { await work(tx); throw new Prisma.PrismaClientKnownRequestError('Unique race', { code: 'P2002', clientVersion: '7.10.0' }); }, options as never)) as never);
  const response = await put(); expect(response.status).toBe(409); noStore(response);
  expect(transaction).toHaveBeenCalledTimes(4);
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
  expect(await prisma.spaceMissionBookmarkAccess.count()).toBe(0);
});


test(`actual ${providerName} independent same-revision save/unsave preserves a single winning CAS`, async () => {
  await put();
  await withIndependentRace(async () => {
    const results = await Promise.allSettled([
      setMissionBookmark('private', 'mission', 'learner', input(false, 1)),
      setMissionBookmark('private', 'mission', 'learner', input(true, 1)),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) })]);
  });
  expect(await prisma.spaceMissionBookmarkSetting.findUnique({ where: { missionId_userId: { missionId: 'mission', userId: 'learner' } } })).toMatchObject({ revision: 2 });
  expect((await put(input(true, 1))).status).toBe(409);
});

test(`actual ${providerName} first save versus mission close leaves no bookmark and prevents resurrection`, async () => {
  await withIndependentRace(async () => {
    const results = await Promise.allSettled([
      setMissionBookmark('private', 'mission', 'learner', input()),
      closeMissionService('private', 'mission', 'admin'),
    ]);
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') expect(results[0].reason).toMatchObject({ status: 404 });
  }, 'mission');
  expect(await prisma.spaceMissionBookmarkSetting.count()).toBe(0);
  expect((await put()).status).toBe(404);
});
