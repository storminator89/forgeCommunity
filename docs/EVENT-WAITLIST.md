# Event waitlist contract

This optional FIFO waitlist is separate from attendance. The event participation panel deliberately exposes and labels this opt-in.

## API

`/api/events/[id]/rsvp` requires a live authenticated account for every method. Responses are private/no-store. The caller is always the session account; client-supplied identities and unknown body keys are rejected.

- GET returns the caller's current state and aggregate counts. It never returns queue tickets, identities, names, contact details or creation timestamps.
- Bodyless POST, including an empty request stream, preserves the existing contract: register immediately if a seat is available; return 409 if full. `{ "waitlist": true }` explicitly permits joining the queue if full. `{ "waitlist": false }` is equivalent to direct registration. JSON bodies are capped at 1 KiB.
- POST returns 201 for a new registration/queue entry, 200 for a replay. Repeated queued joins retain their position. New joins cannot bypass older tickets.
- DELETE withdraws the caller from the queue or cancels REGISTERED/CONFIRMED attendance. Repeated withdrawal is idempotent. ATTENDED cannot be cancelled. A later explicit rejoin gets a fresh ticket at the tail.

State fields:

- registrationState: NONE, WAITLISTED, REGISTERED, CONFIRMED or ATTENDED
- isAttending: only true for active attendance, never a queue entry
- isWaitlisted, canLeaveWaitlist: own queue state
- canCancelRsvp: only REGISTERED/CONFIRMED attendance
- attendeeCount: REGISTERED + CONFIRMED + ATTENDED, excluding CANCELLED and the queue
- waitlistCount: total queued; waitlistPosition: own 1-based FIFO position or null
- maxAttendees: capacity or null for unlimited; registrationClosed: start instant has passed

The event list retains its existing attendance-only shape. The UI reads the RSVP endpoint on demand and never infers queue state from the list's isAttending. Closing registration forbids new registrations and promotions; existing participation can still be read/replayed or withdrawn.

## Attendee UI

Visible participation panels fetch the caller's private state without caching. A full event offers a separate “Auf Warteliste setzen” action and explains automatic registration when a seat opens. Viewing an event never joins its queue. Ordinary joins remain bodyless. A queued caller sees their own position and a withdrawal action; registered callers see cancellation, while ATTENDED cannot be cancelled. No queue identities are displayed.

Writes are single-flight and never retried automatically. A 409 triggers a fresh read and asks the caller to check the result before another deliberate action. An uncertain write, failed read, expired authorization or missing event clears stale private state. Account changes remount the state owner and abort prior requests. Focus, visibility and a manual queue refresh revalidate promotion and position changes. The existing inbox opens a promotion only through its recipient-checked API and an exact internal event-anchor allowlist.

Source/UI tests cover these states plus keyboard focus and late responses. `e2e/events-waitlist.pw.ts` contains a guarded disposable SQLite/API/browser journey for FIFO leave/rejoin, cancellation/capacity promotion and the real inbox action, plus clearly labeled response fixtures for races and failures. Screenshots and responsive checks are authored at 320, 390 and desktop widths; actual browser/visual evidence requires the matching exact-head CI production build.

## Atomicity and notices

Every participation writer and admin event edit takes the same event-row lock inside a serializable/retried transaction. Admin edits and event deletion additionally re-check the live database role inside that boundary. Event creation retains its existing session-role check and does not touch waitlist state. Capacity cannot be reduced below occupied seats. Cancellation, capacity increases and removal of the capacity limit promote the oldest tickets into available seats. An incidental free seat, for example after account deletion, is reconciled on the next participation write; there is no background monitor or scheduler.

Claiming/removing a ticket, upserting REGISTERED attendance and creating one EVENT in-app notice commit together. Ticket IDs are globally increasing and non-reused; deterministic notice IDs also guard against duplicate delivery. Retries roll back every effect before re-reading authorization and capacity. No notice is sent for direct registration, queue joining or queue withdrawal. No email, external provider or general broadcast is involved.

The inbox resolves EVENT links only for its verified recipient's current active attendance and a still-existing event. Cancellation, account deletion or event deletion makes the prior promotion action unavailable and hides stale notification text. Event deletion cascades attendees/queue entries; historical notices are handled by the existing unavailable-target behavior.

## Verification

`__tests__/api/event-waitlist-db.test.ts` runs the same route/service, rollback, auth, FIFO and simultaneous-change cases against disposable SQLite and PostgreSQL. PostgreSQL mode requires EVENT_WAITLIST_POSTGRESQL_DISPOSABLE=1, DATABASE_PROVIDER=postgresql and a guarded local forge_test URL with no query/fragment; it owns only one random schema. CI runs it in the existing disposable PostgreSQL gate. `scripts/event-waitlist.node-tests.mjs` additionally exercises paired migration tails, populated preservation, constraints, FIFO identity non-reuse and strict readiness/history checks.
