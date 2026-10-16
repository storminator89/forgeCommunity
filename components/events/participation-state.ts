export type EventParticipationState = {
  registrationState: 'NONE' | 'WAITLISTED' | 'REGISTERED' | 'CONFIRMED' | 'ATTENDED';
  isAttending: boolean;
  isWaitlisted: boolean;
  canCancelRsvp: boolean;
  canLeaveWaitlist: boolean;
  attendeeCount: number;
  waitlistCount: number;
  waitlistPosition: number | null;
  maxAttendees: number | null;
  registrationClosed: boolean;
};

/** Do not turn an incomplete or contradictory reply into a successful RSVP. */
export function parseEventParticipation(value: unknown): EventParticipationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger Teilnahmestatus');
  const row = value as Record<string, unknown>;
  const count = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
  const states = ['NONE', 'WAITLISTED', 'REGISTERED', 'CONFIRMED', 'ATTENDED'];
  if (typeof row.registrationState !== 'string' || !states.includes(row.registrationState) ||
      !count(row.attendeeCount) || !count(row.waitlistCount) ||
      !(row.maxAttendees === null || count(row.maxAttendees) && row.maxAttendees > 0) ||
      !(row.waitlistPosition === null || count(row.waitlistPosition) && row.waitlistPosition > 0 && row.waitlistPosition <= row.waitlistCount) ||
      ['isAttending', 'isWaitlisted', 'canCancelRsvp', 'canLeaveWaitlist', 'registrationClosed'].some(key => typeof row[key] !== 'boolean')) {
    throw new Error('Ungültiger Teilnahmestatus');
  }
  const queued = row.registrationState === 'WAITLISTED';
  const attending = ['REGISTERED', 'CONFIRMED', 'ATTENDED'].includes(row.registrationState);
  const cancellable = row.registrationState === 'REGISTERED' || row.registrationState === 'CONFIRMED';
  if (row.isAttending !== attending || row.isWaitlisted !== queued || row.canLeaveWaitlist !== queued ||
      row.canCancelRsvp !== cancellable || (queued ? row.waitlistPosition === null : row.waitlistPosition !== null)) {
    throw new Error('Widersprüchlicher Teilnahmestatus');
  }
  return value as EventParticipationState;
}
