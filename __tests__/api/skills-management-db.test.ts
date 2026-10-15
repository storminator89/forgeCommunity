/** @jest-environment node */
import { GET as getCatalog, POST as createSkill } from '@/app/api/skills/route';
import { GET as getOwnSkills, POST as attachSkill } from '@/app/api/user/skills/route';
import { PUT as updateSkill, DELETE as removeSkill } from '@/app/api/user/skills/[id]/route';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-own-skills-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) db.exec(readFileSync(join(migrations, name), 'utf8'));
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const request = (body: unknown, method = 'POST') => new Request('http://localhost/api/user/skills', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'alice', role: 'USER' } } as never);
  await prisma.user.deleteMany(); await prisma.skill.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'alice', name: 'Alice', email: 'alice@example.test', password: 'private-alice-password' },
    { id: 'bob', name: 'Bob', email: 'bob@example.test', password: 'private-bob-password' },
  ] });
  await prisma.skill.createMany({ data: [
    { id: 'typescript', name: 'TypeScript', category: 'Technik' }, { id: 'figma', name: 'Figma', category: 'Design' },
  ] });
  await prisma.userSkill.createMany({ data: [
    { id: 'alice-ts', userId: 'alice', skillId: 'typescript', level: 81 },
    { id: 'bob-figma', userId: 'bob', skillId: 'figma', level: 47, endorsements: 1 },
  ] });
  await prisma.skillEndorsement.create({ data: { userSkillId: 'bob-figma', endorserId: 'alice' } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

it('requires authentication for every Skills catalog and own-management method', async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  const read = jest.spyOn(prisma.userSkill, 'findMany');
  const responses = await Promise.all([
    getCatalog(request({})), createSkill(request({ name: 'New' })), getOwnSkills(request({})),
    attachSkill(request({ skillId: 'figma', level: 33 })), updateSkill(request({ level: 55 }, 'PUT'), context('bob-figma')),
    removeSkill(request({}, 'DELETE'), context('bob-figma')),
  ]);
  expect(responses.map(entry => entry.status)).toEqual([401, 401, 401, 401, 401, 401]);
  expect(read).not.toHaveBeenCalled();
  expect(await prisma.userSkill.count()).toBe(2);
});

it('projects only the current account and taxonomy with private no-store responses', async () => {
  const response = await getOwnSkills(request({}));
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual([{
    id: 'alice-ts', userId: 'alice', skillId: 'typescript', level: 81, endorsements: 0,
    skill: { id: 'typescript', name: 'TypeScript', category: 'Technik' },
  }]);
  const catalog = await getCatalog(request({}));
  expect(catalog.headers.get('cache-control')).toBe('private, no-store');
  expect(JSON.stringify(await catalog.json())).not.toMatch(/password|example.test|bob-figma/);
});

it.each(['USER', 'ADMIN', 'INSTRUCTOR'])('never lets %s edit or remove another account through either identifier alias', async role => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'alice', role } } as never);
  for (const id of ['bob-figma', 'figma']) {
    expect((await updateSkill(request({ level: 100, userId: 'bob' }, 'PUT'), context(id))).status).toBe(404);
    expect((await removeSkill(request({}, 'DELETE'), context(id))).status).toBe(404);
  }
  expect(await prisma.userSkill.findUnique({ where: { id: 'bob-figma' } })).toMatchObject({ userId: 'bob', level: 47, endorsements: 1 });
  expect(await prisma.skillEndorsement.count()).toBe(1);
});

it.each(['bob-figma', 'figma'])('preserves the existing endorsement-bearing row when its owner edits %s', async id => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'bob' } } as never);
  expect((await updateSkill(request({ level: 82 }, 'PUT'), context(id))).status).toBe(200);
  expect(await prisma.userSkill.findUnique({ where: { id: 'bob-figma' } })).toMatchObject({ level: 82, endorsements: 1 });
  expect(await prisma.skillEndorsement.count()).toBe(1);
  expect((await removeSkill(request({}, 'DELETE'), context(id))).status).toBe(200);
  expect(await prisma.skillEndorsement.count()).toBe(0);
  expect(await prisma.userSkill.findUnique({ where: { id: 'alice-ts' } })).not.toBeNull();
});

it.each([-1, 101, 0.5, '50', null])('rejects invalid self-assessment %s without creating or updating rows', async level => {
  expect((await attachSkill(request({ skillId: 'figma', level }))).status).toBe(400);
  expect((await updateSkill(request({ level }, 'PUT'), context('alice-ts'))).status).toBe(400);
  expect(await prisma.userSkill.count()).toBe(2);
  expect((await prisma.userSkill.findUnique({ where: { id: 'alice-ts' } }))?.level).toBe(81);
});

it('creates trimmed category data, attaches only to the authenticated account, and rejects duplicates', async () => {
  const created = await createSkill(request({ name: '  Moderation  ', category: '  Zusammenarbeit  ' }));
  expect(created.status).toBe(201);
  const skill = await created.json();
  expect(skill).toMatchObject({ name: 'Moderation', category: 'Zusammenarbeit' });
  expect((await attachSkill(request({ skillId: skill.id, level: 0, userId: 'bob' }))).status).toBe(201);
  expect(await prisma.userSkill.findUnique({ where: { userId_skillId: { userId: 'alice', skillId: skill.id } } })).toMatchObject({ level: 0 });
  expect(await prisma.userSkill.findUnique({ where: { userId_skillId: { userId: 'bob', skillId: skill.id } } })).toBeNull();
  expect((await attachSkill(request({ skillId: skill.id, level: 100 }))).status).toBe(400);
  expect((await createSkill(request({ name: 'Moderation' }))).status).toBe(400);
});

it('turns racing unique constraints into recoverable conflicts instead of duplicate rows', async () => {
  jest.spyOn(prisma.userSkill, 'create').mockRejectedValueOnce({ code: 'P2002' });
  expect((await attachSkill(request({ skillId: 'figma', level: 66 }))).status).toBe(409);
  jest.spyOn(prisma.skill, 'create').mockRejectedValueOnce({ code: 'P2002' });
  expect((await createSkill(request({ name: 'Concurrent skill' }))).status).toBe(409);
});

it('handles a skill disappearing between its existence check and the attach', async () => {
  jest.spyOn(prisma.userSkill, 'create').mockRejectedValueOnce({ code: 'P2003' });
  expect((await attachSkill(request({ skillId: 'figma', level: 66 }))).status).toBe(404);
  expect(await prisma.userSkill.count()).toBe(2);
});
