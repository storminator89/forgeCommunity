import 'server-only';

import { Prisma, type AttendeeStatus } from '@prisma/client';
import { ParticipationError, participationTransaction } from '@/lib/server/participation';

export const EVENT_PARTICIPATION_HEADERS = { 'Cache-Control': 'private, no-store' };
const occupied = { status: { not: 'CANCELLED' as const } };
const eventSelect = { id: true, date: true, maxAttendees: true } satisfies Prisma.EventSelect;
type EventSettings = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

export async function requireEventAccount(tx: Prisma.TransactionClient, userId: string, admin = false) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw new ParticipationError('Unauthorized', 401);
  if (admin && user.role !== 'ADMIN') throw new ParticipationError('Forbidden', 403);
}

/** All event-seat/queue writers take the same row lock before reading capacity.
 * The timestamp is not a revision or a client token. A real row UPDATE also
 * makes PostgreSQL/SQLite serialize competing queue and capacity changes. */
export async function lockEventParticipation(tx: Prisma.TransactionClient, eventId: string): Promise<EventSettings> {
  try {
    return await tx.event.update({ where: { id: eventId }, data: { updatedAt: new Date() }, select: eventSelect });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new ParticipationError('Event not found', 404);
    }
    throw error;
  }
}

/** Must share the caller's serializable transaction and event row lock. */
export async function promoteEventWaitlist(tx: Prisma.TransactionClient, event: EventSettings) {
  if (event.date <= new Date()) return;
  let attendeeCount = await tx.eventAttendee.count({ where: { eventId: event.id, ...occupied } });
  while (event.maxAttendees === null || attendeeCount < event.maxAttendees) {
    const next = await tx.eventWaitlist.findFirst({ where: { eventId: event.id }, orderBy: { id: 'asc' },
      select: { id: true, userId: true } });
    if (!next) return;
    // A removed queue ticket cannot be promoted by a retry or a second worker.
    const claimed = await tx.eventWaitlist.deleteMany({ where: { id: next.id, eventId: event.id } });
    if (!claimed.count) continue;
    const existing = await tx.eventAttendee.findUnique({ where: { eventId_userId: { eventId: event.id, userId: next.userId } },
      select: { status: true } });
    // Fail safely for a legacy/raw duplicate queue row: no second seat/notice.
    if (existing && existing.status !== 'CANCELLED') continue;
    await tx.eventAttendee.upsert({ where: { eventId_userId: { eventId: event.id, userId: next.userId } },
      create: { eventId: event.id, userId: next.userId, status: 'REGISTERED' }, update: { status: 'REGISTERED' } });
    await tx.notification.create({ data: {
      id: `event-waitlist-${next.id}`, userId: next.userId, type: 'EVENT',
      content: 'Ein Platz ist frei geworden. Du bist jetzt für das Event angemeldet.',
      targetType: 'EVENT', targetId: event.id,
    } });
    attendeeCount++;
  }
}

async function ownState(tx: Prisma.TransactionClient, event: EventSettings, userId: string) {
  const [attendee, queued, attendeeCount, waitlistCount] = await Promise.all([
    tx.eventAttendee.findUnique({ where: { eventId_userId: { eventId: event.id, userId } }, select: { status: true } }),
    tx.eventWaitlist.findUnique({ where: { eventId_userId: { eventId: event.id, userId } }, select: { id: true } }),
    tx.eventAttendee.count({ where: { eventId: event.id, ...occupied } }),
    tx.eventWaitlist.count({ where: { eventId: event.id } }),
  ]);
  const status: AttendeeStatus | null = attendee && attendee.status !== 'CANCELLED' ? attendee.status : null;
  const isWaitlisted = !status && Boolean(queued);
  const waitlistPosition = isWaitlisted && queued
    ? await tx.eventWaitlist.count({ where: { eventId: event.id, id: { lte: queued.id } } }) : null;
  return {
    registrationState: status ?? (isWaitlisted ? 'WAITLISTED' : 'NONE'),
    isAttending: Boolean(status), isWaitlisted,
    canCancelRsvp: status === 'REGISTERED' || status === 'CONFIRMED',
    canLeaveWaitlist: isWaitlisted,
    attendeeCount, waitlistCount, waitlistPosition, maxAttendees: event.maxAttendees,
    registrationClosed: event.date <= new Date(),
  };
}

export async function readEventParticipation(eventId: string, userId: string) {
  return participationTransaction(async tx => {
    await requireEventAccount(tx, userId);
    const event = await tx.event.findUnique({ where: { id: eventId }, select: eventSelect });
    if (!event) throw new ParticipationError('Event not found', 404);
    return ownState(tx, event, userId);
  });
}

export async function joinEvent(eventId: string, userId: string, allowWaitlist: boolean) {
  const result = await participationTransaction(async tx => {
    await requireEventAccount(tx, userId);
    const event = await lockEventParticipation(tx, eventId);
    const existing = await tx.eventAttendee.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { status: true } });
    if (existing && existing.status !== 'CANCELLED') return { state: await ownState(tx, event, userId), created: false };
    const queued = await tx.eventWaitlist.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { id: true } });
    if (event.date <= new Date()) {
      if (queued) return { state: await ownState(tx, event, userId), created: false };
      throw new ParticipationError('Registration for this event has closed', 409);
    }
    // Old tickets have priority even if a legacy/account-deletion change freed
    // a seat outside this service. A full legacy join commits any such repairs.
    await promoteEventWaitlist(tx, event);
    if (queued) return { state: await ownState(tx, event, userId), created: false };
    const attendeeCount = await tx.eventAttendee.count({ where: { eventId, ...occupied } });
    if (event.maxAttendees !== null && attendeeCount >= event.maxAttendees) {
      if (!allowWaitlist) return { full: true as const };
      await tx.eventWaitlist.create({ data: { eventId, userId } });
    } else {
      await tx.eventAttendee.upsert({ where: { eventId_userId: { eventId, userId } },
        create: { eventId, userId, status: 'REGISTERED' }, update: { status: 'REGISTERED' } });
    }
    return { state: await ownState(tx, event, userId), created: true };
  });
  if ('full' in result) throw new ParticipationError('Event is full', 409);
  return result;
}

export async function leaveEvent(eventId: string, userId: string) {
  return participationTransaction(async tx => {
    await requireEventAccount(tx, userId);
    const event = await lockEventParticipation(tx, eventId);
    const existing = await tx.eventAttendee.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { status: true } });
    if (existing?.status === 'ATTENDED') throw new ParticipationError('Recorded attendance cannot be cancelled', 409);
    await tx.eventWaitlist.deleteMany({ where: { eventId, userId } });
    if (existing && existing.status !== 'CANCELLED') {
      await tx.eventAttendee.update({ where: { eventId_userId: { eventId, userId } }, data: { status: 'CANCELLED' } });
    }
    await promoteEventWaitlist(tx, event);
    return ownState(tx, event, userId);
  });
}
