import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { ParticipationError, participationTransaction } from '@/lib/server/participation';

type Context = { params: Promise<{ id: string }> };
const active = { status: { not: 'CANCELLED' as const } };

async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

function failure(error: unknown) {
  if (error instanceof ParticipationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('Event RSVP failed:', error);
  return NextResponse.json({ error: 'Event RSVP failed' }, { status: 500 });
}

export async function POST(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: eventId } = await params;
  try {
    const result = await participationTransaction(async tx => {
      const event = await tx.event.findUnique({ where: { id: eventId }, select: { date: true, maxAttendees: true } });
      if (!event) throw new ParticipationError('Event not found', 404);
      const existing = await tx.eventAttendee.findUnique({
        where: { eventId_userId: { eventId, userId } }, select: { id: true, status: true },
      });
      const attendeeCount = await tx.eventAttendee.count({ where: { eventId, ...active } });
      if (existing && existing.status !== 'CANCELLED') return { attendeeCount, created: false, canCancelRsvp: existing.status !== 'ATTENDED' };
      if (event.date <= new Date()) throw new ParticipationError('Registration for this event has closed', 409);
      if (event.maxAttendees !== null && attendeeCount >= event.maxAttendees) throw new ParticipationError('Event is full', 409);
      if (existing) {
        await tx.eventAttendee.update({ where: { id: existing.id }, data: { status: 'REGISTERED' } });
      } else {
        await tx.eventAttendee.create({ data: { eventId, userId, status: 'REGISTERED' } });
      }
      return { attendeeCount: attendeeCount + 1, created: true, canCancelRsvp: true };
    });
    return NextResponse.json({ isAttending: true, canCancelRsvp: result.canCancelRsvp, attendeeCount: result.attendeeCount }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: eventId } = await params;
  try {
    const attendeeCount = await participationTransaction(async tx => {
      const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
      if (!event) throw new ParticipationError('Event not found', 404);
      const existing = await tx.eventAttendee.findUnique({
        where: { eventId_userId: { eventId, userId } }, select: { id: true, status: true },
      });
      if (existing?.status === 'ATTENDED') throw new ParticipationError('Recorded attendance cannot be cancelled', 409);
      if (existing && existing.status !== 'CANCELLED') {
        await tx.eventAttendee.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
      }
      return tx.eventAttendee.count({ where: { eventId, ...active } });
    });
    return NextResponse.json({ isAttending: false, canCancelRsvp: false, attendeeCount });
  } catch (error) {
    return failure(error);
  }
}
