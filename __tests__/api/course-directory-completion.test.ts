/** @jest-environment node */
import { GET } from '@/app/api/courses/route';
import { courseContentRevision } from '@/lib/server/course-progress';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value), init); }
} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  course: { findMany: jest.fn() },
  courseContent: { findMany: jest.fn() },
  courseContentProgress: { findMany: jest.fn() },
  coursePublication: { findMany: jest.fn() },
} }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));

const db = prisma as unknown as {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  course: { findMany: jest.Mock };
  courseContent: { findMany: jest.Mock };
  courseContentProgress: { findMany: jest.Mock };
  coursePublication: { findMany: jest.Mock };
};
const history = new Date('2026-09-01T12:00:00Z');
const course = (id: string, enrolled = true) => ({
  id, title: id, description: 'Course', activePublicationId: `publication-${id}`, instructorId: 'teacher', instructor: { name: 'Teacher' },
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
function mockContents(items: ReturnType<typeof leaf>[]) {
  db.courseContent.findMany.mockResolvedValue(items);
  db.coursePublication.findMany.mockResolvedValue([...new Set(items.map(item => item.courseId))].map(courseId => ({
    id: `publication-${courseId}`, courseId, payload: JSON.stringify({ schemaVersion: 1,
      contents: items.filter(item => item.courseId === courseId).map(item => ({ ...item, title: item.id })) }),
  })));
  if (!items.length) db.coursePublication.findMany.mockResolvedValue([{ id: 'publication-one', courseId: 'one',
    payload: JSON.stringify({ schemaVersion: 1, contents: [] }) }]);
}

beforeEach(() => {
  jest.resetAllMocks();
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.$queryRaw.mockResolvedValue([]);
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'alice', role: 'USER' } } as never);
  db.course.findMany.mockResolvedValue([course('one'), course('other', false)]);
  const lesson = leaf('lesson');
  mockContents([lesson]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(lesson)]);
});

test.each(['TEXT', 'QUIZ'])('historical completion does not claim current %s completion after a revision', async type => {
  const item = leaf('lesson', 'one', type, type === 'QUIZ'
    ? JSON.stringify({ questions: [{ id: 'q', type: 'SINGLE_CHOICE', question: 'Changed?', options: ['A', 'B'], correctAnswers: [1] }] })
    : '<p>Revised lesson</p>');
  mockContents([item]);
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
  mockContents([first, second]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(first)]);
  expect((await (await GET()).json())[0]).toMatchObject({ everCompleted: true, completed: false });
  mockContents([first]);
  expect((await (await GET()).json())[0]).toMatchObject({ everCompleted: true, completed: true });
  mockContents([]);
  expect((await (await GET()).json())[0]).toMatchObject({ everCompleted: true, completed: false });
});

test('batches both revision queries only for the authenticated viewer’s enrolled courses', async () => {
  const first = leaf('first', 'one');
  const second = leaf('second', 'two');
  db.course.findMany.mockResolvedValue([course('one'), course('two'), course('other', false)]);
  mockContents([first, second]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(first), marked(second)]);
  const rows = await (await GET()).json();
  expect(rows.map((row: { completed: boolean }) => row.completed)).toEqual([true, true, false]);
  expect(db.courseContent.findMany).toHaveBeenCalledTimes(1);
  expect(db.courseContent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { courseId: { in: ['one', 'two'] }, archivedAt: null } }));
  expect(db.courseContentProgress.findMany).toHaveBeenCalledTimes(1);
  expect(db.courseContentProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'alice', courseId: { in: ['one', 'two'] } } }));
  expect(db.course.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { activePublicationId: { not: null } } }));

  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'bob', role: 'USER' } } as never);
  db.course.findMany.mockResolvedValue([course('one', false), course('two', false), course('other', false)]);
  db.courseContent.findMany.mockClear();
  db.courseContentProgress.findMany.mockClear();
  const bobRows = await (await GET()).json();
  expect(bobRows.every((row: { completed: boolean; everCompleted: boolean }) => !row.completed && !row.everCompleted)).toBe(true);
  expect(db.courseContent.findMany).not.toHaveBeenCalled();
  expect(db.courseContentProgress.findMany).not.toHaveBeenCalled();
});

test('assignment directory completion requires the current grade rather than a stale progress mirror', async () => {
  const assignment = leaf('written-task', 'one', 'ASSIGNMENT', JSON.stringify({ prompt: 'Explain a concept.', passingScore: 70 }));
  mockContents([assignment]);
  db.courseContentProgress.findMany.mockResolvedValue([marked(assignment)]);
  expect((await (await GET()).json())[0]).toMatchObject({ completed: false, everCompleted: true });
  db.$queryRaw.mockResolvedValue([{ userId: 'alice', contentId: assignment.id }]);
  expect((await (await GET()).json())[0]).toMatchObject({ completed: true, everCompleted: true });
});
