/** @jest-environment node */

import prisma from '@/lib/prisma';
import { Prisma, type Role, type SpaceVisibility } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { dynamic, GET } from '@/app/api/space-missions/route';

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
    const schema = `forge_overview_${randomUUID().replaceAll('-', '_')}`;
    const scopedUrl = new URL(validatedUrl); scopedUrl.searchParams.set('schema', schema);
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: validatedUrl }, { schema }), log });
    runtime.$on('query', (event: { query: string }) => queries.push(event.query));
    return { __esModule: true, default: runtime, __queries: queries,
      __initialize: async () => {
        const db = new Client({ connectionString: validatedUrl }); await db.connect();
        try { await db.query(`CREATE SCHEMA "${schema}"`); } finally { await db.end(); }
        const result = spawnSync(process.execPath, ['scripts/db-deploy.mjs', '--initialize-empty-schema'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
          env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: scopedUrl.toString() },
        });
        if (result.status !== 0) throw new Error(`Overview PostgreSQL deployment failed: ${result.error?.message ?? result.stderr}`);
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
  const path = join(mkdtempSync(join(tmpdir(), 'forge-mission-overview-')), 'test.db');
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
  return { __esModule: true, default: runtime, __queries: queries };
});

const session = (id: string | null = 'learner', role = 'USER') =>
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
const request = (query = '') => new Request(`http://localhost/api/space-missions${query}`) as never;
const list = (cursor?: string) => GET(request(cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`));
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const validCursor = { v: 2, kind: 'space-mission-overview', viewerId: 'learner', role: 'USER', view: 'all', accessEpoch: 0,
  createdAt: '2026-10-12T12:00:00.000Z', id: 'mission-001' };
const timestamp = new Date(validCursor.createdAt);
const queries = (): string[] => jest.requireMock('@/lib/prisma').__queries;
const noStore = (response: Response) => expect(response.headers.get('Cache-Control')).toBe('private, no-store');

async function seedMission(id: string, options: {
  members?: string[]; visibility?: SpaceVisibility; closedAt?: Date | null; createdAt?: Date;
  week?: { weekStartsOn: string; weekTimezone: string; weekStartsAt: Date; weekEndsAt: Date };
} = {}) {
  const spaceId = `space-${id}`;
  await prisma.space.create({ data: { id: spaceId, name: `Space ${id}`, description: 'Private description',
    visibility: options.visibility ?? 'PRIVATE', members: { create: (options.members ?? ['learner']).map(userId => ({ userId })) } } });
  return prisma.spaceMission.create({ data: { id, spaceId, creatorId: 'admin', title: `Mission ${id}`,
    prompt: 'Private mission prompt', requestId: id, payloadDigest: 'private-digest', createdAt: options.createdAt ?? timestamp,
    closedAt: options.closedAt ?? null, ...options.week } });
}

async function seedPage(count = 23, members = ['learner']) {
  const ids = Array.from({ length: count }, (_, i) => `mission-${i.toString().padStart(3, '0')}`);
  await prisma.space.createMany({ data: ids.map(id => ({ id: `space-${id}`, name: `Space ${id}`,
    description: 'Private description', visibility: 'PRIVATE' as const })) });
  await prisma.spaceMember.createMany({ data: ids.flatMap(id => members.map(userId => ({ spaceId: `space-${id}`, userId }))) });
  await prisma.spaceMission.createMany({ data: ids.map(id => ({ id, spaceId: `space-${id}`, creatorId: 'admin',
    title: `Mission ${id}`, prompt: 'Private mission prompt', requestId: id, payloadDigest: 'private-digest', createdAt: timestamp })) });
  return ids.reverse();
}

beforeAll(async () => { await jest.requireMock('@/lib/prisma').__initialize?.(); }, 120000);
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.spaceMission.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'learner', email: 'learner@example.invalid', role: 'USER' },
    { id: 'other', email: 'other@example.invalid', role: 'USER' },
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' },
    { id: 'moderator', email: 'moderator@example.invalid', role: 'MODERATOR' },
    { id: 'instructor', email: 'instructor@example.invalid', role: 'INSTRUCTOR' },
  ] });
  queries().length = 0;
  session();
});
afterAll(async () => { await prisma.$disconnect(); await jest.requireMock('@/lib/prisma').__finalize?.(); });

test('force-dynamic route rejects anonymous, invalid and deleted accounts without caching', async () => {
  expect(dynamic).toBe('force-dynamic');
  for (const id of [null, 'missing', 'invalid/id']) {
    session(id, 'ADMIN');
    const response = await list('malformed');
    expect(response.status).toBe(401); noStore(response);
  }
  await prisma.user.delete({ where: { id: 'learner' } });
  session();
  expect((await list()).status).toBe(401);
});

test('live accounts without eligible missions receive an empty page', async () => {
  await seedMission('foreign', { members: ['other'] });
  const response = await list();
  expect(response.status).toBe(200); noStore(response);
  expect(await response.json()).toEqual({ items: [], nextCursor: null });
});

test('omits public, closed and foreign missions before projecting any private details', async () => {
  await seedMission('included');
  await seedMission('public', { visibility: 'PUBLIC' });
  await seedMission('closed', { closedAt: new Date() });
  await seedMission('foreign', { members: ['other'] });
  const response = await list();
  expect(await response.json()).toEqual({ items: [{ id: 'included', title: 'Mission included',
    space: { id: 'space-included', name: 'Space included' }, week: null,
    windowState: 'self-paced', participationActive: false, ownBookmark: { saved: false, revision: 0, accessEpoch: 0 } }], nextCursor: null });
});

test('past soft weeks stay open and use stored window metadata at the exact end boundary', async () => {
  const week = { weekStartsOn: '2026-10-12', weekTimezone: 'Europe/Berlin',
    weekStartsAt: new Date('2026-10-11T22:00:00Z'), weekEndsAt: new Date('2026-10-18T22:00:00Z') };
  await seedMission('weekly', { week });
  await seedMission('legacy');
  jest.useFakeTimers({ now: week.weekEndsAt, doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask',
    'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  try {
    const body = await (await list()).json();
    expect(body.items.find((item: { id: string }) => item.id === 'weekly')).toEqual({ id: 'weekly', title: 'Mission weekly',
      space: { id: 'space-weekly', name: 'Space weekly' },
      week: { startDate: '2026-10-12', timezone: 'Europe/Berlin', startsAt: '2026-10-11T22:00:00.000Z', endsAt: '2026-10-18T22:00:00.000Z' },
      windowState: 'past', participationActive: false, ownBookmark: { saved: false, revision: 0, accessEpoch: 0 } });
    jest.setSystemTime(new Date(week.weekEndsAt.getTime() - 1));
    const before = await (await list()).json();
    expect(before.items.find((item: { id: string }) => item.id === 'weekly').windowState).toBe('current');
    expect(before.items.find((item: { id: string }) => item.id === 'legacy')).toMatchObject({ week: null, windowState: 'self-paced' });
    expect(await prisma.spaceMission.count({ where: { closedAt: null } })).toBe(2);
  } finally { jest.useRealTimers(); }
});

test.each(['learner', 'admin', 'moderator', 'instructor'])('live member %s sees only its own eligible active participation, ignoring session role', async id => {
  await seedMission('member', { members: [id] });
  await prisma.spaceMissionParticipation.create({ data: { missionId: 'member', userId: id, epoch: 2 } });
  session(id, id === 'learner' ? 'ADMIN' : 'USER');
  const response = await list();
  expect((await response.json()).items).toEqual([expect.objectContaining({ id: 'member', participationActive: id === 'learner' })]);
});

test('admins have no membership override, even with unrevoked participation', async () => {
  await seedMission('foreign');
  await prisma.spaceMissionParticipation.create({ data: { missionId: 'foreign', userId: 'admin', epoch: 1 } });
  session('admin');
  expect(await (await list()).json()).toEqual({ items: [], nextCursor: null });
});

test('other participants and opted-out consent never activate the viewer', async () => {
  await seedMission('others');
  await seedMission('opted-out');
  await prisma.spaceMissionParticipation.createMany({ data: [
    { missionId: 'others', userId: 'other', epoch: 1 },
    { missionId: 'opted-out', userId: 'learner', epoch: 3, optedOutAt: timestamp },
  ] });
  expect((await (await list()).json()).items.map((item: { participationActive: boolean }) => item.participationActive)).toEqual([false, false]);
});

test('keyset orders createdAt then id descending and survives deletion of an equal-time boundary row', async () => {
  const tied = await seedPage(24);
  await seedMission('newest', { createdAt: new Date(timestamp.getTime() + 1) });
  await seedMission('oldest', { createdAt: new Date(timestamp.getTime() - 1) });
  const expected = ['newest', ...tied, 'oldest'];
  const first = await (await list()).json();
  expect(first.items).toHaveLength(20);
  expect(first.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(0, 20));
  expect(JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8'))).toEqual({ ...validCursor, id: expected[19] });
  await prisma.spaceMission.delete({ where: { id: expected[19] } });
  const second = await (await list(first.nextCursor)).json();
  expect(second.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(20));
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(expected.length);
});

test('each page rechecks membership and omits revoked spaces despite lingering consent', async () => {
  const ids = await seedPage();
  await prisma.spaceMissionParticipation.createMany({ data: ids.map(missionId => ({ missionId, userId: 'learner', epoch: 1 })) });
  const first = await (await list()).json();
  expect(first.items.every((item: { participationActive: boolean }) => item.participationActive)).toBe(true);
  await prisma.spaceMember.deleteMany({ where: { userId: 'learner' } });
  const response = await list(first.nextCursor);
  expect(response.status).toBe(200); noStore(response);
  expect(await response.json()).toEqual({ items: [], nextCursor: null });
});

test('later-page missions becoming public or closed are immediately omitted', async () => {
  const ids = await seedPage(22);
  const first = await (await list()).json();
  await prisma.space.update({ where: { id: `space-${ids[20]}` }, data: { visibility: 'PUBLIC' } });
  await prisma.spaceMission.update({ where: { id: ids[21] }, data: { closedAt: new Date() } });
  expect(await (await list(first.nextCursor)).json()).toEqual({ items: [], nextCursor: null });
});

test('live role changes invalidate old cursors and recompute participation on a fresh page', async () => {
  const ids = await seedPage();
  await prisma.spaceMissionParticipation.createMany({ data: ids.map(missionId => ({ missionId, userId: 'learner', epoch: 1 })) });
  let page = await (await list()).json();
  for (const role of ['ADMIN', 'INSTRUCTOR', 'MODERATOR', 'USER'] as Role[]) {
    await prisma.user.update({ where: { id: 'learner' }, data: { role } });
    const rejected = await list(page.nextCursor);
    expect(rejected.status).toBe(400); noStore(rejected);
    page = await (await list()).json();
    expect(page.items.every((item: { participationActive: boolean }) => item.participationActive === (role === 'USER'))).toBe(true);
  }
  await prisma.user.delete({ where: { id: 'learner' } });
  const deleted = await list(page.nextCursor);
  expect(deleted.status).toBe(401); noStore(deleted);
});

test('a valid cursor cannot be reused by a different viewer', async () => {
  await seedPage(21, ['learner', 'other']);
  const first = await (await list()).json();
  session('other');
  const response = await list(first.nextCursor);
  expect(response.status).toBe(400); noStore(response);
});

test.each([
  '', 'bad!', 'x'.repeat(1025), 'a', encode(null), encode([]), encode({}),
  encode({ ...validCursor, v: 1 }), encode({ ...validCursor, kind: 'space-missions' }),
  encode({ ...validCursor, viewerId: 'other' }), encode({ ...validCursor, role: 'ADMIN' }),
  encode({ ...validCursor, extra: true }), encode({ ...validCursor, id: 'invalid/id' }),
  encode({ ...validCursor, createdAt: '2026-10-12' }), encode({ ...validCursor, createdAt: 'not-a-date' }),
  encode({ ...validCursor, createdAt: '2026-02-30T00:00:00.000Z' }), `${encode(validCursor)}=`,
])('malformed or incorrectly scoped cursor is rejected: %s', async cursor => {
  const response = await list(cursor);
  expect(response.status).toBe(400); noStore(response);
});

test('duplicate cursor parameters are rejected', async () => {
  const cursor = encode(validCursor);
  const response = await GET(request(`?cursor=${cursor}&cursor=${cursor}`));
  expect(response.status).toBe(400); noStore(response);
});

test('projection is bounded, read-only, and reads live authority and missions in the same transaction', async () => {
  const ids = await seedPage();
  await prisma.spaceMissionParticipation.createMany({ data: ids.map(missionId => ({ missionId, userId: 'learner', epoch: 1 })) });
  await prisma.spaceMissionContribution.create({ data: { id: 'private-contribution', missionId: ids[0], authorId: 'learner', epoch: 1,
    kind: 'INSIGHT', content: 'Private contribution body', requestId: 'private-request', payloadDigest: 'private-digest' } });
  const transact = prisma.$transaction.bind(prisma);
  let missionArgs: Prisma.SpaceMissionFindManyArgs | undefined;
  const calls: string[] = [];
  type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;
  const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) =>
    transact(async tx => {
      const userRead = tx.user.findUnique.bind(tx.user);
      const missionRead = tx.spaceMission.findMany.bind(tx.spaceMission);
      jest.spyOn(tx.user, 'findUnique').mockImplementation(((args: Parameters<typeof userRead>[0]) => {
        calls.push('live-user'); return userRead(args);
      }) as never);
      jest.spyOn(tx.spaceMission, 'findMany').mockImplementation(((args: Prisma.SpaceMissionFindManyArgs) => {
        calls.push('missions'); missionArgs = args; return missionRead(args);
      }) as never);
      return work(tx);
    }, options as never)) as never);
  queries().length = 0;
  const response = await list();
  const body = await response.json();
  noStore(response);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  expect(calls).toEqual(['live-user', 'missions']);
  expect(missionArgs).toMatchObject({ take: 21, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], where: {
    closedAt: null, space: { visibility: 'PRIVATE', members: { some: { userId: 'learner' } } },
  }, select: { participations: { where: { userId: 'learner', optedOutAt: null }, take: 1, select: { missionId: true } } } });
  expect(Object.keys(missionArgs!.select!).sort()).toEqual(['createdAt', 'id', 'bookmarkSettings', 'participations', 'space', 'title', 'weekEndsAt', 'weekStartsAt', 'weekStartsOn', 'weekTimezone'].sort());
  expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
  for (const item of body.items) {
    expect(Object.keys(item).sort()).toEqual(['id', 'title', 'space', 'week', 'windowState', 'participationActive', 'ownBookmark'].sort());
    expect(Object.keys(item.space).sort()).toEqual(['id', 'name']);
  }
  expect(JSON.stringify(body)).not.toMatch(/private-digest|Private mission prompt|Private contribution body|email|password|creator|participants|canJoin|progress/);
  expect(queries().filter(query => /^\s*SELECT/i.test(query)).length).toBeLessThanOrEqual(6);
  expect(queries().some(query => /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(query))).toBe(false);
  expect(queries().some(query => /SpaceMissionContribution|Notification|RewardLedger|CompletionRecord/.test(query))).toBe(false);
});

test('serialization retry reauthorizes after revocation instead of returning a stale first attempt', async () => {
  await seedMission('revoked');
  const transact = prisma.$transaction.bind(prisma);
  let attempts = 0;
  type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) => {
    if (++attempts !== 1) return transact(work, options as never);
    try {
      return await transact(async tx => {
        await work(tx);
        throw new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
      }, options as never);
    } catch (error) {
      await prisma.spaceMember.deleteMany({ where: { userId: 'learner' } });
      throw error;
    }
  }) as never);
  expect(await (await list()).json()).toEqual({ items: [], nextCursor: null });
  expect(attempts).toBe(2);
});

test('unexpected failures also return no-store responses without leaking details', async () => {
  jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('Private database error'));
  const response = await list();
  expect(response.status).toBe(500); noStore(response);
  expect(await response.json()).toEqual({ error: 'Missionen konnten nicht geladen werden' });
});
