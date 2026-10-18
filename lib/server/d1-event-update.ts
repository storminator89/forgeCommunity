import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { DateTime } from 'luxon';
import { ParticipationError } from '@/lib/server/participation';
import {
  prefixCtes, noticeContent, failure, keys, integer, text, bit, status,
  jsonBytes, boundedJson, prepare, preparedBatch, sqlRollback, committed,
} from '@/lib/server/d1-event-participation';

type Scalar = string | number | null;
type Status = 'REGISTERED' | 'CONFIRMED' | 'ATTENDED' | 'CANCELLED';
type EventInput = {
  title: string; date: Date; description: string; location: string; startTime: string;
  endTime: string; category: string; timezone: string; maxAttendees: number | null | undefined;
};
type UpdatedEvent = Omit<EventInput, 'maxAttendees'> & { id: string; maxAttendees: number | null };
const contextFields = ['authorized', 'admin', 'found', 'capacityFits', 'maxAttendees', 'attendeeCount'] as const;
type Context = Record<typeof contextFields[number], Scalar>;
type Ticket = { id: number; userId: string; userExists: number };
type Attendee = { id: string; userId: string; status: Status };
type Snapshot = { context: Context; queue: Ticket[]; attendees: Attendee[]; scan: boolean };
type Update = { id: string; userId: string; before: Status; after: Status };
type Notice = { id: string; userId: string };
type Plan = {
  before: Snapshot; after: { context: Context; attendees: Attendee[] };
  inserts: Attendee[]; updates: Update[]; deleted: number[]; notices: Notice[];
};
const ROW_BYTES = 200_000; // Queue/attendee transport only, never an Event/body limit.
const RESULT_BYTES = 1_200_000;
const MAX_TICKET = 2147483647;
const snapshotMarker = 'D1_EVENT_ADMIN_UPDATE_SNAPSHOT_CONFLICT';
const collisionMarker = 'D1_EVENT_ADMIN_UPDATE_ID_COLLISION';
const invariantMarker = 'D1_EVENT_ADMIN_UPDATE_WRITE_INVARIANT';
const conflict = () => new ParticipationError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
type Database = ReturnType<typeof database>;

/** No old prose, datetime, profile or own-RSVP state is consumed. An explicitly
 * supplied capacity overwrites old storage without introducing an old-value
 * validity gate. Omission consumes and guards the current stored capacity. */
const contextCtes = `params AS (SELECT ?1 AS userId, ?2 AS eventId, ?13 AS requestedCapacity, ?15 AS preserveCapacity),
  actor AS (SELECT id, role FROM User WHERE id = (SELECT userId FROM params)),
  target AS (SELECT id, maxAttendees FROM Event WHERE id = (SELECT eventId FROM params)
    AND EXISTS(SELECT 1 FROM actor WHERE role = 'ADMIN')),
  context AS (SELECT EXISTS(SELECT 1 FROM actor) AS authorized,
    EXISTS(SELECT 1 FROM actor WHERE role = 'ADMIN') AS admin, EXISTS(SELECT 1 FROM target) AS found,
    ((SELECT preserveCapacity FROM params) = 0 OR NOT EXISTS(SELECT 1 FROM target
      WHERE typeof(maxAttendees) NOT IN ('integer', 'null')
        OR COALESCE(length(CAST(maxAttendees AS BLOB)), 0) > 64)) AS capacityFits,
    CASE WHEN (SELECT preserveCapacity FROM params) = 0 THEN (SELECT requestedCapacity FROM params)
      ELSE (SELECT CASE WHEN typeof(maxAttendees) IN ('integer', 'null')
        AND COALESCE(length(CAST(maxAttendees AS BLOB)), 0) <= 64 THEN maxAttendees END FROM target) END AS maxAttendees,
    NULL AS ownStatus,
    (SELECT COUNT(*) FROM EventAttendee WHERE eventId = (SELECT id FROM target) AND status <> 'CANCELLED') AS attendeeCount)`;
const contextSelection = contextFields.map(field => `c."${field}"`).join(', ');
const contextSql = `WITH ${contextCtes} SELECT ${contextSelection} FROM context c`;
const snapshotSql = `WITH ${contextCtes}, ${prefixCtes('0')},
  queue_scope AS (SELECT q.id, q.userId, EXISTS(SELECT 1 FROM User u WHERE u.id = q.userId) AS userExists
    FROM EventWaitlist q WHERE q.eventId = (SELECT id FROM target) AND q.id <= (SELECT id FROM cutoff)),
  attendee_scope AS (SELECT a.id, a.userId, a.status FROM EventAttendee a
    WHERE a.eventId = (SELECT id FROM target) AND EXISTS(SELECT 1 FROM queue_scope q WHERE q.userId = a.userId)),
  records AS (SELECT 'queue' AS kind, id, userId, NULL AS status, userExists FROM queue_scope
    UNION ALL SELECT 'attendee', id, userId, status, NULL FROM attendee_scope),
  sizes AS (SELECT COALESCE(length(CAST(id AS BLOB)), 0) + COALESCE(length(CAST(userId AS BLOB)), 0)
      + COALESCE(length(CAST(status AS BLOB)), 0) + 32 AS bytes,
      (typeof(id) IN ('text', 'integer') AND typeof(userId) = 'text'
        AND typeof(status) IN ('text', 'null')) AS typed FROM records),
  budget AS (SELECT (COALESCE(MIN(typed), 1) = 1 AND COALESCE(MAX(bytes), 0) <= ${ROW_BYTES}
    AND COALESCE(SUM(6 * bytes + 1024), 0) + 16384 <= ${RESULT_BYTES}) AS fits FROM sizes)
  SELECT 'context' AS kind, NULL AS id, NULL AS userId, NULL AS status, NULL AS userExists,
    (SELECT fits FROM budget) AS fits, (SELECT COUNT(*) FROM queue_scope) AS queueRows,
    (SELECT COUNT(*) FROM attendee_scope) AS attendeeRows, ${contextSelection} FROM context c
  UNION ALL SELECT r.kind, r.id, r.userId, r.status, r.userExists, NULL, NULL, NULL,
    ${contextFields.map(() => 'NULL').join(', ')} FROM records r CROSS JOIN budget b WHERE b.fits = 1`;

function contextFrom(value: unknown): Context {
  keys(value, contextFields);
  if (Object.values(value).some(item => item !== null && typeof item !== 'string' &&
      (typeof item !== 'number' || !Number.isFinite(item)))) throw new Error('Invalid D1 Event update context');
  return value as Context;
}
function authorize(c: Context) {
  bit(c.authorized); bit(c.admin); bit(c.found);
  if (c.authorized !== 1) throw new ParticipationError('Unauthorized', 401);
  if (c.admin !== 1) throw new ParticipationError('Forbidden', 403);
  if (c.found !== 1) throw new ParticipationError('Event not found', 404);
}
function validateContext(c: Context) {
  authorize(c);
  bit(c.capacityFits);
  if (c.capacityFits !== 1) throw new Error('Invalid D1 Event update capacity storage');
  if (c.maxAttendees !== null) integer(c.maxAttendees, 1, MAX_TICKET);
  integer(c.attendeeCount);
  if (c.maxAttendees !== null && (c.attendeeCount as number) > (c.maxAttendees as number)) {
    throw new ParticipationError('Capacity is below current registrations', 409);
  }
}
function sameContext(a: Context, b: Context) { return contextFields.every(field => a[field] === b[field]); }
async function select(db: Database, sql: string, values: Scalar[]) {
  try { return await prepare(db, sql, values).all(); }
  catch { throw new Error('D1 Event update native read failed'); }
}
async function readAuthority(db: Database, values: Scalar[]): Promise<Context> {
  const result = await select(db, contextSql, values);
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) throw new Error('Incomplete D1 Event update authority');
  const c = contextFrom(result.results[0]);
  validateContext(c);
  return c;
}
async function readPrefix(db: Database, values: Scalar[], scan: boolean): Promise<Snapshot> {
  const result = await select(db, snapshotSql, values);
  if (result.success !== true || !Array.isArray(result.results)) throw new Error('Incomplete D1 Event update prefix');
  const fields = ['kind', 'id', 'userId', 'status', 'userExists', 'fits', 'queueRows', 'attendeeRows', ...contextFields];
  const headers = result.results.filter(row => row && row.kind === 'context');
  if (headers.length !== 1) throw new Error('Missing D1 Event update context');
  const header = headers[0]; keys(header, fields);
  const context = contextFrom(Object.fromEntries(contextFields.map(field => [field, header[field]])));
  validateContext(context);
  if (header.id !== null || header.userId !== null || header.status !== null || header.userExists !== null || header.fits !== 1) {
    throw new Error('D1 Event update prefix exceeds safe transport bounds');
  }
  integer(header.queueRows); integer(header.attendeeRows);
  const queue: Ticket[] = [], attendees: Attendee[] = [];
  const ids = new Set<number>(), attendeeIds = new Set<string>(), attendeeUsers = new Set<string>();
  let bytes = 16384;
  for (const row of result.results) {
    keys(row, fields);
    if (row.kind === 'context') continue;
    if (row.fits !== null || row.queueRows !== null || row.attendeeRows !== null || contextFields.some(field => row[field] !== null)) {
      throw new Error('Unscoped D1 Event update row');
    }
    text(row.userId);
    const rowBytes = Buffer.byteLength(row.userId, 'utf8') + (typeof row.id === 'string' ? Buffer.byteLength(row.id, 'utf8') : 32)
      + (typeof row.status === 'string' ? Buffer.byteLength(row.status, 'utf8') : 0) + 32;
    bytes += 6 * rowBytes + 1024;
    if (rowBytes > ROW_BYTES || bytes > RESULT_BYTES) throw new Error('Oversized D1 Event update prefix');
    if (row.kind === 'queue') {
      integer(row.id, 1, MAX_TICKET); bit(row.userExists);
      if (row.status !== null || ids.has(row.id)) throw new Error('Invalid D1 Event update tickets');
      ids.add(row.id); queue.push({ id: row.id, userId: row.userId, userExists: row.userExists });
    } else if (row.kind === 'attendee') {
      text(row.id); status(row.status);
      if (row.userExists !== null || attendeeIds.has(row.id) || attendeeUsers.has(row.userId)) throw new Error('Ambiguous D1 Event update attendee pair');
      attendeeIds.add(row.id); attendeeUsers.add(row.userId);
      attendees.push({ id: row.id, userId: row.userId, status: row.status });
    } else throw new Error('Unknown D1 Event update row');
  }
  if (queue.length !== header.queueRows || attendees.length !== header.attendeeRows ||
      attendees.some(a => !queue.some(q => q.userId === a.userId)) || (!scan && (queue.length || attendees.length))) {
    throw new Error('Incomplete D1 Event update relevant sets');
  }
  queue.sort((a, b) => a.id - b.id);
  attendees.sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  return { context, queue, attendees, scan };
}

/** The unchanged shared SQL chooses the complete cutoff. This isolated fold
 * mirrors its active skips and earliest-inactive winner, including the admin. */
function promotionPlan(before: Snapshot, eventId: string, now: string): Plan {
  const current = new Map(before.attendees.map(a => [a.userId, { ...a }]));
  const initial = new Map(before.attendees.map(a => [a.userId, a]));
  const deleted: number[] = [], notices: Notice[] = [];
  let count = before.context.attendeeCount as number;
  for (const ticket of before.queue) {
    if (!before.scan || (before.context.maxAttendees !== null && count >= (before.context.maxAttendees as number))) {
      throw new Error('Incomplete D1 Event update consumed prefix');
    }
    deleted.push(ticket.id);
    const old = current.get(ticket.userId);
    if (old && old.status !== 'CANCELLED') continue;
    if (ticket.userExists !== 1) throw new Error('Missing promoted D1 Event User');
    if (old) old.status = 'REGISTERED';
    else current.set(ticket.userId, { id: randomUUID(), userId: ticket.userId, status: 'REGISTERED' });
    notices.push({ id: `event-waitlist-${ticket.id}`, userId: ticket.userId });
    count++;
  }
  const inserts = [...current.values()].filter(a => !initial.has(a.userId));
  const updates = [...current.values()].flatMap(a => {
    const old = initial.get(a.userId);
    return old && old.status !== a.status ? [{ id: a.id, userId: a.userId, before: old.status, after: a.status }] : [];
  });
  if (new Set(inserts.map(a => a.id)).size !== inserts.length || new Set(notices.map(n => n.id)).size !== notices.length) throw conflict();
  for (const a of inserts) { text(a.id); text(a.userId); status(a.status); }
  for (const n of notices) { text(n.id); text(n.userId); }
  if (inserts.some(a => Buffer.byteLength(a.id, 'utf8') + Buffer.byteLength(a.userId, 'utf8') + Buffer.byteLength(eventId, 'utf8') + 64 > ROW_BYTES) ||
      notices.some(n => Buffer.byteLength(n.id, 'utf8') + Buffer.byteLength(n.userId, 'utf8') + Buffer.byteLength(eventId, 'utf8') +
        Buffer.byteLength(now, 'utf8') + Buffer.byteLength(noticeContent, 'utf8') + 256 > ROW_BYTES)) {
    throw new Error('Oversized D1 Event update participation row');
  }
  return { before, after: { context: { ...before.context, attendeeCount: count }, attendees: [...current.values()] }, inserts, updates, deleted, notices };
}

const batchCtes = `${contextCtes}, input AS (SELECT ?4 AS data), ${prefixCtes('0')},
  expected_context AS (SELECT ${contextFields.map(field => `json_extract((SELECT data FROM input), '$.before.context.${field}') AS "${field}"`).join(', ')}),
  expected_queue AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.userExists') AS userExists FROM json_each((SELECT data FROM input), '$.before.queue') j),
  expected_attendees AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.status') AS status FROM json_each((SELECT data FROM input), '$.before.attendees') j),
  actual_queue AS (SELECT q.id, q.userId, EXISTS(SELECT 1 FROM User u WHERE u.id = q.userId) AS userExists
    FROM EventWaitlist q WHERE q.eventId = (SELECT id FROM target) AND q.id <= (SELECT MAX(id) FROM expected_queue)),
  actual_attendees AS (SELECT a.id, a.userId, a.status FROM EventAttendee a
    WHERE a.eventId = (SELECT id FROM target) AND EXISTS(SELECT 1 FROM expected_queue q WHERE q.userId = a.userId)),
  planned_inserts AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.status') AS status FROM json_each((SELECT data FROM input), '$.inserts') j),
  planned_updates AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.before') AS before, json_extract(j.value, '$.after') AS after FROM json_each((SELECT data FROM input), '$.updates') j),
  planned_notices AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId
    FROM json_each((SELECT data FROM input), '$.notices') j)`;
function sameSet(actual: string, expected: string, fields: string[]) {
  const equality = fields.map(field => `a."${field}" IS e."${field}"`).join(' AND ');
  return `(SELECT COUNT(*) FROM ${actual}) = (SELECT COUNT(*) FROM ${expected})
    AND NOT EXISTS(SELECT 1 FROM ${actual} a WHERE NOT EXISTS(SELECT 1 FROM ${expected} e WHERE ${equality}))
    AND NOT EXISTS(SELECT 1 FROM ${expected} e WHERE NOT EXISTS(SELECT 1 FROM ${actual} a WHERE ${equality}))`;
}
const beforeMatches = `(SELECT id FROM cutoff) IS (SELECT MAX(id) FROM expected_queue)
  AND ${contextFields.map(field => `c."${field}" IS e."${field}"`).join(' AND ')}
  AND ${sameSet('actual_queue', 'expected_queue', ['id', 'userId', 'userExists'])}
  AND ${sameSet('actual_attendees', 'expected_attendees', ['id', 'userId', 'status'])}`;
const collisions = `EXISTS(SELECT 1 FROM planned_inserts p JOIN EventAttendee a
    ON a.id = p.id OR (a.eventId = (SELECT eventId FROM params) AND a.userId = p.userId))
  OR EXISTS(SELECT 1 FROM planned_notices p JOIN Notification n ON n.id = p.id)`;
const promotionUsersLive = `NOT EXISTS(SELECT 1 FROM planned_notices p WHERE NOT EXISTS(SELECT 1 FROM User u WHERE u.id = p.userId))`;
const preguardSql = `WITH ${batchCtes} SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM context c CROSS JOIN expected_context e WHERE ${beforeMatches}) THEN ${failure(snapshotMarker)}
  WHEN ${collisions} THEN ${failure(collisionMarker)}
  WHEN NOT (${promotionUsersLive}) THEN ${failure(invariantMarker)} ELSE 1 END AS guarded`;

/** Event prose is bound separately, once per statement that needs it. It never
 * appears in the FIFO manifest or old-row snapshot. */
const eventCtes = `event_values AS (SELECT ?5 AS title, ?6 AS date, ?7 AS description, ?8 AS location,
  ?9 AS startTime, ?10 AS endTime, ?11 AS category, ?12 AS timezone, ?13 AS maxAttendees, ?14 AS updatedAt)`;
const eventFields = ['title', 'date', 'description', 'location', 'startTime', 'endTime', 'category', 'timezone', 'maxAttendees', 'updatedAt'] as const;
const exactEvent = `EXISTS(SELECT 1 FROM actor WHERE role = 'ADMIN')
  AND (SELECT COUNT(*) FROM Event WHERE id IS (SELECT eventId FROM params)) = 1
  AND EXISTS(SELECT 1 FROM Event a CROSS JOIN event_values e WHERE a.id IS (SELECT eventId FROM params)
    AND ${eventFields.map(field => `a."${field}" IS e."${field}"`).join(' AND ')}
    AND ${eventFields.filter(field => field !== 'maxAttendees').map(field => `typeof(a."${field}") = 'text'`).join(' AND ')}
    AND typeof(a.maxAttendees) IN ('integer', 'null'))`;
const exactInserts = `NOT EXISTS(SELECT 1 FROM planned_inserts p WHERE
  (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id AND a.eventId IS (SELECT eventId FROM params) AND a.userId IS p.userId AND a.status IS p.status) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.eventId IS (SELECT eventId FROM params) AND a.userId IS p.userId) <> 1)`;
const exactUpdates = `NOT EXISTS(SELECT 1 FROM planned_updates p WHERE
  (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id AND a.eventId IS (SELECT eventId FROM params) AND a.userId IS p.userId AND a.status IS p.after) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.eventId IS (SELECT eventId FROM params) AND a.userId IS p.userId) <> 1)`;
const exactDeleted = `NOT EXISTS(SELECT 1 FROM EventWaitlist q WHERE q.eventId IS (SELECT eventId FROM params)
  AND q.id IN (SELECT value FROM json_each((SELECT data FROM input), '$.deleted')))`;
const exactNotices = `NOT EXISTS(SELECT 1 FROM planned_notices p WHERE
  (SELECT COUNT(*) FROM Notification n WHERE n.id IS p.id AND n.userId IS p.userId AND n.type IS 'EVENT'
    AND n.content IS '${noticeContent}' AND n.targetType IS 'EVENT' AND n.targetId IS (SELECT eventId FROM params)
    AND typeof(n.isRead) = 'integer' AND n.isRead IS 0 AND typeof(n.createdAt) = 'text' AND n.createdAt IS ?14) <> 1
  OR (SELECT COUNT(*) FROM Notification n WHERE n.id IS p.id) <> 1)`;
const eventWriteSql = `WITH ${eventCtes} UPDATE Event SET
  ${eventFields.map(field => `"${field}" = (SELECT "${field}" FROM event_values)`).join(', ')} WHERE id IS ?2`;
const eventAssertSql = `WITH ${batchCtes}, ${eventCtes} SELECT CASE WHEN changes() = 1 AND ${exactEvent}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const attendeeInsertSql = `WITH ${batchCtes} INSERT INTO EventAttendee (id, eventId, userId, status)
  SELECT id, (SELECT eventId FROM params), userId, status FROM planned_inserts`;
const attendeeInsertAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = (SELECT COUNT(*) FROM planned_inserts) AND ${exactInserts}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const attendeeUpdateSql = `WITH ${batchCtes} UPDATE EventAttendee SET status =
  (SELECT p.after FROM planned_updates p WHERE p.id IS EventAttendee.id AND p.userId IS EventAttendee.userId)
  WHERE eventId IS (SELECT eventId FROM params) AND EXISTS(SELECT 1 FROM planned_updates p
    WHERE p.id IS EventAttendee.id AND p.userId IS EventAttendee.userId AND p.before IS EventAttendee.status)`;
const attendeeUpdateAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = (SELECT COUNT(*) FROM planned_updates) AND ${exactUpdates}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const ticketDeleteSql = `WITH input AS (SELECT ?4 AS data) DELETE FROM EventWaitlist WHERE eventId IS ?2
  AND id IN (SELECT value FROM json_each((SELECT data FROM input), '$.deleted'))`;
const ticketDeleteAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = json_array_length((SELECT data FROM input), '$.deleted') AND ${exactDeleted}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const noticeInsertSql = `WITH ${batchCtes} INSERT INTO Notification (id, userId, type, content, targetType, targetId, isRead, createdAt)
  SELECT id, userId, 'EVENT', '${noticeContent}', 'EVENT', (SELECT eventId FROM params), 0, ?14 FROM planned_notices`;
const noticeInsertAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = (SELECT COUNT(*) FROM planned_notices) AND ${exactNotices}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const afterCtes = `${batchCtes}, ${eventCtes},
  after_context AS (SELECT ${contextFields.map(field => `json_extract((SELECT data FROM input), '$.after.context.${field}') AS "${field}"`).join(', ')}),
  after_attendees AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.status') AS status FROM json_each((SELECT data FROM input), '$.after.attendees') j)`;
const finalSql = `WITH ${afterCtes} SELECT CASE WHEN EXISTS(SELECT 1 FROM context c CROSS JOIN after_context e
  WHERE ${contextFields.map(field => `c."${field}" IS e."${field}"`).join(' AND ')})
  AND NOT EXISTS(SELECT 1 FROM actual_queue)
  AND ${sameSet('actual_attendees', 'after_attendees', ['id', 'userId', 'status'])}
  AND (${exactEvent}) AND (${exactInserts}) AND (${exactUpdates}) AND (${exactDeleted}) AND (${exactNotices})
  AND (${promotionUsersLive}) THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
function batchSql(p: Plan) {
  const sql = [preguardSql], mutations: number[] = [];
  const add = (write: string, assertion: string) => { mutations.push(sql.length); sql.push(write, assertion); };
  add(eventWriteSql, eventAssertSql);
  if (p.inserts.length) add(attendeeInsertSql, attendeeInsertAssertSql);
  if (p.updates.length) add(attendeeUpdateSql, attendeeUpdateAssertSql);
  if (p.deleted.length) add(ticketDeleteSql, ticketDeleteAssertSql);
  if (p.notices.length) add(noticeInsertSql, noticeInsertAssertSql);
  sql.push(finalSql);
  if (sql.length > 12) throw new Error('Unexpected D1 Event update batch topology');
  return { sql, mutations };
}
function manifest(p: Plan) {
  return boundedJson({ before: { context: p.before.context, queue: p.before.queue, attendees: p.before.attendees },
    after: p.after, inserts: p.inserts, updates: p.updates, deleted: p.deleted, notices: p.notices });
}
function changedRelevantFacts(a: Snapshot, b: Snapshot) {
  if (!sameContext(a.context, b.context)) return true;
  // A time-dependent switch in read scope is not primary-fact evidence.
  return a.scan === b.scan && boundedJson({ queue: a.queue, attendees: a.attendees }) !== boundedJson({ queue: b.queue, attendees: b.attendees });
}
function response(input: EventInput, eventId: string, capacity: number | null): UpdatedEvent {
  const event: UpdatedEvent = { ...input, id: eventId, maxAttendees: capacity };
  const zoned = DateTime.fromJSDate(event.date, { zone: 'utc' }).setZone(event.timezone);
  const date = zoned.toISO();
  if (!zoned.isValid || date === null) throw new Error('Invalid D1 Event update response datetime');
  const dto = { id: event.id, title: event.title, date, description: event.description, location: event.location,
    startTime: event.startTime || '', endTime: event.endTime || '', category: event.category || '', timezone: event.timezone, maxAttendees: capacity };
  // Native transport/serialization bound, independent of the route's 256-KiB
  // body limit and the unrelated 200-KB queue-row safeguard.
  boundedJson(dto);
  return event;
}

/** <=2 read stages + <=12 batch statements per attempt, <=2 attempts.
 * Each attempt starts with primary authority; the following read is rechecked
 * by the actual atomic batch guard, not claimed as an independent primary read.
 * plus the unchanged session reader's <=2 auth statements: <=30 submitted SQL
 * statements. No local tests, explicit transaction, queue chunks or readback. */
export async function updateD1Event(eventId: string, userId: string, input: EventInput): Promise<UpdatedEvent> {
  text(eventId, 1499999); text(userId, 1499999);
  if (input.maxAttendees !== undefined && input.maxAttendees !== null) integer(input.maxAttendees, 1, MAX_TICKET);
  const eventMs = input.date.getTime();
  if (!Number.isFinite(eventMs)) throw new Error('Invalid D1 Event update datetime');
  const date = input.date.toISOString().replace(/Z$/, '+00:00');
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  const values = (capacity: number | null, scan = false, data: string | null = null): Scalar[] => [
    userId, eventId, scan ? 1 : 0, data, input.title, date, input.description, input.location,
    input.startTime, input.endTime, input.category, input.timezone, capacity, now, input.maxAttendees === undefined ? 1 : 0,
  ];
  let previous: Snapshot | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // first-primary applies to the handle's first query, so a proven rollback
    // starts the next attempt with a new primary-constrained session.
    const db = database();
    // This fresh authority check also owns 401/403/404 precedence after a
    // proved first-guard rollback, before considering retry evidence.
    const context = await readAuthority(db, values(input.maxAttendees ?? null));
    const capacity = context.maxAttendees as number | null;
    // New-value transport checks follow current authority/Event/capacity domain
    // errors, and precede every DML. They never validate overwritten old prose.
    for (const field of ['title', 'description', 'location', 'startTime', 'endTime', 'category', 'timezone'] as const) text(input[field], 1499999);
    jsonBytes({ id: eventId, title: input.title, date, description: input.description, location: input.location,
      startTime: input.startTime, endTime: input.endTime, category: input.category, timezone: input.timezone, updatedAt: now });
    const event = response(input, eventId, capacity);
    // One promotion-entry clock, immediately before complete prefix planning.
    // The new parsed start is used; no admission/end/commit-time clock fence.
    const promotion = Date.now();
    const scan = eventMs > promotion && (capacity === null || (context.attendeeCount as number) < capacity);
    const snapshot = await readPrefix(db, values(capacity, scan), scan);
    if (!sameContext(context, snapshot.context)) throw conflict();
    if (previous && !changedRelevantFacts(previous, snapshot)) throw conflict();
    const planned = promotionPlan(snapshot, eventId, now);
    const batch = batchSql(planned);
    const statements = preparedBatch(db, batch.sql, values(capacity, scan, manifest(planned)));
    let results: unknown;
    try { results = await db.batch(statements); }
    catch (error) {
      if (sqlRollback(error, collisionMarker)) throw conflict();
      if (!sqlRollback(error, snapshotMarker)) throw new Error('D1 Event update native batch failed');
      if (attempt === 1) throw conflict();
      previous = snapshot;
      continue;
    }
    // Unknown commits/decoder failures cannot enter the retry path. All Event
    // response fields, dates, JSON and actual binding/wire bytes were checked.
    committed(results, batch.sql.length, batch.mutations, true);
    return event;
  }
  throw conflict();
}
