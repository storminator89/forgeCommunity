/** @jest-environment jsdom */
import { GET } from '@/app/api/search/route';
import { getServerSession } from '@/lib/sites-auth/server';
import prisma from '@/lib/prisma';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  // Prisma's real query compiler needs Node's codecs in the DOM test realm.
  const { TextDecoder, TextEncoder } = require('node:util');
  Object.assign(globalThis, { TextDecoder, TextEncoder });
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-skill-search-'));
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

function request(query: string, type = 'skill', page = 1, limit = 10) {
  return { nextUrl: new URL(`http://localhost/api/search?query=${encodeURIComponent(query)}&type=${type}&page=${page}&limit=${limit}`) } as never;
}

const originalProvider = process.env.DATABASE_PROVIDER;

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  process.env.DATABASE_PROVIDER = 'sqlite';
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'viewer' } } as never);
  await prisma.user.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.skill.createMany({ data: [
    { id: 'typescript', name: 'TypeScript', category: 'Technik' },
    { id: 'javascript', name: 'JavaScript', category: 'Technik' },
    { id: 'figma', name: 'Figma', category: 'Design' },
  ] });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
  if (originalProvider === undefined) delete process.env.DATABASE_PROVIDER;
  else process.env.DATABASE_PROVIDER = originalProvider;
});

test.each([
  ['TypeScript', ['typescript']],
  ['typescript', ['typescript']],
  ['SCRIPT', ['javascript', 'typescript']],
  ['technik', ['javascript', 'typescript']],
  ['unknown', []],
])('matches the real taxonomy for exact, case-insensitive, substring and category query %s', async (query, ids) => {
  const response = await GET(request(query));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await response.json();
  expect(body.results.map((result: { id: string }) => result.id)).toEqual(ids);
  expect(body.pagination).toEqual({ total: ids.length, page: 1, limit: 10, pages: ids.length ? 1 : 0 });
});

test('uses stable bounded taxonomy pagination and limits All to five taxonomy hits without fake totals', async () => {
  await prisma.skill.createMany({ data: Array.from({ length: 23 }, (_, index) => ({
    id: `fixture-${index}`, name: `Fixture ${String(index).padStart(2, '0')}`, category: 'Fixture category',
  })) });
  const first = await (await GET(request('Fixture', 'skill', 1, 999))).json();
  const second = await (await GET(request('Fixture', 'skill', 2, 999))).json();
  expect(first.results).toHaveLength(20);
  expect(second.results.map((result: { title: string }) => result.title)).toEqual(['Fixture 20', 'Fixture 21', 'Fixture 22']);
  expect(first.pagination).toEqual({ total: 23, page: 1, limit: 20, pages: 2 });
  expect(second.pagination).toEqual({ total: 23, page: 2, limit: 20, pages: 2 });
  const cap = await (await GET(request('Fixture', 'skill', 9999, 999))).json();
  expect(cap.results).toEqual([]);
  expect(cap.pagination).toEqual({ total: 23, page: 1000, limit: 20, pages: 2 });
  const all = await (await GET(request('Fixture', 'all', 8, 999))).json();
  expect(all.results.map((result: { title: string }) => result.title)).toEqual(Array.from({ length: 5 }, (_, index) => `Fixture 0${index}`));
  expect(all.pagination).toEqual({ total: 0, page: 8, limit: 20, pages: 0 });
});

test('selects only taxonomy fields, sanitizes and bounds snippets, and never looks up associated accounts', async () => {
  await prisma.skill.update({ where: { id: 'typescript' }, data: { category: `<strong>Technik</strong><script>unsafe()</script> ${'Lang'.repeat(80)}` } });
  await prisma.user.create({ data: { id: 'member-private', name: 'Private member', email: 'private@example.test', password: 'private-hash', skills: { create: { skillId: 'typescript', level: 99 } } } });
  const skills = jest.spyOn(prisma.skill, 'findMany');
  const members = jest.spyOn(prisma.user, 'findMany');
  const count = jest.spyOn(prisma.skill, 'count');
  const response = await GET(request('TypeScript'));
  const body = await response.json();
  expect(skills).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, name: true, category: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
  expect(count).toHaveBeenCalledWith({ where: skills.mock.calls[0][0]!.where });
  expect(members).not.toHaveBeenCalled();
  expect(body.results[0]).toMatchObject({ id: 'typescript', title: 'TypeScript', type: 'skill', createdAt: null });
  expect(body.results[0].description).toMatch(/^Fähigkeit im Skill-Verzeichnis\. Kategorie: Technik/);
  expect(body.results[0].description.length).toBeLessThanOrEqual(223);
  expect(JSON.stringify(body)).not.toMatch(/<|unsafe\(\)|private@example|private-hash|Private member|member-private|endorsements/);
});

test('requires an authenticated account id before any taxonomy lookup and does not enumerate by email', async () => {
  const skills = jest.spyOn(prisma.skill, 'findMany');
  const members = jest.spyOn(prisma.user, 'findMany');
  for (const session of [null, { user: {} }]) {
    jest.mocked(getServerSession).mockResolvedValueOnce(session as never);
    expect((await GET(request('TypeScript'))).status).toBe(401);
  }
  expect(skills).not.toHaveBeenCalled();
  const short = await GET(request('x'));
  expect((await short.json()).results).toEqual([]);
  expect(skills).not.toHaveBeenCalled();
  await prisma.user.create({ data: { id: 'email-private', email: 'private@example.test' } });
  const result = await (await GET(request('private@example.test'))).json();
  expect(result.results).toEqual([]);
  expect(result.pagination.total).toBe(0);
  expect(members).not.toHaveBeenCalled();
});
