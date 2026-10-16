import type { EventParticipationState } from '../components/events/participation-state';

type EventFixture = { id: string; date: string; maxAttendees: number | null; attendeeCount: number; isAttending: boolean; canCancelRsvp: boolean };
export const participationFixture = (event: EventFixture): EventParticipationState => ({
  registrationState: event.isAttending ? event.canCancelRsvp ? 'REGISTERED' : 'ATTENDED' : 'NONE',
  isAttending: event.isAttending, canCancelRsvp: event.canCancelRsvp, isWaitlisted: false, canLeaveWaitlist: false,
  attendeeCount: event.attendeeCount, maxAttendees: event.maxAttendees, waitlistCount: 0, waitlistPosition: null,
  registrationClosed: new Date(event.date) <= new Date(),
});
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

/** Existing synthetic list fixtures now also provide the separate own-state API. */
export function eventApiFixture<T extends EventFixture>(load: T[] | (() => Promise<T[]>),
  write?: (id: string, options: RequestInit) => Promise<EventParticipationState>) {
  let latest: T[] = [];
  const states = new Map<string, EventParticipationState>();
  return jest.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = String(input);
    if (url === '/api/events') {
      const events = Array.isArray(load) ? load : await load();
      if (!options.signal?.aborted) { latest = events; states.clear(); }
      return response(events);
    }
    const match = /^\/api\/events\/([^/]+)\/rsvp$/.exec(url);
    if (!match) throw new Error(`Unexpected fixture URL: ${url}`);
    const id = decodeURIComponent(match[1]);
    const event = latest.find(row => row.id === id);
    if (!event) return response({ error: 'Event not found' }, 404);
    if (options.method === 'POST' || options.method === 'DELETE') {
      if (!write) throw new Error('Unexpected RSVP mutation');
      const result = await write(id, options);
      if (!options.signal?.aborted) states.set(id, result);
      return response(result);
    }
    return response(states.get(id) ?? participationFixture(event));
  });
}
