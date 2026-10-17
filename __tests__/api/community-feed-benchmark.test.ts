/** @jest-environment node */
import { GET as getPosts } from '@/app/api/posts/route';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';
import { rmSync } from 'node:fs';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-community-feed-benchmark-'));
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

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: 'author', email: 'author@example.invalid' },
    { id: 'viewer', email: 'viewer@example.invalid' },
  ] });
  const createdAt = new Date('2026-01-01T12:00:00.000Z');
  await prisma.post.createMany({ data: Array.from({ length: 60 }, (_, index) => ({
    id: `post-${String(index).padStart(3, '0')}`, authorId: 'author', title: `Post ${index}`,
    content: `This is a community discussion ${index}. ` + 'x'.repeat(500), published: true, createdAt,
  })) });
  await prisma.comment.createMany({ data: Array.from({ length: 600 }, (_, index) => ({
    id: `comment-${String(index).padStart(4, '0')}`, postId: `post-${String(Math.floor(index / 10)).padStart(3, '0')}`,
    authorId: 'author', content: `Reply ${index}: ` + 'r'.repeat(1000), createdAt,
  })) });
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'viewer', role: 'USER' } } as never);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('synthetic first-page feed transfers no collapsed comment bodies', async () => {
  const url = 'http://localhost/api/posts?feed=1';
  for (let i = 0; i < 2; i++) await getPosts(new Request(url) as never);
  const durations: number[] = [];
  let body = '';
  for (let i = 0; i < 11; i++) {
    const started = performance.now();
    const response = await getPosts(new Request(url) as never);
    body = await response.text();
    durations.push(performance.now() - started);
  }
  const page = JSON.parse(body);
  expect(page.posts).toHaveLength(50);
  expect(page.nextCursor).toEqual(expect.any(String));
  expect(page.posts.every((post: { commentsDeferred: boolean; comments: unknown[]; commentCount: number }) =>
    post.commentsDeferred === true && post.comments.length === 0 && post.commentCount === 10)).toBe(true);
  expect(Buffer.byteLength(body)).toBeLessThan(80000);
  const ordered = durations.sort((a, b) => a - b);
  if (process.env.BENCH_COMMUNITY_FEED === '1') {
    console.info(JSON.stringify({
      fixture: '60 posts, 10 x 1 KB comments per post, authenticated viewer',
      medianMs: Number(ordered[5].toFixed(2)), p90Ms: Number(ordered[9].toFixed(2)), bytes: Buffer.byteLength(body),
      commentsInPage: page.posts.reduce((total: number, post: { comments: unknown[] }) => total + post.comments.length, 0),
    }));
  }
});
