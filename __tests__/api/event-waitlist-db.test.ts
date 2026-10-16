/** @jest-environment node */
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { getServerSession } from 'next-auth/next';
import { GET, POST, DELETE } from '@/app/api/events/[id]/rsvp/route';
import { PUT, DELETE as deleteEvent } from '@/app/api/events/[id]/route';
import { POST as openNotice } from '@/app/api/notifications/[id]/open/route';
import { GET as inbox } from '@/app/api/notifications/route';
import { joinEvent, leaveEvent, readEventParticipation } from '@/lib/server/event-participation';
import { POST as createEvent } from '@/app/api/events/route';
import { waitlistEventFixture } from '../../e2e/events-waitlist-fixture';

jest.setTimeout(30000);
jest.mock('next/server', () => ({ NextResponse: class extends Response {
  static json(body: unknown, init?: ResponseInit) { return new Response(JSON.stringify(body), init); }
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({ sanitizeTextServer: (s: string) => s.trim(), sanitizeRichHtmlServer: (s: string) => s.trim() }));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@prisma/client');
  if (process.env.EVENT_WAITLIST_POSTGRESQL_DISPOSABLE === '1') {
    if (process.env.DATABASE_PROVIDER !== 'postgresql') throw new Error('Waitlist PostgreSQL tests require DATABASE_PROVIDER=postgresql.');
    const { disposablePostgresqlTestUrl } = require('../../scripts/space-mission-test-database.cjs');
    const base = disposablePostgresqlTestUrl(process.env.DATABASE_URL);
    const { randomUUID } = require('node:crypto');
    const { Client } = require('pg');
    const { spawnSync } = require('node:child_process');
    const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
    const schema = `forge_event_waitlist_${randomUUID().replaceAll('-', '_')}`;
    const url = new URL(base); url.searchParams.set('schema', schema);
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: base }, { schema }) });
    return { __esModule: true, default: runtime,
      __initialize: async () => {
        const db = new Client({ connectionString: base }); await db.connect();
        try { await db.query(`CREATE SCHEMA "${schema}"`); } finally { await db.end(); }
        const result = spawnSync(process.execPath, ['scripts/db-deploy.mjs', '--initialize-empty-schema'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
          env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: url.toString() },
        });
        if (result.status !== 0) throw new Error(`Waitlist deployment failed: ${result.error?.message ?? result.stderr}`);
      },
      __finalize: async () => {
        const db = new Client({ connectionString: base }); await db.connect();
        try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); }
      },
    };
  }
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const path = join(mkdtempSync(join(tmpdir(), 'forge-event-waitlist-')), 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const directory = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(directory).filter((s: string) => /^\d+_.*\.sql$/.test(s)).sort()) db.exec(readFileSync(join(directory, name), 'utf8'));
  } finally { db.close(); }
  return { __esModule: true, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const params = { params: Promise.resolve({ id: 'event' }) };
const session = (id: string | null = 'a', role = 'USER') => jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
const request = (method: string, body?: unknown) => new Request('http://localhost/api/events/event/rsvp', { method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
const join = (body?: unknown) => POST(request('POST', body), params);
const leave = () => DELETE(request('DELETE'), params);
const read = () => GET(request('GET'), params);
const fields = { title: 'Workshop', description: 'Details', location: 'Hall', timezone: 'Europe/Berlin', category: 'Workshop',
  date: '2035-05-21', startTime: '12:00', endTime: '13:00' };
const resize = (maxAttendees: number | null) => PUT(request('PUT', { ...fields, maxAttendees }), params);
const seat = (userId: string, status: 'REGISTERED' | 'CONFIRMED' | 'ATTENDED' = 'REGISTERED') => prisma.eventAttendee.create({ data: { eventId: 'event', userId, status } });
const queue = (userId: string) => joinEvent('event', userId, true);
const activeCount = () => prisma.eventAttendee.count({ where: { eventId: 'event', status: { not: 'CANCELLED' } } });
type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;

beforeAll(async () => { await jest.requireMock('@/lib/prisma').__initialize?.(); }, 120000);
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks(); jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.event.deleteMany(); await prisma.user.deleteMany();
  await prisma.user.createMany({ data: ['a', 'b', 'c', 'd', 'e', 'f', 'admin', 'mod'].map(id => ({ id, email: `${id}@example.invalid`, role: id === 'admin' ? 'ADMIN' : id === 'mod' ? 'MODERATOR' : 'USER' })) });
  await prisma.event.create({ data: { id: 'event', ...fields, date: new Date('2035-05-21T10:00:00Z'), maxAttendees: 1 } });
  session();
});
afterAll(async () => { await prisma.$disconnect(); await jest.requireMock('@/lib/prisma').__finalize?.(); });

test('the exact real-browser fixture creates and resizes through the supported event-zone contract', async () => {
  session('admin', 'ADMIN');
  const fixture = waitlistEventFixture('route-regression', Date.UTC(2035, 4, 7));
  const before = await prisma.event.count();
  const rejected = await createEvent(request('POST', { ...fixture, timezone: 'UTC' }));
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toEqual({ error: 'Invalid timezone selected' });
  expect(await prisma.event.count()).toBe(before);

  const created = await createEvent(request('POST', fixture));
  expect(created.status).toBe(201);
  const body = await created.json();
  expect(body).toMatchObject({ title: fixture.title, timezone: 'Europe/Berlin', startTime: '12:00', endTime: '13:00', maxAttendees: 1 });
  expect((await prisma.event.findUniqueOrThrow({ where: { id: body.id } })).date.toISOString()).toBe('2035-05-21T10:00:00.000Z');
  const resized = await PUT(request('PUT', { ...fixture, maxAttendees: 2 }), { params: Promise.resolve({ id: body.id }) });
  expect(resized.status).toBe(200);
  expect(await resized.json()).toMatchObject({ timezone: 'Europe/Berlin', maxAttendees: 2 });
});

test('legacy direct registration/full behavior survives and queue entry needs explicit caller-only opt-in', async () => {
  expect((await join()).status).toBe(201);
  expect((await join()).status).toBe(200);
  session('b'); expect((await join()).status).toBe(409);
  expect((await POST(new Request('http://localhost/api/events/event/rsvp', { method: 'POST', body: '' }), params)).status).toBe(409);
  expect(await prisma.eventWaitlist.count()).toBe(0);
  const response = await join({ waitlist: true });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ registrationState: 'WAITLISTED', isAttending: false, isWaitlisted: true,
    canCancelRsvp: false, canLeaveWaitlist: true, attendeeCount: 1, waitlistCount: 1, waitlistPosition: 1 });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const ticket = await prisma.eventWaitlist.findFirst();
  expect((await join({ waitlist: true })).status).toBe(200);
  expect((await join()).status).toBe(200);
  expect((await prisma.eventWaitlist.findFirst())?.id).toBe(ticket!.id);
  for (const bad of [{ waitlist: true, userId: 'c' }, { userId: 'c' }, {}, [], null, { waitlist: 'true' }]) expect((await join(bad)).status).toBe(400);
  expect((await POST(new Request('http://localhost/api/events/event/rsvp', { method: 'POST', body: '{' }), params)).status).toBe(400);
  expect((await POST(new Request('http://localhost/api/events/event/rsvp', { method: 'POST', body: 'x'.repeat(1025) }), params)).status).toBe(413);
  expect(await prisma.eventWaitlist.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(0);
});

test('FIFO cancellation promotes one ticket and creates one targeted notice atomically; repeated cancellation is inert', async () => {
  await seat('a'); await queue('b'); await queue('c');
  expect((await leave()).status).toBe(200);
  expect(await activeCount()).toBe(1);
  expect(await prisma.eventAttendee.findUnique({ where: { eventId_userId: { eventId: 'event', userId: 'b' } } })).toMatchObject({ status: 'REGISTERED' });
  expect(await prisma.eventWaitlist.findMany({ orderBy: { id: 'asc' }, select: { userId: true } })).toEqual([{ userId: 'c' }]);
  expect(await prisma.notification.findMany()).toEqual([expect.objectContaining({ userId: 'b', type: 'EVENT', targetType: 'EVENT', targetId: 'event' })]);
  await leave(); await leave();
  expect(await prisma.notification.count()).toBe(1);
  expect(await activeCount()).toBe(1);
  session('b'); expect((await join()).status).toBe(200);
  expect(await prisma.notification.count()).toBe(1);
});

test('withdraw/rejoin goes to tail, never gains a seat or notice, and exposes only own position', async () => {
  await seat('a'); await queue('b'); await queue('c');
  session('b'); const first = await prisma.eventWaitlist.findFirst({ where: { userId: 'b' } });
  await leave(); await leave(); await join({ waitlist: true });
  expect((await prisma.eventWaitlist.findFirst({ where: { userId: 'b' } }))!.id).toBeGreaterThan(first!.id);
  const data = await (await read()).json();
  expect(data).toMatchObject({ registrationState: 'WAITLISTED', waitlistPosition: 2, waitlistCount: 2, attendeeCount: 1 });
  expect(JSON.stringify(data)).not.toMatch(/userId|email|createdAt|ticket|"[ac]"/);
  expect(await prisma.notification.count()).toBe(0);
  session('a'); await leave();
  expect(await prisma.notification.findFirst()).toMatchObject({ userId: 'c' });
});

test('capacity increases and unlimited changes promote FIFO without demoting occupied seats or duplicating notices', async () => {
  await seat('a'); await queue('b'); await queue('c'); await queue('d');
  session('admin', 'ADMIN');
  expect((await resize(2)).status).toBe(200);
  expect(await activeCount()).toBe(2);
  expect(await prisma.notification.findMany({ select: { userId: true } })).toEqual([{ userId: 'b' }]);
  expect((await resize(1)).status).toBe(409);
  expect((await prisma.event.findUnique({ where: { id: 'event' } }))?.maxAttendees).toBe(2);
  expect((await resize(null)).status).toBe(200);
  expect(await activeCount()).toBe(4);
  expect(await prisma.eventWaitlist.count()).toBe(0);
  await resize(null);
  expect(await prisma.notification.count()).toBe(3);
});

test('past closure forbids new seats/queues and promotion, but preserves repeated own reads and cancellation', async () => {
  await seat('a'); await queue('b');
  await prisma.event.update({ where: { id: 'event' }, data: { date: new Date('2000-01-01T00:00:00Z') } });
  session('c'); expect((await join({ waitlist: true })).status).toBe(409);
  session('b'); expect((await join({ waitlist: true })).status).toBe(200);
  session('a'); expect((await join()).status).toBe(200); await leave();
  expect(await activeCount()).toBe(0);
  expect(await prisma.eventWaitlist.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(0);
  session('b'); expect((await leave()).status).toBe(200);
});

test('recorded attendance cannot be cancelled or replaced by a queue ticket', async () => {
  await seat('a', 'ATTENDED'); await queue('b');
  expect((await leave()).status).toBe(409);
  expect((await join({ waitlist: true })).status).toBe(200);
  expect(await activeCount()).toBe(1);
  expect(await prisma.notification.count()).toBe(0);
});

test('anonymous/deleted callers cannot read or mutate; current DB roles gate capacity despite stale ADMIN claims', async () => {
  session(null);
  for (const invoke of [read, join, leave]) expect((await invoke()).status).toBe(401);
  session('deleted');
  for (const invoke of [read, join, leave]) expect((await invoke()).status).toBe(401);
  for (const id of ['a', 'mod']) {
    session(id, 'ADMIN'); expect((await resize(2)).status).toBe(403);
    expect((await deleteEvent(request('DELETE'), params)).status).toBe(403);
  }
  session('admin', 'ADMIN'); await prisma.user.delete({ where: { id: 'admin' } });
  expect((await resize(2)).status).toBe(401);
  expect((await deleteEvent(request('DELETE'), params)).status).toBe(401);
  expect(await activeCount()).toBe(0);
  expect(await prisma.eventWaitlist.count()).toBe(0);
  session('a');
  const missing = { params: Promise.resolve({ id: 'missing' }) };
  expect((await GET(request('GET'), missing)).status).toBe(404);
  expect((await POST(request('POST', { waitlist: true }), missing)).status).toBe(404);
  expect((await DELETE(request('DELETE'), missing)).status).toBe(404);
});

test('a fresh direct join cannot bypass tickets when an account deletion freed capacity', async () => {
  await seat('a'); await queue('b'); await queue('c');
  await prisma.user.delete({ where: { id: 'a' } });
  session('d'); expect((await join()).status).toBe(409);
  expect(await activeCount()).toBe(1);
  expect(await prisma.notification.findFirst()).toMatchObject({ userId: 'b' });
  expect(await prisma.eventWaitlist.findMany({ select: { userId: true } })).toEqual([{ userId: 'c' }]);
});

test('promotion notices are recipient-only and resolve only while their event and current RSVP remain available', async () => {
  await seat('a'); await queue('b'); await leave();
  const notice = await prisma.notification.findFirstOrThrow();
  session('c'); expect((await openNotice(request('POST'), { params: Promise.resolve({ id: notice.id }) })).status).toBe(404);
  session('b');
  expect(await (await openNotice(request('POST'), { params: Promise.resolve({ id: notice.id }) })).json()).toEqual({ href: '/events#event-event', label: 'Event ansehen' });
  await leave();
  expect((await openNotice(request('POST'), { params: Promise.resolve({ id: notice.id }) })).status).toBe(404);
  const data = await (await inbox(request('GET'))).json();
  expect(data.items[0]).toMatchObject({ targetState: 'unavailable', actionLabel: null });
  expect(JSON.stringify(data.items)).not.toContain('Ein Platz ist frei');
});

test('a failed promotion/notice transaction rolls back cancellation, claim, seat and notification together', async () => {
  await seat('a'); await queue('b');
  const transact = prisma.$transaction.bind(prisma);
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) =>
    transact(async tx => { await work(tx); throw new Error('rollback after notice'); }, options as never)) as never);
  expect((await leave()).status).toBe(500);
  expect(await activeCount()).toBe(1);
  expect(await prisma.eventWaitlist.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.eventAttendee.findUnique({ where: { eventId_userId: { eventId: 'event', userId: 'a' } } })).toMatchObject({ status: 'REGISTERED' });
});

test.each(['40001', '40P01'])('adapter COMMIT conflict %s retries rollback-safe promotion, exactly once', async code => {
  await seat('a'); await queue('b');
  const transact = prisma.$transaction.bind(prisma); let attempts = 0;
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) =>
    transact(async tx => { const result = await work(tx); if (++attempts === 1) throw new DriverAdapterError({ kind: 'TransactionWriteConflict', originalCode: code }); return result; }, options as never)) as never);
  expect((await leave()).status).toBe(200);
  expect(attempts).toBe(2);
  expect(await activeCount()).toBe(1);
  expect(await prisma.eventWaitlist.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(1);
});

test('repeated verified conflicts exhaust with 409 and cannot leave partial promotion or retry an arbitrary error', async () => {
  await seat('a'); await queue('b');
  const transact = prisma.$transaction.bind(prisma);
  const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) =>
    transact(async tx => { await work(tx); throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }); }, options as never)) as never);
  expect((await leave()).status).toBe(409);
  expect(transactions).toHaveBeenCalledTimes(4);
  expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.eventWaitlist.count()).toBe(1);
  transactions.mockRejectedValue(Object.assign(new Error('untrusted shape'), { code: 'P2034' }));
  transactions.mockClear();
  expect((await leave()).status).toBe(500);
  expect(transactions).toHaveBeenCalledTimes(1);
});

test('simultaneous joins, duplicate joins, cancellations and capacity changes never overbook or double-notify', async () => {
  await seat('a');
  const joined = await Promise.all(['b', 'b', 'c', 'd'].map(userId => queue(userId)));
  expect(joined.every(result => result.state.isWaitlisted)).toBe(true);
  expect(await prisma.eventWaitlist.count()).toBe(3);
  const order = await prisma.eventWaitlist.findMany({ orderBy: { id: 'asc' }, select: { userId: true } });
  await Promise.all([leaveEvent('event', 'a'), leaveEvent('event', 'a')]);
  expect(await activeCount()).toBe(1);
  expect(await prisma.notification.findFirst()).toMatchObject({ userId: order[0].userId });
  session('admin', 'ADMIN');
  await Promise.all([resize(2), resize(2), queue('e')]);
  expect(await activeCount()).toBe(2);
  expect(await prisma.notification.count()).toBe(2);
  const promoted = await prisma.notification.findMany({ select: { userId: true } });
  expect(new Set(promoted.map(row => row.userId)).size).toBe(2);
  expect(promoted.map(row => row.userId)).toEqual(expect.arrayContaining(order.slice(0, 2).map(row => row.userId)));
  await Promise.all([leaveEvent('event', order[0].userId), resize(3), queue('f')]);
  expect(await activeCount()).toBe(3);
  expect(await prisma.notification.count()).toBe(4);
  expect(await readEventParticipation('event', 'f')).toMatchObject({ isWaitlisted: true, isAttending: false });
  expect(new Set((await prisma.notification.findMany()).map(row => row.userId)).size).toBe(4);
  for (const userId of ['a', 'b', 'c', 'd', 'e']) {
    const state = await readEventParticipation('event', userId);
    expect(state.isAttending && state.isWaitlisted).toBe(false);
  }
});


test('authorized event deletion atomically cascades the queue and makes prior promotion notices unavailable', async () => {
  await seat('a'); await queue('b'); await queue('c'); await leave();
  expect(await prisma.eventWaitlist.count()).toBe(1);
  session('admin', 'ADMIN');
  expect((await deleteEvent(request('DELETE'), params)).status).toBe(200);
  expect(await prisma.eventWaitlist.count()).toBe(0);
  expect(await prisma.eventAttendee.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(1);
  session('b');
  const data = await (await inbox(request('GET'))).json();
  expect(data.items[0]).toMatchObject({ targetState: 'unavailable', actionLabel: null });
  expect((await read()).status).toBe(404);
});

test('a fresh retry rechecks a revoked admin role before resizing or promoting anyone', async () => {
  await seat('a'); await queue('b');
  session('admin', 'ADMIN');
  const transact = prisma.$transaction.bind(prisma); let first = true;
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) => {
    if (!first) return transact(work, options as never);
    first = false;
    try {
      await transact(async tx => { await work(tx); throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }); }, options as never);
    } catch (error) {
      await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
      throw error;
    }
  }) as never);
  expect((await resize(2)).status).toBe(403);
  expect((await prisma.event.findUnique({ where: { id: 'event' } }))?.maxAttendees).toBe(1);
  expect(await activeCount()).toBe(1);
  expect(await prisma.eventWaitlist.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(0);
});
