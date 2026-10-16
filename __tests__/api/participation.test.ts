/** @jest-environment node */
import { GET as listCourses } from '@/app/api/courses/route';
import { POST as joinCourse, DELETE as leaveCourse } from '@/app/api/courses/[courseId]/enrollment/route';
import { GET as listEvents, POST as createEvent } from '@/app/api/events/route';
import { PUT as updateEvent } from '@/app/api/events/[id]/route';
import { POST as rsvp, DELETE as cancelRsvp } from '@/app/api/events/[id]/rsvp/route';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth/next';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.trim(),
  sanitizeRichHtmlServer: (value: string) => value.trim(),
}));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  $transaction: jest.fn(),
  user: { findUnique: jest.fn() },
  eventWaitlist: { findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
  course: { findUnique: jest.fn(), findMany: jest.fn() },
  courseContent: { findMany: jest.fn() },
  courseContentProgress: { findMany: jest.fn() },
  coursePublication: { findMany: jest.fn() },
  enrollment: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  event: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  eventAttendee: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
} }));

type MockDb = {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock };
  eventWaitlist: { findUnique: jest.Mock; findFirst: jest.Mock; count: jest.Mock; deleteMany: jest.Mock };
  course: { findUnique: jest.Mock; findMany: jest.Mock };
  courseContent: { findMany: jest.Mock };
  courseContentProgress: { findMany: jest.Mock };
  coursePublication: { findMany: jest.Mock };
  enrollment: { findUnique: jest.Mock; count: jest.Mock; create: jest.Mock; deleteMany: jest.Mock };
  event: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
  eventAttendee: { findUnique: jest.Mock; count: jest.Mock; create: jest.Mock; update: jest.Mock; upsert: jest.Mock };
};

const db = prisma as unknown as MockDb;
const courseParams = { params: Promise.resolve({ courseId: 'course-1' }) };
const eventParams = { params: Promise.resolve({ id: 'event-1' }) };
let course: { id: string; activePublicationId: string | null; price: number | null; maxStudents: number | null } | null;
let event: { id: string; date: Date; maxAttendees: number | null } | null;
let enrollments: Map<string, { id: string; completedAt: Date | null }>;
let attendees: Map<string, { id: string; status: string }>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'student', role: 'USER' } } as never);
  course = { id: 'course-1', activePublicationId: 'publication-1', price: null, maxStudents: 2 };
  event = { id: 'event-1', date: new Date('2030-10-14T10:00:00Z'), maxAttendees: 2 };
  enrollments = new Map();
  attendees = new Map();
  db.$transaction.mockImplementation((work: (tx: MockDb) => Promise<unknown>) => work(db));
  db.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
  db.eventWaitlist.findUnique.mockResolvedValue(null);
  db.eventWaitlist.findFirst.mockResolvedValue(null);
  db.eventWaitlist.count.mockResolvedValue(0);
  db.eventWaitlist.deleteMany.mockResolvedValue({ count: 0 });
  db.eventAttendee.upsert.mockImplementation(async ({ create }: { create: { userId: string; status: string } }) => {
    const row = { id: `rsvp-${create.userId}`, status: create.status };
    attendees.set(create.userId, row);
    return row;
  });
  db.course.findUnique.mockImplementation(async () => course);
  db.courseContent.findMany.mockResolvedValue([]);
  db.courseContentProgress.findMany.mockResolvedValue([]);
  db.coursePublication.findMany.mockResolvedValue([{ id: 'publication-1', courseId: 'course-1',
    payload: JSON.stringify({ schemaVersion: 1, contents: [] }) }]);
  db.enrollment.findUnique.mockImplementation(async ({ where }: { where: { userId_courseId: { userId: string } } }) => enrollments.get(where.userId_courseId.userId) ?? null);
  db.enrollment.count.mockImplementation(async () => enrollments.size);
  db.enrollment.create.mockImplementation(async ({ data }: { data: { userId: string } }) => {
    const row = { id: `enrollment-${data.userId}`, completedAt: null };
    enrollments.set(data.userId, row);
    return row;
  });
  db.enrollment.deleteMany.mockImplementation(async ({ where }: { where: { userId: string } }) => {
    enrollments.delete(where.userId);
    return { count: 1 };
  });
  db.event.findUnique.mockImplementation(async () => event);
  db.eventAttendee.findUnique.mockImplementation(async ({ where }: { where: { eventId_userId: { userId: string } } }) => attendees.get(where.eventId_userId.userId) ?? null);
  db.eventAttendee.count.mockImplementation(async () => [...attendees.values()].filter(row => row.status !== 'CANCELLED').length);
  db.eventAttendee.create.mockImplementation(async ({ data }: { data: { userId: string; status: string } }) => {
    const row = { id: `rsvp-${data.userId}`, status: data.status };
    attendees.set(data.userId, row);
    return row;
  });
  db.eventAttendee.update.mockImplementation(async ({ where, data }: { where: { id?: string; eventId_userId?: { userId: string } }; data: { status: string } }) => {
    const userId = where.eventId_userId?.userId ?? where.id!.slice('rsvp-'.length);
    const row = { id: `rsvp-${userId}`, status: data.status };
    attendees.set(userId, row);
    return row;
  });
  db.event.update.mockImplementation(async ({ data }: { data: Partial<NonNullable<typeof event>> }) => {
    event = { ...event!, ...data };
    return event;
  });
});

test('course join is authenticated, free-only, capacity-limited and idempotent', async () => {
  jest.mocked(getServerSession).mockResolvedValueOnce(null);
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(401);
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(201);
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(200);
  expect(enrollments.size).toBe(1);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'other', role: 'USER' } } as never);
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(201);
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'third', role: 'USER' } } as never);
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(409);
  course = { id: 'course-1', activePublicationId: 'publication-1', price: 49, maxStudents: null };
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(403);
  expect(enrollments.size).toBe(2);
});

test('free-course leave is idempotent but preserves completed and paid enrollments', async () => {
  enrollments.set('student', { id: 'enrollment-student', completedAt: null });
  expect((await leaveCourse(new Request('http://localhost'), courseParams)).status).toBe(200);
  expect((await leaveCourse(new Request('http://localhost'), courseParams)).status).toBe(200);
  enrollments.set('student', { id: 'enrollment-student', completedAt: new Date() });
  expect((await leaveCourse(new Request('http://localhost'), courseParams)).status).toBe(409);
  expect(enrollments.has('student')).toBe(true);
  course = { id: 'course-1', activePublicationId: 'publication-1', price: 10, maxStudents: null };
  expect((await leaveCourse(new Request('http://localhost'), courseParams)).status).toBe(403);
});

test('a guessed unpublished course ID cannot create or remove an enrollment', async () => {
  course!.activePublicationId = null;
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(404);
  expect((await leaveCourse(new Request('http://localhost'), courseParams)).status).toBe(404);
  expect(db.enrollment.create).not.toHaveBeenCalled();
  expect(db.enrollment.deleteMany).not.toHaveBeenCalled();
});

test('event RSVP/cancellation reuses the unique attendee record and releases capacity', async () => {
  expect((await rsvp(new Request('http://localhost'), eventParams)).status).toBe(201);
  expect((await rsvp(new Request('http://localhost'), eventParams)).status).toBe(200);
  expect(attendees.size).toBe(1);
  event!.maxAttendees = 1;
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'other', role: 'USER' } } as never);
  expect((await rsvp(new Request('http://localhost'), eventParams)).status).toBe(409);
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'student', role: 'USER' } } as never);
  expect((await cancelRsvp(new Request('http://localhost'), eventParams)).status).toBe(200);
  expect((await cancelRsvp(new Request('http://localhost'), eventParams)).status).toBe(200);
  expect(attendees.get('student')?.status).toBe('CANCELLED');
  expect((await rsvp(new Request('http://localhost'), eventParams)).status).toBe(201);
  expect(attendees.size).toBe(1);
  expect(attendees.get('student')?.status).toBe('REGISTERED');
});

test('past events cannot gain new RSVPs, but existing RSVPs may be cancelled', async () => {
  event!.date = new Date('2020-01-01T00:00:00Z');
  expect((await rsvp(new Request('http://localhost'), eventParams)).status).toBe(409);
  attendees.set('student', { id: 'rsvp-student', status: 'REGISTERED' });
  expect((await rsvp(new Request('http://localhost'), eventParams)).status).toBe(200);
  expect((await cancelRsvp(new Request('http://localhost'), eventParams)).status).toBe(200);
});

test('recorded attendance is never erased by RSVP cancellation', async () => {
  attendees.set('student', { id: 'rsvp-student', status: 'ATTENDED' });
  const response = await cancelRsvp(new Request('http://localhost'), eventParams);
  expect(response.status).toBe(409);
  expect(attendees.get('student')?.status).toBe('ATTENDED');
});

test('serialization conflict retries before rejecting a valid join', async () => {
  db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }));
  expect((await joinCourse(new Request('http://localhost'), courseParams)).status).toBe(201);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
});

test('event capacity input is strict, and admins cannot reduce capacity below live RSVPs', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never);
  const fields = {
    title: 'Workshop', description: 'Description', location: 'Hall', category: 'Design',
    date: '2030-10-14', startTime: '12:00', endTime: '13:00', timezone: 'Europe/Berlin',
  };
  const request = (body: object) => new Request('http://localhost/api/events/event-1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  expect((await updateEvent(request({ ...fields, maxAttendees: true }), eventParams)).status).toBe(400);
  attendees.set('student', { id: 'rsvp-student', status: 'REGISTERED' });
  attendees.set('other', { id: 'rsvp-other', status: 'CONFIRMED' });
  expect((await updateEvent(request({ ...fields, maxAttendees: 1 }), eventParams)).status).toBe(409);
  expect(event!.maxAttendees).toBe(2);
  expect((await updateEvent(request({ ...fields, maxAttendees: 3 }), eventParams)).status).toBe(200);
  expect(event!.maxAttendees).toBe(3);
  const create = new Request('http://localhost/api/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, maxAttendees: [] }),
  });
  expect((await createEvent(create)).status).toBe(400);
});

test('listing exposes counts and own state without sending another participant’s ID', async () => {
  db.course.findMany.mockResolvedValue([{
    id: 'course-1', title: 'Course', description: 'Description', instructorId: 'teacher', activePublicationId: 'publication-1',
    instructor: { name: 'Teacher' }, startDate: null, endDate: null, price: null,
    currency: null, maxStudents: 5, imageUrl: null, _count: { enrollments: 2 },
    enrollments: [{ completedAt: null }],
  }]);
  const courses = await (await listCourses()).json();
  expect(courses[0]).toMatchObject({ participants: 2, isEnrolled: true, maxStudents: 5, completed: false, everCompleted: false });
  expect(JSON.stringify(courses)).not.toContain('other-user');
  expect(db.course.findMany.mock.calls[0][0].select.enrollments).toEqual({ where: { userId: 'student' }, select: { completedAt: true } });
  db.event.findMany.mockResolvedValue([{
    id: 'event-1', title: 'Event', date: new Date('2030-10-14T10:00:00Z'),
    description: 'Description', location: 'Hall', startTime: '12:00', endTime: '13:00',
    category: 'Design', timezone: 'Europe/Berlin', maxAttendees: 5,
    _count: { attendees: 2 }, attendees: [{ status: 'REGISTERED' }],
  }]);
  const events = await (await listEvents()).json();
  expect(events[0]).toMatchObject({ attendeeCount: 2, isAttending: true, maxAttendees: 5 });
  expect(db.event.findMany.mock.calls[0][0].include.attendees.where).toEqual({ userId: 'student' });
});


test.each([
  { date: '2030-03-31', startTime: '02:30', endTime: '04:00' },
  { date: '2030-10-27', startTime: '02:30', endTime: '04:00' },
  { date: '2030-03-31', startTime: '00:30', endTime: '02:30' },
  { date: '2030-10-27', startTime: '00:30', endTime: '02:30' },
  { date: '2030-02-30', startTime: '10:00', endTime: '11:00' },
  { date: '2030-05-21', startTime: '10:00:00', endTime: '11:00' },
])('creation and updates reject invalid or ambiguous wall time without writing: %j', async schedule => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never);
  const body = { title: 'Workshop', description: 'Details', location: 'Hall', timezone: 'Europe/Berlin', ...schedule };
  const request = () => new Request('http://localhost/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect((await createEvent(request())).status).toBe(400);
  expect((await updateEvent(request(), eventParams)).status).toBe(400);
  expect(db.event.create).not.toHaveBeenCalled();
  expect(db.event.update).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
});

test('create and edit persist the same UTC instant and event-zone clock across midnight', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never);
  db.event.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'event-1', ...data }));
  const body = { title: 'Workshop', description: 'Details', location: 'Hall', timezone: 'Europe/Berlin', date: '2030-05-21', startTime: '00:30', endTime: '01:30' };
  const request = () => new Request('http://localhost/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const created = await createEvent(request());
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ date: '2030-05-21T00:30:00.000+02:00', startTime: '00:30', endTime: '01:30' });
  expect(db.event.create.mock.calls[0][0].data.date.toISOString()).toBe('2030-05-20T22:30:00.000Z');
  const edited = await updateEvent(request(), eventParams);
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ date: '2030-05-21T00:30:00.000+02:00', startTime: '00:30', endTime: '01:30' });
  expect(db.event.update).toHaveBeenCalledTimes(2);
  expect(db.event.update.mock.calls[0][0].data).toEqual({ updatedAt: expect.any(Date) });
  expect(db.event.update.mock.calls[1][0].data.date.toISOString()).toBe('2030-05-20T22:30:00.000Z');
});
