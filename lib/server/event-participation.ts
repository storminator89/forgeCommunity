import 'server-only';

import { Prisma, type AttendeeStatus } from '@/generated/prisma/client';
import { ParticipationError, participationTransaction } from '@/lib/server/participation';
import { readD1EventParticipation, joinD1Event, leaveD1Event } from '@/lib/server/d1-event-participation';

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
  return readD1EventParticipation(eventId, userId);
}

export async function joinEvent(eventId: string, userId: string, allowWaitlist: boolean) {
  return joinD1Event(eventId, userId, allowWaitlist);
}

export async function leaveEvent(eventId: string, userId: string) {
  return leaveD1Event(eventId, userId);
}
