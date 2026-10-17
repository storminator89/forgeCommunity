/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/community/bookmarks/route';
import { POST } from '@/app/api/community/bookmarks/state/route';
import { GET as openSaved, PUT } from '@/app/api/community/bookmarks/[kind]/[targetId]/route';
import { listCommunityBookmarks, parseBookmarkInput, parseBookmarkTargets, readCommunityBookmarkStates, setCommunityBookmark } from '@/lib/server/community-bookmarks';
import { resetRateLimitStore } from '@/lib/server/rate-limit';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init), redirect: (url: URL, init: ResponseInit) => new Response(null, { ...init, headers: { ...init.headers, Location: url.toString() } }) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@prisma/client');
  if (process.env.COMMUNITY_BOOKMARK_POSTGRESQL_DISPOSABLE === '1') {
    const { missionTestDatabaseUrl } = require('../scripts/space-mission-test-database.cjs');
    const url = missionTestDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER);
    const { randomUUID } = require('node:crypto');
    const { spawnSync } = require('node:child_process');
    const { Client } = require('pg');
    const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
    const schema = `forge_community_bookmark_${randomUUID().replaceAll('-', '_')}`;
    const scoped = new URL(url); scoped.searchParams.set('schema', schema);
    const queries: string[] = [];
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }), log: [{ emit: 'event', level: 'query' }] });
    runtime.$on('query', (event: { query: string }) => queries.push(event.query));
    return { __esModule: true, default: runtime, __queries: queries,
      __initialize: async () => {
        const db = new Client({ connectionString: url }); await db.connect();
        try {
          await db.query(`CREATE SCHEMA "${schema}"`);
          const result = spawnSync(process.execPath, ['scripts/db-deploy.mjs', '--initialize-empty-schema'], { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000, env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: scoped.toString() } });
          if (result.status !== 0) throw new Error('Disposable community bookmark schema initialization failed');
          await db.query(`SET search_path TO "${schema}"`);
          if (!(await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'CommunityBookmark'", [schema])).rowCount) throw new Error('Community bookmark numbered upgrade is missing');
        } finally { await db.end(); }
      },
      __finalize: async () => {
        const db = new Client({ connectionString: url }); await db.connect();
        try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); }
      },
    };
  }
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os'); const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const path = join(mkdtempSync(join(tmpdir(), 'forge-community-bookmarks-')), 'test.db');
  const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('prisma/sqlite-migrations').filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) db.exec(readFileSync(join('prisma/sqlite-migrations', file), 'utf8'));
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'CommunityBookmark'").get()) throw new Error('Community bookmark numbered migration is missing');
  db.close();
  const queries: string[] = [];
  const runtime = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }), log: [{ emit: 'event', level: 'query' }] });
  runtime.$on('query', (event: { query: string }) => queries.push(event.query));
  return { __esModule: true, default: runtime, __queries: queries };
});
const target = { kind: 'post' as const, targetId: 'post' };
const comment = { kind: 'comment' as const, targetId: 'old-comment' };
const input = (saved = true, expectedRevision = 0, requestId = randomUUID()) => ({ saved, expectedRevision, requestId });
const req = (method: string, body?: unknown, query = '', headers = {}) => new Request(`http://localhost/api/community/bookmarks${query}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const put = (body = input(), kind = 'post', targetId = 'post', headers = {}) => PUT(req('PUT', body, '', headers), { params: Promise.resolve({ kind, targetId }) });
beforeAll(async () => { await jest.requireMock('@/lib/prisma').__initialize?.(); }, 120_000);
beforeEach(async () => {
  jest.restoreAllMocks(); resetRateLimitStore();
  process.env.NEXTAUTH_SECRET = 'synthetic-community-bookmark-test-secret';
  await prisma.communityBookmark.deleteMany(); await prisma.comment.deleteMany(); await prisma.post.deleteMany(); await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [{ id: 'owner', email: 'owner@example.invalid' }, { id: 'other', email: 'other@example.invalid', role: 'ADMIN' }] });
  await prisma.post.createMany({ data: [{ id: 'post', title: 'Published', content: '<p>Visible content</p>', authorId: 'owner', published: true }, { id: 'hidden', title: 'Private canary', content: 'Hidden canary', authorId: 'owner', published: false }] });
  await prisma.comment.createMany({ data: [{ id: 'old-comment', content: 'Older saved answer', authorId: 'owner', postId: 'post' }, { id: 'hidden-comment', content: 'Hidden answer canary', authorId: 'owner', postId: 'hidden' }] });
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'owner', role: 'USER' } } as never);
});
afterAll(async () => { await prisma.$disconnect(); await jest.requireMock('@/lib/prisma').__finalize?.(); });

test('explicit save, exact replay, unsave and late replay cannot resurrect', async () => {
  const first = input(); expect(await setCommunityBookmark('owner', target, first)).toMatchObject({ saved: true, revision: 1 });
  expect(await setCommunityBookmark('owner', target, first)).toMatchObject({ saved: true, revision: 1 });
  expect(await prisma.communityBookmark.count()).toBe(1);
  await setCommunityBookmark('owner', target, input(false, 1));
  await expect(setCommunityBookmark('owner', target, first)).rejects.toMatchObject({ status: 409, state: { saved: false, revision: 2 } });
  expect(await readCommunityBookmarkStates('owner', [target])).toEqual([{ ...target, saved: false, revision: 2 }]);
});
test('first unsave creates fence against stale first save', async () => {
  await setCommunityBookmark('owner', target, input(false));
  await expect(setCommunityBookmark('owner', target, input())).rejects.toMatchObject({ status: 409 });
});
test('request UUID cannot replay different payload', async () => {
  const first = input(); await setCommunityBookmark('owner', target, first);
  await expect(setCommunityBookmark('owner', target, { ...first, saved: false })).rejects.toMatchObject({ status: 409 });
});
test('concurrent first saves have one winner and no duplicate row', async () => {
  const results = await Promise.allSettled([setCommunityBookmark('owner', target, input()), setCommunityBookmark('owner', target, input())]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(await prisma.communityBookmark.count()).toBe(1);
});
test('opposing multidevice CAS writes do not overwrite winner', async () => {
  await setCommunityBookmark('owner', target, input());
  const results = await Promise.allSettled([setCommunityBookmark('owner', target, input(false, 1)), setCommunityBookmark('owner', target, input(true, 1))]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await readCommunityBookmarkStates('owner', [target]))[0].revision).toBe(2);
});
test.each(['hidden', 'absent'])('hidden/unknown post uniformly unavailable: %s', async id => {
  await expect(setCommunityBookmark('owner', { ...target, targetId: id }, input())).rejects.toMatchObject({ status: 404, message: 'Inhalt nicht verfügbar' });
});
test('hidden parent comment unavailable even to its author or admin', async () => {
  for (const user of ['owner', 'other']) await expect(setCommunityBookmark(user, { kind: 'comment', targetId: 'hidden-comment' }, input())).rejects.toMatchObject({ status: 404 });
});
test('older comment uses existing linked-comment hash resolver', async () => {
  await setCommunityBookmark('owner', comment, input()); const page = await listCommunityBookmarks('owner', 'all', null);
  expect(page.items[0]).toMatchObject({ kind: 'comment', targetId: 'old-comment', href: '/api/community/bookmarks/comment/old-comment', title: 'Published' });
});
test('foreign admin cannot read own list and reads do not create records', async () => {
  await setCommunityBookmark('owner', target, input());
  expect(await listCommunityBookmarks('other', 'all', null)).toEqual({ items: [], nextCursor: null });
  expect(await readCommunityBookmarkStates('other', [target])).toEqual([{ ...target, saved: false, revision: 0 }]);
  expect(await prisma.communityBookmark.count()).toBe(1);
});
test('missing account rejected on state/list/write', async () => {
  for (const operation of [() => listCommunityBookmarks('gone', 'all', null), () => readCommunityBookmarkStates('gone', [target]), () => setCommunityBookmark('gone', target, input())]) await expect(operation()).rejects.toMatchObject({ status: 401 });
});
test('unpublish removes target from states/list/cursors without content leakage', async () => {
  await setCommunityBookmark('owner', target, input()); await setCommunityBookmark('owner', comment, input());
  await prisma.post.update({ where: { id: 'post' }, data: { published: false } });
  expect(await listCommunityBookmarks('owner', 'all', null)).toEqual({ items: [], nextCursor: null });
  expect(await readCommunityBookmarkStates('owner', [target, comment])).toEqual([]);
});
test.each(['post', 'comment', 'account'])('cascade cleans active and tombstone rows: %s', async kind => {
  await setCommunityBookmark('owner', target, input(false)); await setCommunityBookmark('owner', comment, input());
  if (kind === 'post') await prisma.post.delete({ where: { id: 'post' } });
  if (kind === 'comment') await prisma.comment.delete({ where: { id: 'old-comment' } });
  if (kind === 'account') await prisma.user.delete({ where: { id: 'owner' } });
  expect(await prisma.communityBookmark.count()).toBe(kind === 'comment' ? 1 : 0);
});
test('real database enforces one target, target FK and uniqueness', async () => {
  const data = { id: 'malformed', userId: 'owner', lastRequestId: randomUUID(), lastExpectedRevision: 0, revision: 1 };
  await expect(prisma.communityBookmark.create({ data })).rejects.toThrow();
  await expect(prisma.communityBookmark.create({ data: { ...data, postId: 'post', commentId: 'old-comment' } })).rejects.toThrow();
  await expect(prisma.communityBookmark.create({ data: { ...data, postId: 'missing' } })).rejects.toThrow();
  await setCommunityBookmark('owner', target, input());
  await expect(prisma.communityBookmark.create({ data: { ...data, postId: 'post' } })).rejects.toThrow();
});
test('signed account/filter-bound keyset has no gaps through hidden rows or removed boundary', async () => {
  for (let index = 0; index < 66; index++) {
    const id = `p${String(index).padStart(3, '0')}`;
    await prisma.post.create({ data: { id, title: id, content: id, authorId: 'owner', published: index % 3 !== 0 } });
    await prisma.communityBookmark.create({ data: { id: `b${String(index).padStart(3, '0')}`, userId: 'owner', postId: id, savedAt: new Date('2026-10-17T12:00:00Z'), lastRequestId: randomUUID(), lastExpectedRevision: 0 } });
  }
  const first = await listCommunityBookmarks('owner', 'post', null); expect(first.items).toHaveLength(30); expect(first.nextCursor).toBeTruthy();
  await expect(listCommunityBookmarks('other', 'post', first.nextCursor)).rejects.toThrow();
  await expect(listCommunityBookmarks('owner', 'all', first.nextCursor)).rejects.toThrow();
  await expect(listCommunityBookmarks('owner', 'post', first.nextCursor!.slice(0, -2) + 'xx')).rejects.toThrow();
  await prisma.post.delete({ where: { id: first.items.at(-1)!.targetId } });
  const second = await listCommunityBookmarks('owner', 'post', first.nextCursor);
  expect(second.items).toHaveLength(14); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(44);
});
test('populated two-hundred-target state batch and full page have bounded SELECT counts', async () => {
  const targets = Array.from({ length: 100 }, (_, i) => ({ postId: `batch-post-${i}`, commentId: `batch-comment-${i}` }));
  await prisma.post.createMany({ data: targets.map(({ postId }) => ({ id: postId, title: postId, content: 'Visible', authorId: 'owner', published: true })) });
  await prisma.comment.createMany({ data: targets.map(({ postId, commentId }) => ({ id: commentId, postId, content: 'Visible answer', authorId: 'owner' })) });
  const selected = targets.flatMap(({ postId, commentId }) => [{ kind: 'post' as const, targetId: postId }, { kind: 'comment' as const, targetId: commentId }]);
  const queries: string[] = jest.requireMock('@/lib/prisma').__queries;
  queries.length = 0; const states = await readCommunityBookmarkStates('owner', selected);
  expect(states).toHaveLength(200); expect(queries.filter(query => /^SELECT/i.test(query)).length).toBeLessThanOrEqual(4);
  await prisma.communityBookmark.createMany({ data: selected.map(target => ({ userId: 'owner', ...(target.kind === 'post' ? { postId: target.targetId } : { commentId: target.targetId }), savedAt: new Date(), lastRequestId: randomUUID(), lastExpectedRevision: 0 })) });
  queries.length = 0; const page = await listCommunityBookmarks('owner', 'all', null);
  expect(page.items).toHaveLength(30); expect(page.nextCursor).toBeTruthy(); expect(queries.filter(query => /^SELECT/i.test(query)).length).toBeLessThanOrEqual(8);
});
test('strict input rejects unknown account/parent properties, oversized batch and version overflow', () => {
  for (const body of [{ ...input(), userId: 'other' }, { ...input(), postId: 'hidden' }, input(true, -1), input(true, 2147483647), { ...input(), requestId: 'unsafe' }]) expect(() => parseBookmarkInput(body)).toThrow();
  expect(() => parseBookmarkTargets({ targets: Array.from({ length: 201 }, () => target) })).toThrow();
});
test('anonymous routes are private no-store and never disclose contents', async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  for (const operation of [() => GET(req('GET')), () => POST(req('POST', { targets: [target] })), () => put()]) {
    const response = await operation(); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
});
test('cross-origin blocked and 404/error/success always private no-store', async () => {
  expect((await put(input(), 'post', 'post', { origin: 'https://evil.invalid' })).status).toBe(403);
  for (const response of [await put(), await put(input(), 'post', 'hidden'), await GET(req('GET')), await POST(req('POST', { targets: [target, comment] }))]) expect(response.headers.get('cache-control')).toBe('private, no-store');
});
test('unexpected database failure is generic and does not expose raw IDs or SQL', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('private-sql-target-canary'));
  const response = await GET(req('GET')); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('private-sql-target-canary');
});

test('opening a saved older comment freshly resolves exact hash and blocks revoked/foreign/unsaved targets', async () => {
  await setCommunityBookmark('owner', comment, input());
  const open = () => openSaved(req('GET'), { params: Promise.resolve({ kind: 'comment', targetId: 'old-comment' }) });
  const redirected = await open(); expect(redirected.status).toBe(303); expect(redirected.headers.get('location')).toBe('http://localhost/community#comment-old-comment'); expect(redirected.headers.get('cache-control')).toBe('private, no-store');
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'other', role: 'ADMIN' } } as never); expect((await open()).status).toBe(404);
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'owner' } } as never);
  await prisma.post.update({ where: { id: 'post' }, data: { published: false } }); expect((await open()).status).toBe(404);
  await prisma.post.update({ where: { id: 'post' }, data: { published: true } });
  await setCommunityBookmark('owner', comment, input(false, 1)); expect((await open()).status).toBe(404);
});
