/** @jest-environment node */
import { GET } from '@/app/api/leaderboard/route';
import prisma from '@/lib/prisma';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), init);
    }
  },
}));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-leaderboard-'));
  const dbPath = join(directory, 'test.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of ['0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql', '0004_reports.sql', '0005_reward_ledger.sql']) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }) }) };
});

async function member(id: string, options: { optIn?: boolean; role?: 'USER' | 'ADMIN'; test?: boolean } = {}) {
  await prisma.user.create({ data: {
    id, name: id, email: `${id}@example.invalid`, role: options.role ?? 'USER', isTestAccount: options.test ?? false,
    userSettings: { create: { id: `settings-${id}`, publicRankingOptIn: options.optIn ?? true } },
  } });
}

async function reward(userId: string, suffix: string, points: number, revokedAt?: Date) {
  await prisma.rewardLedger.create({ data: {
    id: `reward-${userId}-${suffix}`, userId, eventType: 'COURSE_COMPLETED',
    sourceId: `course-${userId}-${suffix}`, courseTitle: 'Synthetic course', points,
    ...(revokedAt ? { revokedAt } : {}),
  } });
}

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('SQLite leaderboard aggregates consented active awards and fills only the zero-point tail', async () => {
  for (const id of ['a', 'b', 'c', 'zero-a', 'zero-b', 'opted-out', 'test-account', 'admin', 'revoked']) {
    await member(id, { optIn: id !== 'opted-out', test: id === 'test-account', role: id === 'admin' ? 'ADMIN' : 'USER' });
  }
  await reward('a', '1', 50);
  await reward('a', '2', 50);
  await reward('b', '1', 100);
  await reward('c', '1', 50);
  await reward('opted-out', '1', 200);
  await reward('test-account', '1', 200);
  await reward('admin', '1', 200);
  await reward('revoked', '1', 150, new Date('2026-10-01T00:00:00Z'));

  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    { name: 'a', image: null, points: 100 },
    { name: 'b', image: null, points: 100 },
    { name: 'c', image: null, points: 50 },
    { name: 'revoked', image: null, points: 0 },
    { name: 'zero-a', image: null, points: 0 },
    { name: 'zero-b', image: null, points: 0 },
  ]);
});

test('SQLite leaderboard returns only ten highest ranked identities despite more eligible members', async () => {
  for (let index = 0; index < 12; index++) {
    const id = `member-${String(index).padStart(2, '0')}`;
    await member(id);
    await reward(id, '1', 75);
  }
  const response = await GET();
  expect(response.status).toBe(200);
  const ranking = await response.json();
  expect(ranking).toHaveLength(10);
  expect(ranking.slice(0, 2)).toEqual([
    { name: 'a', image: null, points: 100 },
    { name: 'b', image: null, points: 100 },
  ]);
  expect(ranking.slice(2).map((entry: { name: string }) => entry.name)).toEqual(
    Array.from({ length: 8 }, (_, index) => `member-${String(index).padStart(2, '0')}`),
  );
});
