/** @jest-environment node */

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { getServerSession } from '@/lib/sites-auth/server';
import { GET as list, POST as post } from '@/app/api/spaces/[spaceId]/polls/route';
import { GET as get, PATCH as patch } from '@/app/api/spaces/[spaceId]/polls/[pollId]/route';
import { PUT as put } from '@/app/api/spaces/[spaceId]/polls/[pollId]/vote/route';

jest.setTimeout(30000);
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({ sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() }));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@prisma/client');
  if (process.env.SPACE_POLLS_POSTGRESQL_DISPOSABLE === '1') {
    const { missionTestDatabaseUrl } = require('../../scripts/space-mission-test-database.cjs');
    const validatedUrl = missionTestDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER);
    const { randomUUID } = require('node:crypto');
    const { spawnSync } = require('node:child_process');
    const { Client } = require('pg');
    const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
    const schema = `forge_poll_${randomUUID().replaceAll('-', '_')}`;
    const scopedUrl = new URL(validatedUrl); scopedUrl.searchParams.set('schema', schema);
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: validatedUrl }, { schema }) });
    return { __esModule: true, default: runtime,
      __initialize: async () => {
        const db = new Client({ connectionString: validatedUrl }); await db.connect();
        try { await db.query(`CREATE SCHEMA "${schema}"`); } finally { await db.end(); }
        const result = spawnSync(process.execPath, ['scripts/db-deploy.mjs', '--initialize-empty-schema'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
          env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: scopedUrl.toString() },
        });
        if (result.status !== 0) throw new Error(`Poll PostgreSQL deployment failed: ${result.error?.message ?? result.stderr}`);
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
  const path = join(mkdtempSync(join(tmpdir(), 'forge-space-polls-')), 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});
const session = (id: string | null = 'admin', role = 'ADMIN') => jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
const request = (method = 'GET', body?: object, path = '/api/spaces/private/polls', headers = {}) => new Request(`http://localhost${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
}) as never;
const space = (spaceId = 'private') => ({ params: Promise.resolve({ spaceId }) });
const poll = (pollId: string, spaceId = 'private') => ({ params: Promise.resolve({ spaceId, pollId }) });
const input = (requestId = 'create-one') => ({ question: 'Which topic should we discuss?', options: ['Accessibility', 'Testing'], requestId });
const read = (id: string, spaceId = 'private') => get(request(), poll(id, spaceId));
const vote = (id: string, optionId: string, expectedRevision = 0, requestId = 'vote-one', spaceId = 'private') => put(request('PUT', { optionId, expectedRevision, requestId }), poll(id, spaceId));
const moderate = (id: string, body: object, spaceId = 'private') => patch(request('PATCH', body), poll(id, spaceId));
const create = async (body = input(), spaceId = 'private') => {
  const response = await post(request('POST', body), space(spaceId)); expect(response.status).toBe(201); return response.json();
};
const conflict = () => new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;

beforeAll(async () => { await jest.requireMock('@/lib/prisma').__initialize?.(); }, 120000);
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks(); jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.spacePoll.deleteMany(); await prisma.spaceMember.deleteMany(); await prisma.space.deleteMany(); await prisma.user.deleteMany();
  await prisma.user.createMany({ data: ['admin', 'admin2', 'member', 'member2', 'outsider', 'moderator'].map(id => ({
    id, email: `${id}@example.invalid`, role: id.startsWith('admin') ? 'ADMIN' as const : id === 'moderator' ? 'MODERATOR' as const : 'USER' as const,
  })) });
  await prisma.space.createMany({ data: ['private', 'public', 'other'].map(id => ({ id, name: id, description: 'Poll decisions', visibility: id === 'public' ? 'PUBLIC' as const : 'PRIVATE' as const })) });
  await prisma.spaceMember.createMany({ data: ['private', 'public'].flatMap(spaceId => ['member', 'member2', 'moderator'].map(userId => ({ spaceId, userId }))) });
  session();
});
afterAll(async () => { await prisma.$disconnect(); await jest.requireMock('@/lib/prisma').__finalize?.(); });

test('creates immutable bounded sanitized question/options with scoped idempotent replay', async () => {
  const item = await create({ ...input(), question: '  <b>Which topic</b> should we discuss? ' });
  expect(item).toMatchObject({ question: input().question, totalVotes: 0, ownVote: { optionId: null, revision: 0 }, canVote: false, canManage: true });
  expect(item.options).toEqual([expect.objectContaining({ label: 'Accessibility', votes: 0 }), expect.objectContaining({ label: 'Testing', votes: 0 })]);
  const replay = await post(request('POST', input()), space()); expect(replay.status).toBe(200); expect((await replay.json()).id).toBe(item.id);
  expect((await post(request('POST', { ...input(), question: 'Something different?' }), space())).status).toBe(409);
  session('admin2'); expect((await post(request('POST', input()), space())).status).toBe(409);
  expect(await prisma.spacePoll.count()).toBe(1);
  expect(JSON.stringify(item)).not.toMatch(/creator|author|userId|email|requestId|payloadDigest|reward|leaderboard/i);
});

test.each(['member', 'moderator', 'outsider', 'missing'])('live %s account cannot create through stale admin claims', async id => {
  session(id); expect((await post(request('POST', input()), space())).status).toBe(['outsider', 'missing'].includes(id) ? 404 : 403);
  expect(await prisma.spacePoll.count()).toBe(0);
});

test('all APIs enforce login, current account/membership, private admin scope and no-store outcomes', async () => {
  const item = await create(); session(null);
  for (const response of [await list(request(), space()), await read(item.id), await vote(item.id, item.options[0].id), await moderate(item.id, { closed: true }), await post(request('POST', input()), space())]) {
    expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toContain('no-store');
  }
  for (const id of ['outsider', 'missing']) {
    session(id); expect((await read(item.id)).status).toBe(404);
    expect((await list(request('GET', undefined, '/api/spaces/private/polls?cursor=bad'), space())).status).toBe(404);
    expect((await vote(item.id, item.options[0].id)).status).toBe(404);
  }
  session('admin2'); expect((await read(item.id)).status).toBe(200);
  await prisma.user.update({ where: { id: 'admin2' }, data: { role: 'USER' } });
  expect((await read(item.id)).status).toBe(404);
  session('member'); await prisma.spaceMember.delete({ where: { spaceId_userId: { spaceId: 'private', userId: 'member' } } });
  expect((await read(item.id)).status).toBe(404);
  expect((await vote(item.id, item.options[0].id)).status).toBe(404);
});

test('PUBLIC polls are signed-in readable but voting requires a current Space membership', async () => {
  const item = await create(input(), 'public'); session('outsider', 'USER');
  expect((await read(item.id, 'public')).status).toBe(200);
  expect((await vote(item.id, item.options[0].id, 0, 'vote', 'public')).status).toBe(403);
  await prisma.spaceMember.create({ data: { spaceId: 'public', userId: 'outsider' } });
  expect((await vote(item.id, item.options[0].id, 0, 'vote', 'public')).status).toBe(200);
  await prisma.spaceMember.delete({ where: { spaceId_userId: { spaceId: 'public', userId: 'outsider' } } });
  const result = await (await read(item.id, 'public')).json(); expect(result).toMatchObject({ totalVotes: 1, canVote: false });
  expect((await vote(item.id, item.options[1].id, 1, 'changed', 'public')).status).toBe(403);
});

test('one choice changes atomically, exact replay never reverts later choice and voters are not projected', async () => {
  const item = await create(); session('member', 'USER');
  const first = await vote(item.id, item.options[0].id); expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ totalVotes: 1, ownVote: { optionId: item.options[0].id, revision: 1 } });
  expect((await vote(item.id, item.options[0].id)).status).toBe(200);
  expect((await vote(item.id, item.options[1].id)).status).toBe(409);
  const second = await vote(item.id, item.options[1].id, 1, 'change'); expect(second.status).toBe(200);
  const replay = await (await vote(item.id, item.options[0].id)).json();
  expect(replay).toMatchObject({ totalVotes: 1, ownVote: { optionId: item.options[1].id, revision: 2 } });
  expect((await vote(item.id, item.options[0].id, 0, 'stale')).status).toBe(409);
  session('member2'); const view = await (await read(item.id)).json();
  expect(view).toMatchObject({ totalVotes: 1, ownVote: { optionId: null, revision: 0 } });
  expect(JSON.stringify(view)).not.toMatch(/member|voters|userId|email|creator|requestId|payloadDigest/);
  expect(await prisma.spacePollVote.count()).toBe(1); expect(await prisma.spacePollVoteRequest.count()).toBe(2);
  expect(await prisma.rewardLedger.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.post.count()).toBe(0); expect(await prisma.courseContentProgress.count()).toBe(0);
});

test('wrong Space and cross-poll option cannot target a poll or create a vote', async () => {
  const one = await create(); const two = await create(input('two'));
  session('member'); expect((await read(one.id, 'public')).status).toBe(404);
  expect((await vote(one.id, two.options[0].id)).status).toBe(400);
  expect(await prisma.spacePollVote.count()).toBe(0);
  expect((await read('../bad')).status).toBe(404);
});

test('closing is monotonic and idempotent, blocks changes, while an authorized old vote replay is a no-op', async () => {
  const item = await create(); session('member'); await vote(item.id, item.options[0].id);
  expect((await moderate(item.id, { closed: true })).status).toBe(403);
  session(); const closed = await (await moderate(item.id, { closed: true })).json();
  expect(closed.closedAt).not.toBeNull();
  const again = await (await moderate(item.id, { closed: true })).json(); expect(again.closedAt).toBe(closed.closedAt);
  expect((await moderate(item.id, { closed: false })).status).toBe(400);
  session('member'); expect((await vote(item.id, item.options[0].id)).status).toBe(200);
  expect((await vote(item.id, item.options[1].id, 1, 'change')).status).toBe(409);
  expect(await prisma.spacePollVoteRequest.count()).toBe(1);
});

test('hidden polls are excluded for ordinary viewers, admin toggle is revision-checked and replay-safe', async () => {
  const item = await create(); const hidden = await (await moderate(item.id, { hidden: true, expectedRevision: 0 })).json();
  expect(hidden).toMatchObject({ moderationRevision: 1, canVote: false });
  expect((await moderate(item.id, { hidden: true, expectedRevision: 0 })).status).toBe(200);
  session('member'); expect((await read(item.id)).status).toBe(404); expect((await vote(item.id, item.options[0].id)).status).toBe(404);
  expect((await (await list(request(), space())).json()).items).toEqual([]);
  session(); expect((await (await list(request(), space())).json()).items).toHaveLength(1);
  expect((await moderate(item.id, { hidden: false, expectedRevision: 0 })).status).toBe(409);
  expect((await moderate(item.id, { hidden: false, expectedRevision: 1 })).status).toBe(200);
  expect((await moderate(item.id, { hidden: true, expectedRevision: 0 })).status).toBe(409);
});

test.each([
  { question: 'bad' }, { question: '😀😀😀' }, { question: 'a'.repeat(201) }, { question: 'a'.repeat(801) },
  { options: ['one'] }, { options: Array.from({ length: 9 }, (_, i) => String(i)) }, { options: ['same', 'SAME'] },
  { options: ['a', '<b></b>'] }, { options: ['a', 'b'.repeat(101)] }, { options: [1, 'b'] },
  { requestId: '../bad' }, { voterId: 'member' }, { hidden: false },
])('rejects invalid creation without writing: %j', async invalid => {
  const response = await post(request('POST', { ...input(), ...invalid }), space()); expect(response.status).toBe(400);
  expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(await prisma.spacePoll.count()).toBe(0);
});

test('mutation CSRF, body bounds, vote shape and moderation shape fail before writes', async () => {
  const item = await create(); session('member');
  expect((await put(request('PUT', { optionId: item.options[0].id, expectedRevision: 0, requestId: 'one' }, undefined, { origin: 'https://evil.invalid' }), poll(item.id))).status).toBe(403);
  for (const invalid of [{ userId: 'member2' }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: 2147483646 }, { requestId: '' }]) {
    expect((await put(request('PUT', { optionId: item.options[0].id, expectedRevision: 0, requestId: 'one', ...invalid }), poll(item.id))).status).toBe(400);
  }
  expect(await prisma.spacePollVote.count()).toBe(0);
  session(); expect((await post(request('POST', { ...input(), question: 'x'.repeat(7000) }), space())).status).toBe(413);
  expect((await moderate(item.id, { hidden: true, expectedRevision: -1 })).status).toBe(400);
  expect((await moderate(item.id, { closed: true, hidden: true })).status).toBe(400);
});

test('durable per-account vote limits and per-Space create limits permit exact retries at the limit', async () => {
  const item = await create(); session('member');
  for (let i = 0; i < 12; i++) expect((await vote(item.id, item.options[i % 2].id, i, `change-${i}`)).status).toBe(200);
  expect((await vote(item.id, item.options[0].id, 12, 'too-fast')).status).toBe(429);
  expect((await vote(item.id, item.options[1].id, 11, 'change-11')).status).toBe(200);
  await prisma.spacePollVoteRequest.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
  await prisma.spacePollVoteRequest.createMany({ data: Array.from({ length: 88 }, (_, i) => ({ pollId: item.id, userId: 'member', requestId: `older-${i}`, payloadDigest: 'digest', createdAt: new Date(0) })) });
  expect((await vote(item.id, item.options[0].id, 12, 'lifetime')).status).toBe(429);
  session(); for (let i = 1; i < 10; i++) await create(input(`poll-${i}`));
  expect((await post(request('POST', input('too-many')), space())).status).toBe(429);
  expect((await post(request('POST', input()), space())).status).toBe(200);
});

test('bounded cursor is stable, Space-scoped, malformed-safe and checked only after access', async () => {
  for (let i = 0; i < 12; i++) await prisma.spacePoll.create({ data: { id: `poll${String(i).padStart(2, '0')}`, spaceId: 'private', creatorId: 'admin', question: 'A bounded poll?', requestId: `req-${i}`, payloadDigest: 'digest', createdAt: new Date('2030-01-01'), options: { create: [{ label: 'A', position: 0 }, { label: 'B', position: 1 }] } } });
  const first = await (await list(request(), space())).json(); expect(first.items).toHaveLength(10); expect(first.nextCursor).toBeTruthy();
  const second = await (await list(request('GET', undefined, `/api/spaces/private/polls?cursor=${first.nextCursor}`), space())).json();
  expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(12);
  expect((await list(request('GET', undefined, `/api/spaces/public/polls?cursor=${first.nextCursor}`), space('public'))).status).toBe(400);
  expect((await list(request('GET', undefined, '/api/spaces/private/polls?cursor=bad'), space())).status).toBe(400);
});

test('account erasure removes votes/receipts, creator erasure preserves the decision without identity', async () => {
  const item = await create(); session('member'); await vote(item.id, item.options[0].id);
  await prisma.user.delete({ where: { id: 'member' } }); expect(await prisma.spacePollVote.count()).toBe(0); expect(await prisma.spacePollVoteRequest.count()).toBe(0);
  await prisma.user.delete({ where: { id: 'admin' } }); session('admin2');
  expect((await read(item.id)).status).toBe(200); expect((await prisma.spacePoll.findUnique({ where: { id: item.id } }))?.creatorId).toBeNull();
});

test('retry re-resolves authorization and recognizes commit-time adapter conflicts only', async () => {
  const item = await create(); session('member');
  const original = prisma.$transaction.bind(prisma);
  let calls = 0;
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options?: object) => {
    if (++calls === 1) {
      await prisma.spaceMember.delete({ where: { spaceId_userId: { spaceId: 'private', userId: 'member' } } });
      throw new DriverAdapterError({ kind: 'TransactionWriteConflict', originalCode: '40001', originalMessage: 'serialization conflict' });
    }
    return original(work, options as never);
  }) as never);
  expect((await vote(item.id, item.options[0].id)).status).toBe(404); expect(calls).toBe(2); expect(await prisma.spacePollVote.count()).toBe(0);
  jest.restoreAllMocks(); session(); jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(prisma, '$transaction').mockRejectedValue(conflict()); expect((await read(item.id)).status).toBe(409);
});

const pgOnly = process.env.SPACE_POLLS_POSTGRESQL_DISPOSABLE === '1' ? test : test.skip;
/** The first two real transactions have passed all reads/quotas/revisions before
 * either writes. Retried transactions bypass the one-shot barrier. */
async function overlapWrites<T>(model: 'spacePoll' | 'spacePollVote', operation: 'create' | 'upsert', run: () => Promise<T>, second?: { model: 'spacePoll'; operation: 'update' }): Promise<T> {
  const original = prisma.$transaction.bind(prisma);
  let arrivals = 0;
  let release!: () => void;
  let timeout!: ReturnType<typeof setTimeout>;
  const barrier = new Promise<void>((resolve, reject) => {
    release = resolve;
    timeout = setTimeout(() => reject(new Error('Both PostgreSQL transactions must reach the write barrier')), 10_000);
  });
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options?: object) => original(async tx => {
    const wrappedDelegate = (name: 'spacePoll' | 'spacePollVote', method: string) => {
      const delegate = tx[name];
      return new Proxy(delegate, { get(target, key) {
        const value = Reflect.get(target, key);
        if (key === method) return async (...args: unknown[]) => {
          const arrival = ++arrivals;
          if (arrival <= 2) { if (arrival === 2) release(); await barrier; }
          return Reflect.apply(value, target, args);
        };
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const wrapped = wrappedDelegate(model, operation);
    const other = second ? wrappedDelegate(second.model, second.operation) : null;
    const snapshot = new Proxy(tx, { get(target, key) { return key === model ? wrapped : second && key === second.model ? other : Reflect.get(target, key); } });
    return work(snapshot);
  }, options as never)) as never);
  try { const result = await run(); expect(arrivals).toBeGreaterThanOrEqual(2); return result; }
  finally { release(); clearTimeout(timeout); spy.mockRestore(); }
}

pgOnly('PostgreSQL overlapping different choices claim one revision and later original replay cannot reverse a change', async () => {
  const item = await create(); session('member');
  const results = await overlapWrites('spacePollVote', 'upsert', () => Promise.all([
    vote(item.id, item.options[0].id, 0, 'first'), vote(item.id, item.options[1].id, 0, 'second'),
  ]));
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
  const winner = results[0].status === 200 ? 0 : 1;
  const state = await prisma.spacePollVote.findUniqueOrThrow({ where: { pollId_userId: { pollId: item.id, userId: 'member' } } });
  expect(state).toMatchObject({ optionId: item.options[winner].id, revision: 1 });
  expect(await prisma.spacePollVote.count()).toBe(1); expect(await prisma.spacePollVoteRequest.count()).toBe(1);
  const view = await (await read(item.id)).json(); expect(view.totalVotes).toBe(1); expect(view.options[winner].votes).toBe(1);
  expect((await vote(item.id, item.options[1 - winner].id, 1, 'changed')).status).toBe(200);
  const replay = await (await vote(item.id, item.options[winner].id, 0, winner === 0 ? 'first' : 'second')).json();
  expect(replay.ownVote).toEqual({ optionId: item.options[1 - winner].id, revision: 2 });
  expect(replay.totalVotes).toBe(1); expect(await prisma.spacePollVoteRequest.count()).toBe(2);
});

pgOnly('PostgreSQL overlapping identical vote requests both succeed with one receipt/choice/revision', async () => {
  const item = await create(); session('member');
  const results = await overlapWrites('spacePollVote', 'upsert', () => Promise.all([
    vote(item.id, item.options[0].id), vote(item.id, item.options[0].id),
  ]));
  expect(results.map(response => response.status)).toEqual([200, 200]);
  expect(await prisma.spacePollVote.count()).toBe(1); expect(await prisma.spacePollVoteRequest.count()).toBe(1);
  expect(await prisma.spacePollVote.findFirst()).toMatchObject({ optionId: item.options[0].id, revision: 1 });
  expect((await (await read(item.id)).json()).totalVotes).toBe(1);
});

pgOnly('PostgreSQL overlapping creates cannot exceed the durable per-Space daily quota', async () => {
  for (let i = 0; i < 9; i++) await create(input(`seed-${i}`));
  const results = await overlapWrites('spacePoll', 'create', () => Promise.all([
    post(request('POST', input('parallel-a')), space()), post(request('POST', input('parallel-b')), space()),
  ]));
  expect(results.map(response => response.status).sort()).toEqual([201, 429]); expect(await prisma.spacePoll.count()).toBe(10);
});

pgOnly('PostgreSQL overlapping votes on distinct polls cannot exceed the account-wide minute quota', async () => {
  const seed = await create(); const a = await create(input('a')); const b = await create(input('b')); session('member');
  for (let i = 0; i < 11; i++) expect((await vote(seed.id, seed.options[i % 2].id, i, `seed-${i}`)).status).toBe(200);
  const results = await overlapWrites('spacePollVote', 'upsert', () => Promise.all([
    vote(a.id, a.options[0].id, 0, 'parallel-a'), vote(b.id, b.options[0].id, 0, 'parallel-b'),
  ]));
  expect(results.map(response => response.status).sort()).toEqual([200, 429]);
  expect(await prisma.spacePollVoteRequest.count({ where: { userId: 'member' } })).toBe(12);
  expect(await prisma.spacePollVote.count({ where: { userId: 'member' } })).toBe(2);
});

pgOnly('PostgreSQL close overlapping a vote preserves a serial order and never accepts a post-close change', async () => {
  const item = await create();
  // Capture separate sessions at the handler boundary before entering either transaction.
  jest.mocked(getServerSession).mockResolvedValueOnce({ user: { id: 'member', role: 'USER' } } as never)
    .mockResolvedValueOnce({ user: { id: 'admin', role: 'ADMIN' } } as never);
  const results = await overlapWrites('spacePollVote', 'upsert', () => Promise.all([
    vote(item.id, item.options[0].id), moderate(item.id, { closed: true }),
  ]), { model: 'spacePoll', operation: 'update' });
  expect(results[1].status).toBe(200); expect([200, 409]).toContain(results[0].status);
  session('member'); const final = await (await read(item.id)).json(); expect(final.closedAt).not.toBeNull();
  expect(final.totalVotes).toBe(results[0].status === 200 ? 1 : 0);
  expect(await prisma.spacePollVoteRequest.count()).toBe(final.totalVotes);
  expect((await vote(item.id, item.options[1].id, final.ownVote.revision, 'after-closed')).status).toBe(409);
});

test('provider database constraints reject cross-poll votes and invalid option size/position', async () => {
  const a = await create(); const b = await create(input('b'));
  await expect(prisma.spacePollVote.create({ data: { pollId: a.id, userId: 'member', optionId: b.options[0].id, revision: 1 } })).rejects.toThrow();
  await expect(prisma.spacePollOption.create({ data: { pollId: a.id, position: 8, label: 'Ninth' } })).rejects.toThrow();
  await expect(prisma.spacePollOption.create({ data: { pollId: a.id, position: 2, label: 'x'.repeat(101) } })).rejects.toThrow();
  expect(await prisma.spacePollVote.count()).toBe(0);
});
