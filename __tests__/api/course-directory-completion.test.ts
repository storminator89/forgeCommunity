/** @jest-environment node */
import { GET } from '@/app/api/courses/route';
import { courseContentRevision } from '@/lib/server/course-progress';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value), init); }
} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  course: { findMany: jest.fn() },
  courseContent: { findMany: jest.fn() },
  courseContentProgress: { findMany: jest.fn() },
} }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));

const db = prisma as unknown as {
  course: { findMany: jest.Mock };
  courseContent: { findMany: jest.Mock };
  courseContentProgress: { findMany: jest.Mock };
};
const history = new Date('2026-09-01T12:00:00Z');
const course = (id: string, enrolled = true) => ({
  id, title: id, description: 'Course', instructorId: 'teacher', instructor: { name: 'Teacher' },
  startDate: null, endDate: null, price: null, currency: null, maxStudents: null,
  rewardEligible: true, imageUrl: null, _count: { enrollments: 1 },
  enrollments: enrolled ? [{ completedAt: history }] : [],
});
const leaf = (id: string, courseId = 'one', type = 'TEXT', content = '<p>Lesson</p>') => ({
  id, courseId, parentId: null, type, content, order: 1,
});
const marked = (item: ReturnType<typeof leaf>, revision = courseContentRevision(item)) => ({
  courseId: item.courseId, contentId: item.id, revision,
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'alice', role: 'USER' } } as never);
  db.course.findMany.mockResolvedValue([course('one'), course('other', false)]);
  const lesson = leaf('lesson');
  db.courseContent.findMany.mockResolvedValue([lesson]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(lesson)]);
});

test.each(['TEXT', 'QUIZ'])('historical completion does not claim current %s completion after a revision', async type => {
  const item = leaf('lesson', 'one', type, type === 'QUIZ'
    ? JSON.stringify({ questions: [{ id: 'q', type: 'SINGLE_CHOICE', question: 'Changed?', options: ['A', 'B'], correctAnswers: [1] }] })
    : '<p>Revised lesson</p>');
  db.courseContent.findMany.mockResolvedValue([item]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(item, 'old-revision')]);
  const response = await GET();
  const rows = await response.json();
  expect(rows[0]).toMatchObject({ id: 'one', everCompleted: true, completed: false });
  expect(rows[1]).toMatchObject({ id: 'other', everCompleted: false, completed: false });
  expect(JSON.stringify(rows)).not.toMatch(/correctAnswers|Changed\?/);
});

test('added leaves reopen current completion; removing them restores it; zero leaves are incomplete', async () => {
  const first = leaf('first');
  const second = leaf('second');
  db.courseContent.findMany.mockResolvedValue([first, second]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(first)]);
  expect((await (await GET()).json())[0]).toMatchObject({ everCompleted: true, completed: false });
  db.courseContent.findMany.mockResolvedValue([first]);
  expect((await (await GET()).json())[0]).toMatchObject({ everCompleted: true, completed: true });
  db.courseContent.findMany.mockResolvedValue([]);
  expect((await (await GET()).json())[0]).toMatchObject({ everCompleted: true, completed: false });
});

test('batches both revision queries only for the authenticated viewer’s enrolled courses', async () => {
  const first = leaf('first', 'one');
  const second = leaf('second', 'two');
  db.course.findMany.mockResolvedValue([course('one'), course('two'), course('other', false)]);
  db.courseContent.findMany.mockResolvedValue([first, second]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(first), marked(second)]);
  const rows = await (await GET()).json();
  expect(rows.map((row: { completed: boolean }) => row.completed)).toEqual([true, true, false]);
  expect(db.courseContent.findMany).toHaveBeenCalledTimes(1);
  expect(db.courseContent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { courseId: { in: ['one', 'two'] } } }));
  expect(db.courseContentProgress.findMany).toHaveBeenCalledTimes(1);
  expect(db.courseContentProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'alice', courseId: { in: ['one', 'two'] } } }));

  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'bob', role: 'USER' } } as never);
  db.course.findMany.mockResolvedValue([course('one', false), course('two', false), course('other', false)]);
  db.courseContent.findMany.mockClear();
  db.courseContentProgress.findMany.mockClear();
  const bobRows = await (await GET()).json();
  expect(bobRows.every((row: { completed: boolean; everCompleted: boolean }) => !row.completed && !row.everCompleted)).toBe(true);
  expect(db.courseContent.findMany).not.toHaveBeenCalled();
  expect(db.courseContentProgress.findMany).not.toHaveBeenCalled();
});
