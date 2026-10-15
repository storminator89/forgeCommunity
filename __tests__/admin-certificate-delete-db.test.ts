/** @jest-environment node */
import { DELETE } from '@/app/api/admin/users/[id]/route';
import { rmSync } from 'node:fs';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value), init); }
  },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-account-certificate-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of ['0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql', '0004_reports.sql', '0005_reward_ledger.sql']) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const deleteAccount = (id: string) => DELETE(new Request(`http://localhost/api/admin/users/${id}`, { method: 'DELETE' }) as never,
  { params: Promise.resolve({ id }) });

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('third-party certificates block instructor erasure without partial changes; own certificates erase with their account', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never);
  await prisma.user.create({ data: { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN' } });
  await prisma.user.create({ data: { id: 'teacher', email: 'teacher@example.invalid', role: 'INSTRUCTOR' } });
  await prisma.user.create({ data: { id: 'learner', email: 'learner@example.invalid', role: 'USER' } });
  await prisma.userSettings.create({ data: { id: 'teacher-settings', userId: 'teacher' } });
  await prisma.course.create({ data: { id: 'course', instructorId: 'teacher', title: 'Earned course', description: 'Course' } });
  const completedAt = new Date('2026-10-01T12:00:00Z');
  await prisma.enrollment.create({ data: { id: 'enrollment', userId: 'learner', courseId: 'course', completedAt } });
  await prisma.courseCompletionRecord.create({ data: { userId: 'learner', courseId: 'course', courseTitle: 'Earned course', completedAt } });
  await prisma.certificate.create({ data: { id: 'certificate', userId: 'learner', courseId: 'course', courseName: 'Earned course', userName: 'Learner' } });
  await prisma.certificate.create({ data: { id: 'teacher-certificate', userId: 'teacher', courseId: 'course', courseName: 'Earned course', userName: 'Teacher' } });

  const blocked = await deleteAccount('teacher');
  expect(blocked.status).toBe(409);
  expect(await prisma.user.count({ where: { id: 'teacher' } })).toBe(1);
  expect(await prisma.userSettings.count({ where: { userId: 'teacher' } })).toBe(1);
  expect(await prisma.course.count({ where: { id: 'course' } })).toBe(1);
  expect(await prisma.enrollment.count({ where: { id: 'enrollment' } })).toBe(1);
  expect(await prisma.certificate.count({ where: { id: 'certificate' } })).toBe(1);
  expect(await prisma.certificate.count({ where: { id: 'teacher-certificate' } })).toBe(1);
  expect(await prisma.courseCompletionRecord.count({ where: { userId: 'learner' } })).toBe(1);

  const erasedLearner = await deleteAccount('learner');
  expect(erasedLearner.status).toBe(200);
  expect(await prisma.user.count({ where: { id: 'learner' } })).toBe(0);
  expect(await prisma.certificate.count({ where: { id: 'certificate' } })).toBe(0);
  expect(await prisma.certificate.count({ where: { id: 'teacher-certificate' } })).toBe(1);
  expect(await prisma.courseCompletionRecord.count({ where: { userId: 'learner' } })).toBe(0);
  expect(await prisma.course.count({ where: { id: 'course' } })).toBe(1);

  const erasedTeacher = await deleteAccount('teacher');
  expect(erasedTeacher.status).toBe(200);
  expect(await prisma.course.count({ where: { id: 'course' } })).toBe(0);
  expect(await prisma.user.count({ where: { id: 'teacher' } })).toBe(0);
  expect(await prisma.certificate.count()).toBe(0);
});
