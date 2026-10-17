/** @jest-environment node */
import { GET } from '@/app/api/contributions/me/route';
import { getServerSession } from '@/lib/sites-auth/server';
import { changeAcceptedSolution } from '@/lib/server/accepted-solutions';
import prisma from '@/lib/prisma';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-private-contributions-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  const queries: Array<{ query: string; params: string }> = [];
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }), log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', (query: { query: string; params: string }) => queries.push(query));
  return { __esModule: true, __tempDirectory: directory, __queries: queries, default: client };
});

const viewer = (id: string, role = 'USER') => jest.mocked(getServerSession).mockResolvedValue({ user: { id, role } } as never);
const request = (query = '') => new Request(`http://localhost/api/contributions/me${query}`);
const read = async () => (await GET(request())).json();
const queries = () => jest.requireMock('@/lib/prisma').__queries as Array<{ query: string; params: string }>;

async function selectedPost(id: string, owner = 'owner', contributor = 'contributor', published = true) {
  await prisma.post.create({ data: {
    id, title: 'Synthetic discussion', content: 'Question', authorId: owner, published,
    comments: { create: { id: `reply-${id}`, authorId: contributor, content: 'Synthetic answer' } },
  } });
  await prisma.acceptedSolution.create({ data: { postId: id, commentId: `reply-${id}`, revision: `revision-${id}` } });
}

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.contentReport.deleteMany();
  await prisma.acceptedSolutionChange.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: ['owner', 'contributor', 'other', 'admin', 'moderator', 'instructor', 'test'].map(id => ({
    id, email: `${id}@example.invalid`,
    role: id === 'admin' ? 'ADMIN' as const : id === 'moderator' ? 'MODERATOR' as const : id === 'instructor' ? 'INSTRUCTOR' as const : 'USER' as const,
    isTestAccount: id === 'test',
  })) });
  queries().length = 0;
  viewer('contributor', 'ADMIN'); // Session role claims are deliberately stale.
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('only the current authenticated account can read; every response is private/no-store and no identities escape', async () => {
  await selectedPost('eligible');
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(await response.json()).toEqual({ eligible: true, selectedByAuthors: 1, saturated: false });
  viewer('other'); expect(await read()).toEqual({ eligible: true, selectedByAuthors: 0, saturated: false });
  const foreign = await GET(request('?userId=contributor'));
  expect(foreign.status).toBe(400); expect(foreign.headers.get('cache-control')).toBe('private, no-store');
  viewer('admin', 'ADMIN'); expect((await GET(request('?userId=contributor'))).status).toBe(400);
  jest.mocked(getServerSession).mockResolvedValue(null);
  const anonymous = await GET(request());
  expect(anonymous.status).toBe(401); expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
  viewer('missing'); const missing = await GET(request());
  expect(missing.status).toBe(404); expect(missing.headers.get('cache-control')).toBe('private, no-store');
});

test.each(['ADMIN', 'MODERATOR', 'INSTRUCTOR'] as const)('stored contributor role %s is excluded despite session USER', async role => {
  await selectedPost('eligible');
  await prisma.user.update({ where: { id: 'contributor' }, data: { role } });
  viewer('contributor');
  queries().length = 0;
  expect(await read()).toEqual({ eligible: false, selectedByAuthors: 0, saturated: false });
  expect(queries().some(entry => /GROUP BY/.test(entry.query))).toBe(false);
});

test('test contributor is excluded and eligibility restoration is live', async () => {
  await selectedPost('eligible');
  await prisma.user.update({ where: { id: 'contributor' }, data: { isTestAccount: true } });
  expect(await read()).toEqual({ eligible: false, selectedByAuthors: 0, saturated: false });
  await prisma.user.update({ where: { id: 'contributor' }, data: { isTestAccount: false } });
  expect(await read()).toEqual({ eligible: true, selectedByAuthors: 1, saturated: false });
});

test('self, test/staff discussion authors, private discussions and another contributor never count', async () => {
  for (const author of ['contributor', 'test', 'admin', 'moderator', 'instructor']) await selectedPost(`excluded-${author}`, author);
  await selectedPost('private', 'owner', 'contributor', false);
  await selectedPost('other-reply', 'owner', 'other');
  expect(await read()).toEqual({ eligible: true, selectedByAuthors: 0, saturated: false });
  await selectedPost('eligible');
  expect((await read()).selectedByAuthors).toBe(1);
});

test('author eligibility, publication and erasure immediately affect each next read', async () => {
  await selectedPost('eligible');
  expect((await read()).selectedByAuthors).toBe(1);
  for (const data of [{ role: 'MODERATOR' as const }, { role: 'USER' as const, isTestAccount: true }]) {
    await prisma.user.update({ where: { id: 'owner' }, data });
    expect((await read()).selectedByAuthors).toBe(0);
  }
  await prisma.user.update({ where: { id: 'owner' }, data: { role: 'USER', isTestAccount: false } });
  expect((await read()).selectedByAuthors).toBe(1);
  await prisma.post.update({ where: { id: 'eligible' }, data: { published: false } });
  expect((await read()).selectedByAuthors).toBe(0);
  await prisma.post.update({ where: { id: 'eligible' }, data: { published: true } });
  expect((await read()).selectedByAuthors).toBe(1);
  await prisma.comment.delete({ where: { id: 'reply-eligible' } });
  expect((await read()).selectedByAuthors).toBe(0);
  await selectedPost('second'); await prisma.post.delete({ where: { id: 'second' } });
  expect((await read()).selectedByAuthors).toBe(0);
  await selectedPost('third'); await prisma.user.delete({ where: { id: 'owner' } });
  expect((await read()).selectedByAuthors).toBe(0);
  await prisma.user.delete({ where: { id: 'contributor' } });
  expect((await GET(request())).status).toBe(404);
});

test('selecting repeatedly is idempotent, changing and clearing reverses current progress with no reward writes', async () => {
  await selectedPost('live');
  await prisma.acceptedSolution.delete({ where: { postId: 'live' } });
  await prisma.comment.create({ data: { id: 'alternate', postId: 'live', authorId: 'other', content: 'Alternate answer' } });
  expect((await read()).selectedByAuthors).toBe(0);
  await changeAcceptedSolution('live', 'owner', 'reply-live', null);
  expect((await read()).selectedByAuthors).toBe(1);
  expect((await changeAcceptedSolution('live', 'owner', 'reply-live', null)).changed).toBe(false);
  expect((await read()).selectedByAuthors).toBe(1);
  let current = await prisma.acceptedSolution.findUniqueOrThrow({ where: { postId: 'live' } });
  await changeAcceptedSolution('live', 'owner', 'alternate', current.revision);
  expect((await read()).selectedByAuthors).toBe(0);
  current = await prisma.acceptedSolution.findUniqueOrThrow({ where: { postId: 'live' } });
  await changeAcceptedSolution('live', 'owner', 'reply-live', current.revision);
  current = await prisma.acceptedSolution.findUniqueOrThrow({ where: { postId: 'live' } });
  await changeAcceptedSolution('live', 'owner', null, current.revision);
  expect((await read()).selectedByAuthors).toBe(0);
  expect((await changeAcceptedSolution('live', 'owner', null, current.revision)).changed).toBe(false);
  expect(await prisma.acceptedSolutionChange.count()).toBe(4);
  expect(await prisma.rewardLedger.count()).toBe(0);
  expect(await prisma.userBadge.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
});

test('database groups repeated authors before limiting to five; no unbounded post or author list is fetched', async () => {
  for (let index = 0; index < 30; index++) await selectedPost(`same-author-${index}`);
  expect(await read()).toEqual({ eligible: true, selectedByAuthors: 1, saturated: false });
  for (let index = 0; index < 8; index++) {
    const id = `distinct-${index}`;
    await prisma.user.create({ data: { id, email: `${id}@example.invalid` } });
    await selectedPost(id, id);
    if (index === 1) expect(await read()).toEqual({ eligible: true, selectedByAuthors: 3, saturated: false });
    if (index === 3) expect(await read()).toEqual({ eligible: true, selectedByAuthors: 5, saturated: true });
  }
  queries().length = 0;
  expect(await read()).toEqual({ eligible: true, selectedByAuthors: 5, saturated: true });
  const groupQueries = queries().filter(entry => /GROUP BY/.test(entry.query));
  expect(groupQueries).toHaveLength(1);
  expect(groupQueries[0].query).toMatch(/GROUP BY [\s\S]*authorId[\s\S]*ORDER BY [\s\S]*LIMIT/);
  expect(JSON.parse(groupQueries[0].params).slice(-2).map(Number)).toEqual([5, 0]);
  const postReads = queries().filter(entry => /^SELECT/.test(entry.query) && /FROM [^ ]*\.?["`]Post["`]/.test(entry.query));
  expect(postReads).toHaveLength(1);
  expect(await prisma.rewardLedger.count()).toBe(0);
  // Falling below saturation remains current, including same-author remaining posts.
  await prisma.user.deleteMany({ where: { id: { startsWith: 'distinct-' } } });
  expect(await read()).toEqual({ eligible: true, selectedByAuthors: 1, saturated: false });
});

test('reports alone never penalize progress', async () => {
  await selectedPost('reported');
  await prisma.contentReport.create({ data: { reporterId: 'other', targetType: 'COMMENT', targetId: 'reply-reported', reason: 'OTHER' } });
  expect((await read()).selectedByAuthors).toBe(1);
  await prisma.contentReport.updateMany({ data: { status: 'RESOLVED', reviewedAt: new Date(), reviewedById: 'moderator', resolutionNote: 'Reviewed synthetic report' } });
  expect((await read()).selectedByAuthors).toBe(1);
});

test('session and database failures remain private errors rather than zero progress; a later read can recover', async () => {
  jest.mocked(getServerSession).mockRejectedValueOnce(new Error('session failure'));
  let response = await GET(request());
  expect(response.status).toBe(500); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).not.toHaveProperty('selectedByAuthors');
  await selectedPost('eligible');
  jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('database failure'));
  response = await GET(request());
  expect(response.status).toBe(500); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await read()).toEqual({ eligible: true, selectedByAuthors: 1, saturated: false });
});
