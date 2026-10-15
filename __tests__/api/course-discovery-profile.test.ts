import { GET as getInstructorCourses } from '@/app/api/users/[id]/courses/route';
import { GET as getEnrollments } from '@/app/api/users/[id]/enrollments/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { courseContentRevision } from '@/lib/server/course-progress';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    course: { findMany: jest.fn(), count: jest.fn() },
    enrollment: { findMany: jest.fn(), count: jest.fn() },
    courseContent: { findMany: jest.fn() },
    coursePublication: { findMany: jest.fn() },
    courseContentProgress: { findMany: jest.fn() },
    quizAttempt: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
  },
}));

const published = {
  id: 'baseline', activePublicationId: 'baseline-1', title: 'Published course', description: 'Live', imageUrl: null,
  instructor: { id: 'owner', name: 'Ada', image: null }, price: null, currency: null, startDate: null, endDate: null,
  maxStudents: null, _count: { enrollments: 1, contents: 2 }, enrollments: [], createdAt: new Date('2026-03-01'),
};
const draft = { ...published, id: 'draft', activePublicationId: null, title: 'Hidden course' };
const params = { params: Promise.resolve({ id: 'owner' }) };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation(async (work: (db: typeof prisma) => Promise<unknown>) => work(prisma));
  (prisma.courseContent.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.courseContentProgress.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.coursePublication.findMany as jest.Mock).mockResolvedValue([{
    id: 'baseline-1', courseId: 'baseline', payload: JSON.stringify({ schemaVersion: 1, contents: [] }),
  }]);
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'owner', role: 'USER' } } as never);
  (prisma.course.findMany as jest.Mock).mockImplementation(async ({ where }: { where: { activePublicationId: { not: null } } }) =>
    [draft, published].filter(course => course.activePublicationId !== where.activePublicationId.not));
  (prisma.course.count as jest.Mock).mockImplementation(async ({ where }: { where: { activePublicationId: { not: null } } }) =>
    [draft, published].filter(course => course.activePublicationId !== where.activePublicationId.not).length);
  const rows = [draft, published].map(course => ({ course, enrolledAt: new Date('2026-03-02'), completedAt: null }));
  (prisma.enrollment.findMany as jest.Mock).mockImplementation(async ({ where }: { where: { course: { activePublicationId: { not: null } } } }) =>
    rows.filter(row => row.course.activePublicationId !== where.course.activePublicationId.not));
  (prisma.enrollment.count as jest.Mock).mockImplementation(async ({ where }: { where: { course: { activePublicationId: { not: null } } } }) =>
    rows.filter(row => row.course.activePublicationId !== where.course.activePublicationId.not).length);
});

it('reports current completion after a revision separately from first historical completion', async () => {
  const completedAt = new Date('2026-03-10');
  const enrolled = [{ userId: 'owner', completedAt }, { userId: 'friend', completedAt }];
  const current = { id: 'current-leaf', courseId: 'baseline', parentId: null,
    type: 'TEXT', content: '<p>Revised lesson</p>', order: 1 };
  (prisma.course.findMany as jest.Mock).mockResolvedValue([{ ...published, _count: { enrollments: 2, contents: 1 }, enrollments: enrolled }]);
  (prisma.enrollment.findMany as jest.Mock).mockResolvedValue([{ course: { ...published, _count: { enrollments: 2, contents: 1 }, enrollments: enrolled },
    enrolledAt: new Date('2026-03-02'), completedAt }]);
  (prisma.courseContent.findMany as jest.Mock).mockResolvedValue([current]);
  (prisma.coursePublication.findMany as jest.Mock).mockResolvedValue([{
    id: 'baseline-1', courseId: 'baseline', payload: JSON.stringify({ schemaVersion: 1, contents: [
      { id: current.id, parentId: null, title: 'Lesson', order: 1 },
    ] }),
  }]);
  (prisma.courseContentProgress.findMany as jest.Mock).mockResolvedValue([
    { courseId: 'baseline', userId: 'owner', contentId: current.id, revision: 'prior-revision', completedAt },
    { courseId: 'baseline', userId: 'friend', contentId: current.id, revision: courseContentRevision(current), completedAt },
  ]);

  const self = await getEnrollments(new Request('http://localhost/api/users/owner/enrollments') as never, params);
  const enrolledCourse = (await self.json()).courses[0];
  expect(enrolledCourse.stats).toMatchObject({ completionRate: 50, everCompletionRate: 100, lessonsCount: 1 });
  expect(enrolledCourse.completedAt).toEqual(completedAt.toISOString());
  expect((prisma.courseContentProgress.findMany as jest.Mock).mock.calls[0][0].where.userId).toEqual({ in: ['owner', 'friend'] });

  (prisma.courseContent.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.courseContentProgress.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.coursePublication.findMany as jest.Mock).mockResolvedValue([{
    id: 'baseline-1', courseId: 'baseline', payload: JSON.stringify({ schemaVersion: 1, contents: [] }),
  }]);
  const noLeaves = await getEnrollments(new Request('http://localhost/api/users/owner/enrollments') as never, params);
  expect((await noLeaves.json()).courses[0].stats).toMatchObject({ completionRate: 0, everCompletionRate: 100 });
});

it('keeps a single learner\'s private assignment result out of another member\'s public course response', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'unrelated-viewer', role: 'USER' } } as never);
  const completedAt = new Date('2026-03-10');
  const course = { ...published, _count: { enrollments: 1, contents: 1 },
    enrollments: [{ userId: 'learner', completedAt }] };
  const assignment = { id: 'assignment', courseId: 'baseline', parentId: null,
    type: 'ASSIGNMENT', content: JSON.stringify({ prompt: 'Explain your answer.', passingScore: 70 }), order: 1 };
  (prisma.course.findMany as jest.Mock).mockResolvedValue([course]);
  (prisma.courseContent.findMany as jest.Mock).mockResolvedValue([assignment]);
  (prisma.coursePublication.findMany as jest.Mock).mockResolvedValue([{
    id: 'baseline-1', courseId: 'baseline', payload: JSON.stringify({ schemaVersion: 1, contents: [
      { id: assignment.id, parentId: null, title: 'Assignment', order: 1 },
    ] }),
  }]);
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{
    courseId: 'baseline', userId: 'learner', contentId: assignment.id, completedAt,
  }]);

  const passed = await getInstructorCourses(new Request('http://localhost/api/users/owner/courses') as never, params);
  const passedBody = await passed.json();
  expect(passed.status).toBe(200);
  expect(passedBody.courses[0].stats).toEqual({
    enrollments: 1, maxStudents: null, rating: 0, ratingCount: 0, lessonsCount: 1,
  });

  // A withdrawn pass or historical completion must not change this public DTO.
  (prisma.course.findMany as jest.Mock).mockResolvedValue([{
    ...course, enrollments: [{ userId: 'learner', completedAt: null }],
  }]);
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
  const withdrawn = await getInstructorCourses(new Request('http://localhost/api/users/owner/courses') as never, params);
  expect(await withdrawn.json()).toEqual(passedBody);
  expect((prisma.course.findMany as jest.Mock).mock.calls[0][0].include).not.toHaveProperty('enrollments');
  expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  expect(prisma.coursePublication.findMany).not.toHaveBeenCalled();
  expect(prisma.courseContent.findMany).not.toHaveBeenCalled();
  expect(prisma.courseContentProgress.findMany).not.toHaveBeenCalled();
  expect(prisma.quizAttempt.findMany).not.toHaveBeenCalled();
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
});

it('hides unpublished owned courses from the profile list and pagination, even for the owner', async () => {
  const response = await getInstructorCourses(new Request('http://localhost/api/users/owner/courses') as never, params);
  const body = await response.json();
  expect(body.courses.map((course: { id: string }) => course.id)).toEqual(['baseline']);
  expect(body.pagination.total).toBe(1);
  expect((prisma.course.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ instructorId: 'owner', activePublicationId: { not: null } });
  expect((prisma.course.count as jest.Mock).mock.calls[0][0].where).toEqual({ instructorId: 'owner', activePublicationId: { not: null } });
  expect((prisma.course.findMany as jest.Mock).mock.calls[0][0].include._count.select.contents).toEqual({ where: { archivedAt: null } });
  expect(body.courses[0].stats.lessonsCount).toBe(2);
  expect(body.courses[0].stats).not.toHaveProperty('completionRate');
  expect(body.courses[0].stats).not.toHaveProperty('everCompletionRate');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

it('hides unpublished course metadata from the private enrollment list and pagination', async () => {
  const response = await getEnrollments(new Request('http://localhost/api/users/owner/enrollments') as never, params);
  const body = await response.json();
  expect(body.courses.map((course: { id: string }) => course.id)).toEqual(['baseline']);
  expect(JSON.stringify(body)).not.toContain('Hidden course');
  expect(body.pagination.total).toBe(1);
  expect((prisma.enrollment.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'owner', course: { activePublicationId: { not: null } } });
  expect((prisma.enrollment.count as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'owner', course: { activePublicationId: { not: null } } });
  expect((prisma.enrollment.findMany as jest.Mock).mock.calls[0][0].include.course.include._count.select.contents).toEqual({ where: { archivedAt: null } });
  expect(body.courses[0].stats.lessonsCount).toBe(2);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

it('does not treat a demoted administrator session as permission to view another learner\'s enrollments', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'stale-admin', role: 'ADMIN' } } as never);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'USER' });
  const response = await getEnrollments(new Request('http://localhost/api/users/owner/enrollments') as never, params);
  expect(response.status).toBe(403);
  expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  expect(prisma.enrollment.count).not.toHaveBeenCalled();
});
