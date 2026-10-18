import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { ParticipationError } from '@/lib/server/participation';

type Scalar = string | number | null;
type Status = 'REGISTERED' | 'CONFIRMED' | 'ATTENDED' | 'CANCELLED';
type State = {
  registrationState: Exclude<Status, 'CANCELLED'> | 'WAITLISTED' | 'NONE';
  isAttending: boolean; isWaitlisted: boolean; canCancelRsvp: boolean; canLeaveWaitlist: boolean;
  attendeeCount: number; waitlistCount: number; waitlistPosition: number | null;
  maxAttendees: number | null; registrationClosed: boolean;
};
const contextFields = ['authorized', 'found', 'date', 'maxAttendees', 'ownStatus', 'ownAttendeeCount',
  'ownQueueCount', 'ownTicket', 'ownPosition', 'attendeeCount', 'waitlistCount', 'dateFits', 'statusFits', 'capacityFits'] as const;
type Context = Record<typeof contextFields[number], Scalar>;
type Ticket = { id: number; userId: string; userExists: number; prefix: number };
type Attendee = { id: string; userId: string; status: Status };
type Snapshot = { context: Context; queue: Ticket[]; attendees: Attendee[]; scan: boolean; detailed: boolean };
// Ticket INTEGER PRIMARY KEY and AUTOINCREMENT/index/FK parity are inherited
// deployment-schema prerequisites; no inspection of unknown live DDL is claimed.
type Scope = { eventId: string; userId: string; mode: 'join' | 'leave'; allowWaitlist: boolean; now: string };
type Update = { id: string; userId: string; before: Status; after: Status };
type Notice = { id: string; userId: string };
type Plan = {
  before: Snapshot; after: { context: Context; queue: Ticket[]; attendees: Attendee[] };
  inserts: Attendee[]; updates: Update[]; deleted: number[]; notices: Notice[];
  append: boolean; created: boolean; full: boolean; leave: boolean; eventMs: number; state: State | null;
};
const ROW_BYTES = 200_000;
const RESULT_BYTES = 1_200_000;
const MANIFEST_BYTES = 1_400_000;
const BATCH_BYTES = 8_000_000;
const SQL_BYTES = 100_000;
const DATE_LIMIT = 8640000000000000;
const MAX_TICKET = 2147483647;
const snapshotMarker = 'D1_EVENT_PARTICIPATION_SNAPSHOT_CONFLICT';
const collisionMarker = 'D1_EVENT_PARTICIPATION_ID_COLLISION';
const invariantMarker = 'D1_EVENT_PARTICIPATION_WRITE_INVARIANT';
const failure = (marker: string) => `json_extract('[]', '${marker}')`;
const noticeContent = 'Ein Platz ist frei geworden. Du bist jetzt für das Event angemeldet.';
const conflict = () => new ParticipationError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
type Database = ReturnType<typeof database>;

/** Only fields actually consumed by RSVP are read. In particular, historical
 * timestamps, Event prose and User profiles/roles/test flags are not gates.
 * Oversized raw context values are suppressed before transport, after the
 * independent account/Event flags have been established. */
const contextCtes = `params AS (SELECT ?1 AS userId, ?2 AS eventId),
  actor AS (SELECT id FROM User WHERE id = (SELECT userId FROM params)),
  target AS (SELECT id, date, maxAttendees FROM Event
    WHERE id = (SELECT eventId FROM params) AND EXISTS(SELECT 1 FROM actor)),
  own_attendee AS (SELECT status FROM EventAttendee
    WHERE eventId = (SELECT id FROM target) AND userId = (SELECT userId FROM params)),
  own_queue AS (SELECT id FROM EventWaitlist
    WHERE eventId = (SELECT id FROM target) AND userId = (SELECT userId FROM params)),
  context AS (SELECT EXISTS(SELECT 1 FROM actor) AS authorized, EXISTS(SELECT 1 FROM target) AS found,
    (SELECT CASE WHEN length(CAST(date AS BLOB)) <= 1024 THEN date END FROM target) AS date,
    (SELECT CASE WHEN COALESCE(length(CAST(maxAttendees AS BLOB)), 0) <= 64 THEN maxAttendees END FROM target) AS maxAttendees,
    (SELECT CASE WHEN length(CAST(status AS BLOB)) <= 1024 THEN status END FROM own_attendee) AS ownStatus,
    (SELECT COUNT(*) FROM own_attendee) AS ownAttendeeCount,
    (SELECT COUNT(*) FROM own_queue) AS ownQueueCount, (SELECT MIN(id) FROM own_queue) AS ownTicket,
    (SELECT COUNT(*) FROM EventWaitlist WHERE eventId = (SELECT id FROM target)
      AND id <= (SELECT MIN(id) FROM own_queue)) AS ownPosition,
    (SELECT COUNT(*) FROM EventAttendee WHERE eventId = (SELECT id FROM target) AND status <> 'CANCELLED') AS attendeeCount,
    (SELECT COUNT(*) FROM EventWaitlist WHERE eventId = (SELECT id FROM target)) AS waitlistCount,
    NOT EXISTS(SELECT 1 FROM target WHERE typeof(date) NOT IN ('text', 'integer', 'real')
      OR length(CAST(date AS BLOB)) > 1024) AS dateFits,
    NOT EXISTS(SELECT 1 FROM own_attendee WHERE typeof(status) <> 'text'
      OR length(CAST(status AS BLOB)) > 1024) AS statusFits,
    NOT EXISTS(SELECT 1 FROM target WHERE typeof(maxAttendees) NOT IN ('integer', 'null')
      OR COALESCE(length(CAST(maxAttendees AS BLOB)), 0) > 64) AS capacityFits)`;
const contextSql = `WITH ${contextCtes} SELECT * FROM context`;

/** Compute the entire source-consumed prefix without transporting unrelated
 * suffix identities. Only the earliest initially inactive ticket per User is
 * a successful candidate. Later repeats become active skips after that winner.
 * DELETE excludes every own ticket and subtracts its cancellable occupied seat
 * before ranking. There is no LIMIT or product-level queue/promotion cap. */
function prefixCtes(leave: string) {
  return `fifo_queue AS (SELECT q.id, q.userId,
      (SELECT a.status FROM EventAttendee a WHERE a.eventId = q.eventId AND a.userId = q.userId) AS status
    FROM EventWaitlist q WHERE q.eventId = (SELECT id FROM target)
      AND NOT (${leave} = 1 AND q.userId = (SELECT userId FROM params))),
    candidate_first AS (SELECT MIN(id) AS id FROM fifo_queue WHERE status IS NULL OR status = 'CANCELLED' GROUP BY userId),
    candidate_rank AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rank FROM candidate_first),
    seats AS (SELECT maxAttendees, attendeeCount - CASE WHEN ${leave} = 1
      AND ownStatus IS NOT NULL AND ownStatus <> 'CANCELLED' THEN 1 ELSE 0 END AS occupied FROM context),
    cutoff AS (SELECT CASE WHEN ?3 = 0 THEN NULL
      WHEN maxAttendees IS NULL THEN (SELECT MAX(id) FROM fifo_queue)
      WHEN occupied >= maxAttendees THEN NULL
      ELSE COALESCE((SELECT id FROM candidate_rank WHERE rank = maxAttendees - occupied),
        (SELECT MAX(id) FROM fifo_queue)) END AS id FROM seats)`;
}
const snapshotPrefixCtes = prefixCtes('?4');
const snapshotSql = `WITH ${contextCtes}, ${snapshotPrefixCtes},
  queue_scope AS (SELECT q.id, q.userId,
      EXISTS(SELECT 1 FROM User u WHERE u.id = q.userId) AS userExists,
      (q.id <= (SELECT id FROM cutoff) AND NOT (?4 = 1 AND q.userId = (SELECT userId FROM params))) AS prefix
    FROM EventWaitlist q WHERE q.eventId = (SELECT id FROM target)
      AND (q.id <= (SELECT id FROM cutoff) OR q.userId = (SELECT userId FROM params))),
  attendee_scope AS (SELECT a.id, a.userId, a.status FROM EventAttendee a
    WHERE a.eventId = (SELECT id FROM target) AND (a.userId = (SELECT userId FROM params)
      OR EXISTS(SELECT 1 FROM queue_scope q WHERE q.prefix = 1 AND q.userId = a.userId))),
  records AS (SELECT 'queue' AS kind, id, userId, NULL AS status, userExists, COALESCE(prefix, 0) AS prefix FROM queue_scope
    UNION ALL SELECT 'attendee', id, userId, status, NULL, NULL FROM attendee_scope),
  sizes AS (SELECT COALESCE(length(CAST(id AS BLOB)), 0) + COALESCE(length(CAST(userId AS BLOB)), 0)
      + COALESCE(length(CAST(status AS BLOB)), 0) + 32 AS bytes,
      (typeof(id) IN ('text', 'integer') AND typeof(userId) = 'text'
        AND typeof(status) IN ('text', 'null')) AS typed FROM records),
  budget AS (SELECT (COALESCE(MIN(typed), 1) = 1 AND COALESCE(MAX(bytes), 0) <= ${ROW_BYTES}
    AND COALESCE(SUM(6 * bytes + 1024), 0) + 16384 <= ${RESULT_BYTES}) AS fits FROM sizes)
  SELECT 'context' AS kind, NULL AS id, NULL AS userId, NULL AS status, NULL AS userExists, NULL AS prefix,
    (SELECT fits FROM budget) AS fits, ${contextFields.map(field => `c."${field}"`).join(', ')} FROM context c
  UNION ALL SELECT r.kind, r.id, r.userId, r.status, r.userExists, r.prefix, NULL,
    ${contextFields.map(() => 'NULL').join(', ')} FROM records r CROSS JOIN budget b WHERE b.fits = 1`;

function keys(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length ||
      fields.some(field => !Object.hasOwn(value, field))) throw new Error('Invalid D1 Event row');
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid D1 Event integer');
  }
}
function text(value: unknown, maximum = ROW_BYTES): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum) throw new Error('Invalid D1 Event text');
}
function bit(value: unknown): asserts value is 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 Event bit');
}
function status(value: unknown): asserts value is Status {
  if (!['REGISTERED', 'CONFIRMED', 'ATTENDED', 'CANCELLED'].includes(value as string)) throw new Error('Invalid D1 Event status');
}
/** Same bounded absolute normalizer as the reviewed native content paths.
 * Numeric zero/fractional milliseconds and SQLite's UTC default remain valid;
 * no SQL parser or derived julianday(stored-date) is used for admission. */
function storedDate(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < -DATE_LIMIT || value > DATE_LIMIT) throw new Error('Invalid D1 Event numeric date');
    const result = new Date(value).getTime();
    if (!Number.isFinite(result)) throw new Error('Invalid D1 Event date');
    return result;
  }
  text(value, 1024);
  if (!value.length) throw new Error('Invalid D1 Event date');
  const dateOnly = /^\d{4}-\d\d-\d\d$/.exec(value);
  let normalized: string;
  if (dateOnly && dateOnly[0] === value) normalized = `${value}T00:00:00Z`;
  else {
    const absolute = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(value);
    if (!absolute || absolute[0] !== value || value.includes('\0')) throw new Error('Invalid D1 Event date');
    normalized = value.replace(' ', 'T');
    if (absolute[1] === undefined) normalized += 'Z';
    else if (absolute[1] !== 'Z' && absolute[1].length === 3) normalized += ':00';
  }
  const result = new Date(normalized).getTime();
  if (!Number.isFinite(result)) throw new Error('Invalid D1 Event date');
  return result;
}
function authorize(c: Context) {
  bit(c.authorized); bit(c.found);
  if (c.authorized !== 1) throw new ParticipationError('Unauthorized', 401);
  if (c.found !== 1) throw new ParticipationError('Event not found', 404);
  integer(c.ownAttendeeCount);
  if (c.ownAttendeeCount > 1) throw new Error('Ambiguous raw D1 Event attendee pair');
  bit(c.statusFits);
  if (c.statusFits !== 1) throw new Error('Oversized D1 Event own status');
  if (c.ownAttendeeCount === 0) {
    if (c.ownStatus !== null) throw new Error('Unexpected D1 Event own status');
  } else status(c.ownStatus);
}
function validateContext(c: Context) {
  authorize(c);
  bit(c.dateFits);
  if (c.dateFits !== 1) throw new Error('Oversized D1 Event date');
  storedDate(c.date);
  bit(c.capacityFits);
  if (c.capacityFits !== 1) throw new Error('Invalid D1 Event capacity storage');
  if (c.maxAttendees !== null) integer(c.maxAttendees, 1, MAX_TICKET);
  for (const field of ['ownQueueCount', 'ownPosition', 'attendeeCount', 'waitlistCount'] as const) integer(c[field]);
  if ((c.ownQueueCount as number) > (c.waitlistCount as number) || (c.ownPosition as number) > (c.waitlistCount as number)) {
    throw new Error('Inconsistent D1 Event queue counts');
  }
  // An active own attendee does not consume the own queue ID. In particular,
  // its replay must not acquire a new legacy-ticket validation barrier.
  if (c.ownQueueCount === 0) {
    if (c.ownTicket !== null || c.ownPosition !== 0) throw new Error('Unexpected D1 Event ticket');
  }
}
function project(c: Context, registrationClosed: boolean): State {
  validateContext(c);
  const active = c.ownStatus !== null && c.ownStatus !== 'CANCELLED';
  const queued = !active && c.ownQueueCount !== 0;
  if (queued) {
    // The source findUnique has no ordering contract for a broken own unique
    // pair. Do not invent one. Foreign repeated owners still work in FIFO.
    if (c.ownQueueCount !== 1) throw new Error('Ambiguous raw D1 Event own queue pair');
    integer(c.ownTicket, 1, MAX_TICKET); integer(c.ownPosition, 1);
  }
  return {
    registrationState: active ? c.ownStatus as Exclude<Status, 'CANCELLED'> : queued ? 'WAITLISTED' : 'NONE',
    isAttending: active, isWaitlisted: queued,
    canCancelRsvp: c.ownStatus === 'REGISTERED' || c.ownStatus === 'CONFIRMED', canLeaveWaitlist: queued,
    attendeeCount: c.attendeeCount as number, waitlistCount: c.waitlistCount as number,
    waitlistPosition: queued ? c.ownPosition as number : null, maxAttendees: c.maxAttendees as number | null,
    registrationClosed,
  };
}
function contextFrom(value: unknown): Context {
  keys(value, contextFields);
  if (Object.values(value).some(item => item !== null && typeof item !== 'string' &&
      (typeof item !== 'number' || !Number.isFinite(item)))) throw new Error('Invalid D1 Event context scalar');
  return value as Context;
}
async function readContext(db: Database, scope: Pick<Scope, 'userId' | 'eventId'>): Promise<Context> {
  const result = await prepare(db, contextSql, [scope.userId, scope.eventId]).all();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) throw new Error('Incomplete D1 Event context');
  return contextFrom(result.results[0]);
}
async function readSnapshot(db: Database, scope: Scope, scan: boolean): Promise<Snapshot> {
  const result = await prepare(db, snapshotSql, [scope.userId, scope.eventId, scan ? 1 : 0, scope.mode === 'leave' ? 1 : 0]).all();
  if (result.success !== true || !Array.isArray(result.results)) throw new Error('Incomplete D1 Event snapshot');
  const fields = ['kind', 'id', 'userId', 'status', 'userExists', 'prefix', 'fits', ...contextFields];
  const contexts = result.results.filter(row => row && row.kind === 'context');
  if (contexts.length !== 1) throw new Error('Missing D1 Event context');
  const row = contexts[0]; keys(row, fields);
  const context = contextFrom(Object.fromEntries(contextFields.map(field => [field, row[field]])));
  authorize(context);
  if (row.id !== null || row.userId !== null || row.status !== null || row.userExists !== null || row.prefix !== null || row.fits !== 1) {
    throw new Error('D1 Event snapshot exceeds safe transport bounds');
  }
  validateContext(context);
  const queue: Ticket[] = [], attendees: Attendee[] = [];
  const ticketIds = new Set<number>(), attendeeIds = new Set<string>(), attendeeUsers = new Set<string>();
  let bytes = 16384;
  for (const item of result.results) {
    keys(item, fields);
    if (item.kind === 'context') continue;
    if (item.fits !== null || contextFields.some(field => item[field] !== null)) throw new Error('Unscoped D1 Event row');
    text(item.userId);
    const rawBytes = Buffer.byteLength(item.userId, 'utf8') + (typeof item.id === 'string' ? Buffer.byteLength(item.id, 'utf8') : 32)
      + (typeof item.status === 'string' ? Buffer.byteLength(item.status, 'utf8') : 0) + 32;
    bytes += 6 * rawBytes + 1024;
    if (rawBytes > ROW_BYTES || bytes > RESULT_BYTES) throw new Error('Oversized D1 Event snapshot');
    if (item.kind === 'queue') {
      integer(item.id, 1, MAX_TICKET); bit(item.userExists); bit(item.prefix);
      if (item.status !== null || ticketIds.has(item.id) || (item.prefix === 0 && item.userId !== scope.userId)) throw new Error('Invalid D1 Event ticket set');
      ticketIds.add(item.id); queue.push({ id: item.id, userId: item.userId, userExists: item.userExists, prefix: item.prefix });
    } else if (item.kind === 'attendee') {
      text(item.id); status(item.status);
      if (item.userExists !== null || item.prefix !== null || attendeeIds.has(item.id) || attendeeUsers.has(item.userId)) throw new Error('Ambiguous D1 Event attendee set');
      attendeeIds.add(item.id); attendeeUsers.add(item.userId);
      attendees.push({ id: item.id, userId: item.userId, status: item.status });
    } else throw new Error('Unknown D1 Event snapshot row');
  }
  queue.sort((a, b) => a.id - b.id); attendees.sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  if (queue.filter(q => q.userId === scope.userId).length !== context.ownQueueCount ||
      attendees.some(a => a.userId !== scope.userId && !queue.some(q => q.prefix === 1 && q.userId === a.userId)) ||
      attendees.filter(a => a.userId === scope.userId).length !== context.ownAttendeeCount) throw new Error('Incomplete D1 Event relevant sets');
  return { context, queue, attendees, scan, detailed: true };
}

// Exact escaped string/manifest size is checked before JSON allocation/binding.
function jsonStringBytes(value: string) {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
  }
  return bytes;
}
function jsonBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === 'string') return jsonStringBytes(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid D1 Event JSON number');
    return String(value).length;
  }
  if (typeof value === 'boolean') return value ? 4 : 5;
  let bytes: number;
  if (Array.isArray(value)) {
    bytes = 2 + Math.max(0, value.length - 1);
    for (const item of value) { bytes += jsonBytes(item); if (bytes > MANIFEST_BYTES) throw new Error('Oversized D1 Event manifest'); }
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value); bytes = 2 + Math.max(0, entries.length - 1);
    for (const [key, item] of entries) { bytes += jsonStringBytes(key) + 1 + jsonBytes(item); if (bytes > MANIFEST_BYTES) throw new Error('Oversized D1 Event manifest'); }
  } else throw new Error('Invalid D1 Event JSON value');
  if (bytes > MANIFEST_BYTES) throw new Error('Oversized D1 Event manifest');
  return bytes;
}
function boundedJson(value: unknown) {
  const bytes = jsonBytes(value);
  if (bytes > MANIFEST_BYTES) throw new Error('Oversized D1 Event manifest');
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result, 'utf8') !== bytes) throw new Error('Invalid D1 Event manifest size');
  return result;
}
function bindingPlan(sql: string, values: readonly Scalar[]) {
  const binds: Scalar[] = [];
  const emitted = sql.replace(/\?(\d+)/g, (_token, number: string) => {
    const index = Number(number) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new Error('Invalid D1 Event SQL slot');
    const value = values[index];
    if (value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid D1 Event binding');
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 1500000) throw new Error('Oversized D1 Event binding');
    binds.push(value); return '?';
  });
  if (Buffer.byteLength(emitted, 'utf8') >= SQL_BYTES || binds.length > 100) throw new Error('Unsafe D1 Event statement');
  return { sql: emitted, values: binds };
}
function prepare(db: Database, sql: string, values: readonly Scalar[]) {
  const plan = bindingPlan(sql, values);
  return db.prepare(plan.sql).bind(...plan.values);
}
function preparedBatch(db: Database, sql: string[], values: readonly Scalar[]) {
  const plans = sql.map(query => bindingPlan(query, values));
  let wireBytes = 2;
  for (const plan of plans) {
    wireBytes += jsonStringBytes(plan.sql) + 128 + 2 + Math.max(0, plan.values.length - 1);
    for (const value of plan.values) wireBytes += value === null ? 4 : typeof value === 'string' ? jsonStringBytes(value) : String(value).length;
    if (wireBytes > BATCH_BYTES) throw new Error('D1 Event batch exceeds safe wire bounds');
  }
  return plans.map(plan => db.prepare(plan.sql).bind(...plan.values));
}

function sameContext(a: Context, b: Context) { return contextFields.every(field => a[field] === b[field]); }
function plan(scope: Scope, before: Snapshot, promote: boolean): Plan {
  const c = before.context;
  validateContext(c);
  const eventMs = storedDate(c.date);
  const current = new Map(before.attendees.map(a => [a.userId, { ...a }]));
  const initial = new Map(before.attendees.map(a => [a.userId, a]));
  const deleted = new Set<number>();
  const notices: Notice[] = [];
  let count = c.attendeeCount as number;
  const setRegistered = (userId: string) => {
    const old = current.get(userId);
    if (old) old.status = 'REGISTERED';
    else current.set(userId, { id: randomUUID(), userId, status: 'REGISTERED' });
  };
  if (scope.mode === 'leave') {
    for (const ticket of before.queue) if (ticket.userId === scope.userId) deleted.add(ticket.id);
    const own = current.get(scope.userId);
    if (own && own.status !== 'CANCELLED') { own.status = 'CANCELLED'; count--; }
  }
  if (promote) {
    for (const ticket of before.queue) {
      if (deleted.has(ticket.id) || ticket.prefix !== 1) continue;
      if (c.maxAttendees !== null && count >= (c.maxAttendees as number)) break;
      deleted.add(ticket.id);
      const old = current.get(ticket.userId);
      if (old && old.status !== 'CANCELLED') continue;
      if (ticket.userExists !== 1) throw new Error('Missing promoted D1 Event User');
      setRegistered(ticket.userId);
      notices.push({ id: `event-waitlist-${ticket.id}`, userId: ticket.userId });
      count++;
    }
  }
  if (before.queue.some(ticket => ticket.prefix === 1 && !deleted.has(ticket.id))) throw new Error('Incomplete D1 Event consumed prefix');
  let append = false, created = false, full = false;
  const ownActive = c.ownStatus !== null && c.ownStatus !== 'CANCELLED';
  if (scope.mode === 'join' && !ownActive && c.ownQueueCount === 0) {
    if (c.maxAttendees !== null && count >= (c.maxAttendees as number)) {
      if (scope.allowWaitlist) { append = true; created = true; }
      else full = true;
    } else { setRegistered(scope.userId); count++; created = true; }
  }
  const queue = before.queue.filter(ticket => !deleted.has(ticket.id));
  const ownQueue = queue.filter(ticket => ticket.userId === scope.userId);
  const own = current.get(scope.userId);
  const ownStatus = own?.status ?? c.ownStatus;
  const waitlistCount = (c.waitlistCount as number) - deleted.size + (append ? 1 : 0);
  const ownTicket = append ? null : ownQueue[0]?.id ?? (before.detailed ? null : c.ownTicket);
  const ownQueueCount = append ? 1 : before.detailed ? ownQueue.length : c.ownQueueCount as number;
  // ownState never reads a queue position while attending. A later raw own
  // duplicate can have a different minimum after promotion, so do not derive
  // its ignored position from the former minimum or introduce a negative gate.
  const ownPosition = ownStatus !== null && ownStatus !== 'CANCELLED' ? 0
    : append ? waitlistCount : ownTicket === null ? 0
    : (c.ownPosition as number) - before.queue.filter(ticket => deleted.has(ticket.id) && ticket.id <= (ownTicket as number)).length;
  const afterContext: Context = { ...c, ownStatus, ownAttendeeCount: own ? 1 : c.ownAttendeeCount,
    attendeeCount: count, waitlistCount, ownQueueCount, ownTicket, ownPosition };
  // The generated ticket ID is deliberately unknown here. Its tail position is
  // proved inside the batch; this harmless placeholder is never bound as an ID.
  const dtoContext = append ? { ...afterContext, ownTicket: 1 } : afterContext;
  const state = full ? null : project(dtoContext, false);
  if (state && jsonBytes(state) + 256 > RESULT_BYTES) throw new Error('Oversized D1 Event DTO');
  const inserts = [...current.values()].filter(a => !initial.has(a.userId));
  const updates = [...current.values()].flatMap(a => {
    const old = initial.get(a.userId);
    return old && old.status !== a.status ? [{ id: a.id, userId: a.userId, before: old.status, after: a.status }] : [];
  });
  if (new Set(inserts.map(a => a.id)).size !== inserts.length || new Set(notices.map(n => n.id)).size !== notices.length) throw conflict();
  for (const a of inserts) { text(a.id); text(a.userId); status(a.status); }
  for (const n of notices) { text(n.id); text(n.userId); }
  if (Buffer.byteLength(scope.now, 'utf8') + Buffer.byteLength(scope.userId, 'utf8') + Buffer.byteLength(scope.eventId, 'utf8') + 128 > ROW_BYTES ||
      inserts.some(a => Buffer.byteLength(a.id, 'utf8') + Buffer.byteLength(a.userId, 'utf8') + Buffer.byteLength(scope.eventId, 'utf8') + 64 > ROW_BYTES) ||
      notices.some(n => Buffer.byteLength(n.id, 'utf8') + Buffer.byteLength(n.userId, 'utf8') + Buffer.byteLength(scope.eventId, 'utf8') + Buffer.byteLength(noticeContent, 'utf8') + 256 > ROW_BYTES)) {
    throw new Error('Oversized D1 Event write row');
  }
  return { before, after: { context: afterContext, queue, attendees: [...current.values()] },
    inserts, updates, deleted: [...deleted], notices, append, created, full, leave: scope.mode === 'leave', eventMs, state };
}

/** Every batch uses the same six raw slots. The JSON cell is data, never SQL.
 * Set cardinality plus both anti-joins prove multiplicity/additions/removals.
 * Final relevant attendees are selected using the BEFORE cohort, so a consumed
 * owner's attendee cannot disappear from the final assertion with its ticket. */
const batchPrefixCtes = prefixCtes("json_extract((SELECT data FROM input), '$.leave')");
const batchCtes = `${contextCtes}, input AS (SELECT ?4 AS data), ${batchPrefixCtes},
  expected_context AS (SELECT ${contextFields.map(field => `json_extract((SELECT data FROM input), '$.before.context.${field}') AS "${field}"`).join(', ')}),
  expected_queue AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.userExists') AS userExists, json_extract(j.value, '$.prefix') AS prefix
    FROM json_each((SELECT data FROM input), '$.before.queue') j),
  expected_attendees AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.status') AS status FROM json_each((SELECT data FROM input), '$.before.attendees') j),
  actual_queue AS (SELECT q.id, q.userId, EXISTS(SELECT 1 FROM User u WHERE u.id = q.userId) AS userExists,
      CASE WHEN q.id <= (SELECT MAX(id) FROM expected_queue WHERE prefix = 1)
        AND NOT (json_extract((SELECT data FROM input), '$.leave') = 1 AND q.userId = (SELECT userId FROM params)) THEN 1 ELSE 0 END AS prefix
    FROM EventWaitlist q WHERE q.eventId = (SELECT id FROM target)
      AND json_extract((SELECT data FROM input), '$.detailed') = 1
      AND (q.id <= (SELECT MAX(id) FROM expected_queue WHERE prefix = 1) OR q.userId = (SELECT userId FROM params))),
  actual_attendees AS (SELECT a.id, a.userId, a.status FROM EventAttendee a
    WHERE a.eventId = (SELECT id FROM target) AND json_extract((SELECT data FROM input), '$.detailed') = 1
      AND (a.userId = (SELECT userId FROM params)
      OR EXISTS(SELECT 1 FROM expected_queue q WHERE q.prefix = 1 AND q.userId = a.userId))),
  planned_inserts AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.status') AS status FROM json_each((SELECT data FROM input), '$.inserts') j),
  planned_updates AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.before') AS before, json_extract(j.value, '$.after') AS after FROM json_each((SELECT data FROM input), '$.updates') j),
  planned_notices AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId
    FROM json_each((SELECT data FROM input), '$.notices') j)`;
const beforeMatches = `(SELECT id FROM cutoff) IS (SELECT MAX(id) FROM expected_queue WHERE prefix = 1)
  AND ${contextFields.map(field => `c."${field}" IS e."${field}"`).join(' AND ')}
  AND (SELECT COUNT(*) FROM actual_queue) = (SELECT COUNT(*) FROM expected_queue)
  AND NOT EXISTS(SELECT 1 FROM actual_queue a WHERE NOT EXISTS(SELECT 1 FROM expected_queue e
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.userExists IS e.userExists AND a.prefix IS e.prefix))
  AND NOT EXISTS(SELECT 1 FROM expected_queue e WHERE NOT EXISTS(SELECT 1 FROM actual_queue a
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.userExists IS e.userExists AND a.prefix IS e.prefix))
  AND (SELECT COUNT(*) FROM actual_attendees) = (SELECT COUNT(*) FROM expected_attendees)
  AND NOT EXISTS(SELECT 1 FROM actual_attendees a WHERE NOT EXISTS(SELECT 1 FROM expected_attendees e
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.status IS e.status))
  AND NOT EXISTS(SELECT 1 FROM expected_attendees e WHERE NOT EXISTS(SELECT 1 FROM actual_attendees a
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.status IS e.status))`;
const collisions = `EXISTS(SELECT 1 FROM planned_inserts p JOIN EventAttendee a
    ON a.id = p.id OR (a.eventId = (SELECT eventId FROM params) AND a.userId = p.userId))
  OR EXISTS(SELECT 1 FROM planned_notices p JOIN Notification n ON n.id = p.id)`;
const promotionUsersLive = `NOT EXISTS(SELECT 1 FROM planned_notices p
  WHERE NOT EXISTS(SELECT 1 FROM User u WHERE u.id = p.userId))`;
const preguardSql = `WITH ${batchCtes}
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM context c CROSS JOIN expected_context e WHERE ${beforeMatches})
      THEN ${failure(snapshotMarker)}
    WHEN ${collisions} THEN ${failure(collisionMarker)}
    WHEN NOT (${promotionUsersLive}) THEN ${failure(invariantMarker)}
    ELSE 1 END AS guarded`;
const exactEvent = `EXISTS(SELECT 1 FROM User WHERE id = ?1)
  AND EXISTS(SELECT 1 FROM Event WHERE id = ?2 AND typeof(updatedAt) = 'text' AND updatedAt IS ?5
    AND date IS (SELECT date FROM context) AND maxAttendees IS (SELECT maxAttendees FROM context))`;
const exactInserts = `NOT EXISTS(SELECT 1 FROM planned_inserts p WHERE
  (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id AND a.eventId IS ?2 AND a.userId IS p.userId AND a.status IS p.status) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.eventId IS ?2 AND a.userId IS p.userId) <> 1)`;
const exactUpdates = `NOT EXISTS(SELECT 1 FROM planned_updates p WHERE
  (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id AND a.eventId IS ?2 AND a.userId IS p.userId AND a.status IS p.after) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.id IS p.id) <> 1
  OR (SELECT COUNT(*) FROM EventAttendee a WHERE a.eventId IS ?2 AND a.userId IS p.userId) <> 1)`;
const exactNotices = `NOT EXISTS(SELECT 1 FROM planned_notices p WHERE
  (SELECT COUNT(*) FROM Notification n WHERE n.id IS p.id AND n.userId IS p.userId
    AND n.type IS 'EVENT' AND n.content IS '${noticeContent}' AND n.targetType IS 'EVENT' AND n.targetId IS ?2
    AND typeof(n.isRead) = 'integer' AND n.isRead IS 0 AND typeof(n.createdAt) = 'text' AND n.createdAt IS ?5) <> 1
  OR (SELECT COUNT(*) FROM Notification n WHERE n.id IS p.id) <> 1)`;
const exactDeleted = `NOT EXISTS(SELECT 1 FROM EventWaitlist q
  WHERE q.eventId IS ?2 AND q.id IN (SELECT value FROM json_each((SELECT data FROM input), '$.deleted')))`;
/** Real source AUTOINCREMENT DDL is a prerequisite, not a newly proved live
 * schema claim. Last DML is always the genuine caller INSERT. No explicit ticket
 * ID, sequence prediction/reset or queue ticket resurrection is possible here. */
const exactGenerated = `typeof(last_insert_rowid()) = 'integer' AND last_insert_rowid() BETWEEN 1 AND ${MAX_TICKET}
  AND (SELECT COUNT(*) FROM EventWaitlist q WHERE q.id IS last_insert_rowid() AND q.eventId IS ?2
    AND q.userId IS ?1 AND typeof(q.createdAt) = 'text' AND q.createdAt IS ?5) = 1
  AND (SELECT COUNT(*) FROM EventWaitlist q WHERE q.id IS last_insert_rowid()) = 1
  AND (SELECT COUNT(*) FROM EventWaitlist q WHERE q.eventId IS ?2 AND q.userId IS ?1) = 1
  AND NOT EXISTS(SELECT 1 FROM EventWaitlist q WHERE q.eventId IS ?2 AND q.id <> last_insert_rowid() AND q.id >= last_insert_rowid())
  AND NOT EXISTS(SELECT 1 FROM expected_queue q WHERE q.id >= last_insert_rowid())`;
const eventWriteSql = `UPDATE Event SET updatedAt = ?5 WHERE id = ?2`;
const eventAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = 1 AND ${exactEvent}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const attendeeInsertSql = `WITH ${batchCtes} INSERT INTO EventAttendee (id, eventId, userId, status)
  SELECT id, ?2, userId, status FROM planned_inserts`;
const attendeeInsertAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = (SELECT COUNT(*) FROM planned_inserts) AND ${exactInserts}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const attendeeUpdateSql = `WITH ${batchCtes} UPDATE EventAttendee SET status =
  (SELECT p.after FROM planned_updates p WHERE p.id IS EventAttendee.id AND p.userId IS EventAttendee.userId)
  WHERE eventId IS ?2 AND EXISTS(SELECT 1 FROM planned_updates p
    WHERE p.id IS EventAttendee.id AND p.userId IS EventAttendee.userId AND p.before IS EventAttendee.status)`;
const attendeeUpdateAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = (SELECT COUNT(*) FROM planned_updates) AND ${exactUpdates}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const ticketDeleteSql = `WITH input AS (SELECT ?4 AS data) DELETE FROM EventWaitlist
  WHERE eventId IS ?2 AND id IN (SELECT value FROM json_each((SELECT data FROM input), '$.deleted'))`;
const ticketDeleteAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = json_array_length((SELECT data FROM input), '$.deleted') AND ${exactDeleted}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const noticeInsertSql = `WITH ${batchCtes} INSERT INTO Notification (id, userId, type, content, targetType, targetId, isRead, createdAt)
  SELECT id, userId, 'EVENT', '${noticeContent}', 'EVENT', ?2, 0, ?5 FROM planned_notices`;
const noticeInsertAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = (SELECT COUNT(*) FROM planned_notices) AND ${exactNotices}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
const ticketInsertSql = `INSERT INTO EventWaitlist (eventId, userId, createdAt) VALUES (?2, ?1, ?5)`;
const ticketInsertAssertSql = `WITH ${batchCtes} SELECT CASE WHEN changes() = 1 AND ${exactGenerated}
  THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;

const afterCtes = `${batchCtes},
  after_context AS (SELECT ${contextFields.map(field => `json_extract((SELECT data FROM input), '$.after.context.${field}') AS "${field}"`).join(', ')}),
  after_queue AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.userExists') AS userExists, json_extract(j.value, '$.prefix') AS prefix
    FROM json_each((SELECT data FROM input), '$.after.queue') j),
  after_attendees AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.userId') AS userId,
    json_extract(j.value, '$.status') AS status FROM json_each((SELECT data FROM input), '$.after.attendees') j),
  operation AS (SELECT json_extract(data, '$.append') AS append FROM input)`;
const afterMatches = `${contextFields.filter(field => field !== 'ownTicket' && field !== 'ownPosition').map(field => `c."${field}" IS e."${field}"`).join(' AND ')}
  AND (o.append = 1 OR c.ownTicket IS e.ownTicket)
  AND ((c.ownStatus IS NOT NULL AND c.ownStatus <> 'CANCELLED') OR c.ownPosition IS e.ownPosition)
  AND (SELECT COUNT(*) FROM actual_queue) = (SELECT COUNT(*) FROM after_queue) + o.append
  AND NOT EXISTS(SELECT 1 FROM actual_queue a WHERE NOT EXISTS(SELECT 1 FROM after_queue e
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.userExists IS e.userExists AND a.prefix IS e.prefix)
    AND NOT (o.append = 1 AND a.id IS last_insert_rowid() AND a.userId IS ?1 AND a.userExists = 1))
  AND NOT EXISTS(SELECT 1 FROM after_queue e WHERE NOT EXISTS(SELECT 1 FROM actual_queue a
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.userExists IS e.userExists AND a.prefix IS e.prefix))
  AND (SELECT COUNT(*) FROM actual_attendees) = (SELECT COUNT(*) FROM after_attendees)
  AND NOT EXISTS(SELECT 1 FROM actual_attendees a WHERE NOT EXISTS(SELECT 1 FROM after_attendees e
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.status IS e.status))
  AND NOT EXISTS(SELECT 1 FROM after_attendees e WHERE NOT EXISTS(SELECT 1 FROM actual_attendees a
    WHERE a.id IS e.id AND a.userId IS e.userId AND a.status IS e.status))
  AND (${exactEvent}) AND (${exactInserts}) AND (${exactUpdates}) AND (${exactNotices}) AND (${exactDeleted})
  AND (${promotionUsersLive}) AND (o.append = 0 OR (${exactGenerated}))`;
// SQLite 'now' is stable within one step. Only the current UTC clock is parsed;
// stored Event.date was normalized in JS. C is genuinely after all DML, and is
// allowed to cross the Event date without rolling back successful admission.
const currentClock = `CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)`;
const validClock = `typeof(k.nowMs) = 'integer' AND k.nowMs BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT}
  AND typeof(?6) IN ('integer', 'real') AND ?6 BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT}
  AND (?6 <= k.nowMs) IN (0, 1)`;
function finalSql(full: boolean) {
  if (full) return `WITH ${afterCtes} SELECT CASE
    WHEN EXISTS(SELECT 1 FROM context c CROSS JOIN after_context e CROSS JOIN operation o WHERE ${afterMatches})
    THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
  return `WITH ${afterCtes}, clock AS (SELECT ${currentClock} AS nowMs)
    SELECT CASE WHEN (${validClock}) AND EXISTS(SELECT 1 FROM context c CROSS JOIN after_context e CROSS JOIN operation o WHERE ${afterMatches})
      THEN 1 ELSE ${failure(invariantMarker)} END AS guarded, (?6 <= k.nowMs) AS registrationClosed FROM clock k`;
}
function batchSql(p: Plan) {
  const sql = [preguardSql], mutations: number[] = [];
  const add = (write: string, assertion: string) => { mutations.push(sql.length); sql.push(write, assertion); };
  add(eventWriteSql, eventAssertSql);
  if (p.inserts.length) add(attendeeInsertSql, attendeeInsertAssertSql);
  if (p.updates.length) add(attendeeUpdateSql, attendeeUpdateAssertSql);
  if (p.deleted.length) add(ticketDeleteSql, ticketDeleteAssertSql);
  if (p.notices.length) add(noticeInsertSql, noticeInsertAssertSql);
  if (p.append) add(ticketInsertSql, ticketInsertAssertSql);
  sql.push(finalSql(p.full));
  if (sql.length > 14) throw new Error('Unexpected D1 Event batch topology');
  return { sql, mutations };
}
function manifest(p: Plan) {
  return boundedJson({ before: { context: p.before.context, queue: p.before.queue, attendees: p.before.attendees },
    detailed: p.before.detailed ? 1 : 0, leave: p.leave ? 1 : 0, after: p.after, inserts: p.inserts, updates: p.updates, deleted: p.deleted, notices: p.notices, append: p.append ? 1 : 0 });
}

/** Only our SQL-qualified FIRST guard proves a known rollback. Whole bounded
 * cause-chain denial wins over every marker. Foreign/native constraints, CAS,
 * final invariants, transport and uncertain commit never retry or map to409. */
function sqlRollback(error: unknown, marker: string) {
  const details: string[] = [], seen = new Set<unknown>();
  let current = error, total = 0;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return false;
      seen.add(current);
      if (typeof current === 'string') {
        if (current.length > 65536 || (total += current.length) > 262144) return false;
        details.push(current); break;
      }
      if (typeof current !== 'object') return false;
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code']) if (field in record) {
        const value = record[field];
        if (typeof value !== 'string' || value.length > 65536 || (total += value.length) > 262144) return false;
        if (field === 'code' && !['D1_ERROR', 'SQLITE_ERROR'].includes(value)) return false;
        if (field === 'name' && !['Error', 'D1Error', 'D1_ERROR', 'SqliteError'].includes(value)) return false;
        details.push(value);
      }
      current = 'cause' in record ? record.cause : null;
    }
  } catch { return false; }
  if (details.some(value => /D1_[A-Z0-9_]*INVARIANT|\binvariant\b|constraint|\bunique\b|foreign[_\s-]*key|not[_\s-]*null|primary[_\s-]*key|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|cancel|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|\bRPC\b|\bHTTP\b|\bTLS\b|\bSSL\b|\bDNS\b|disconnect|broken pipe|unexpected token|invalid response|syntax error|no such (?:table|column|function)|datatype mismatch|out of memory|\bBUSY\b|\blocked\b/i.test(value))) return false;
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? []).some(value => !['D1_ERROR', marker].includes(value)))) return false;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? []).some(value => value !== 'SQLITE_ERROR'))) return false;
  const qualified = new RegExp(`\\b(?:D1_ERROR|SQLITE_ERROR)\\b[^\\n]*\\b${marker}\\b|\\b${marker}\\b[^\\n]*\\b(?:D1_ERROR|SQLITE_ERROR)\\b`);
  return details.some(value => qualified.test(value));
}
function committed(results: unknown, count: number, mutations: number[], full: boolean): boolean {
  if (!Array.isArray(results) || results.length !== count || results.some(result => !result || typeof result !== 'object' ||
      result.success !== true || !Array.isArray(result.results))) throw new Error('Incomplete D1 Event batch');
  const guard = (index: number) => {
    const rows = results[index].results;
    if (rows.length !== 1) throw new Error('Missing D1 Event assertion');
    keys(rows[0], ['guarded']);
    if (rows[0].guarded !== 1) throw new Error('Invalid D1 Event assertion');
  };
  guard(0);
  for (const index of mutations) {
    if (results[index].results.length !== 0) throw new Error('Unexpected D1 Event write projection');
    guard(index + 1);
  }
  const rows = results[count - 1].results;
  if (rows.length !== 1) throw new Error('Missing D1 Event final assertion');
  keys(rows[0], full ? ['guarded'] : ['guarded', 'registrationClosed']);
  if (rows[0].guarded !== 1) throw new Error('Invalid D1 Event final assertion');
  if (full) return false;
  bit(rows[0].registrationClosed);
  return rows[0].registrationClosed === 1;
}
function early(scope: Scope, c: Context) {
  authorize(c);
  // ATTENDED is a source early domain error, before irrelevant date/queue data.
  if (scope.mode === 'leave' && c.ownStatus === 'ATTENDED') throw new ParticipationError('Recorded attendance cannot be cancelled', 409);
  validateContext(c);
  if (scope.mode === 'join') {
    if (c.ownStatus !== null && c.ownStatus !== 'CANCELLED') return { replay: true, promote: false };
    const admission = Date.now(); // A: after context/own-state, before promotion entry.
    if (storedDate(c.date) <= admission) {
      if (c.ownQueueCount !== 0) return { replay: true, promote: false };
      throw new ParticipationError('Registration for this event has closed', 409);
    }
  }
  return { replay: false, promote: true };
}
function rawFacts(s: Snapshot) {
  return boundedJson({ context: s.context, queue: s.queue, attendees: s.attendees, detailed: s.detailed, scan: s.scan });
}
async function mutate(scope: Scope): Promise<{ state: State; created: boolean }> {
  const db = database();
  let previous: Snapshot | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const context = await readContext(db, scope);
    const branch = early(scope, context);
    let snapshot: Snapshot, promote = false;
    if (branch.replay) snapshot = { context, queue: [], attendees: [], scan: false, detailed: false };
    else {
      // B is sampled immediately before this complete queue/prefix snapshot
      // read. The decision is retained for the whole loop/batch; no later
      // clock fence can suppress a valid promotion or fresh direct join.
      const promotion = Date.now();
      promote = storedDate(context.date) > promotion;
      const occupiedAfterLeave = (context.attendeeCount as number) -
        (scope.mode === 'leave' && context.ownStatus !== null && context.ownStatus !== 'CANCELLED' ? 1 : 0);
      const scan = promote && (context.maxAttendees === null || occupiedAfterLeave < (context.maxAttendees as number));
      snapshot = await readSnapshot(db, scope, scan);
      if (!sameContext(context, snapshot.context)) throw conflict();
      promote = scan;
    }
    // A change in time/read shape alone is never retry evidence. When a full
    // FIFO cohort was needed previously, require it again for comparison.
    if (previous && (!sameContext(previous.context, snapshot.context) ||
        (previous.detailed === snapshot.detailed && previous.scan === snapshot.scan && rawFacts(previous) !== rawFacts(snapshot)))) {
      // A genuinely changed authorized relevant snapshot permits attempt two.
    } else if (previous) throw conflict();
    const planned = plan(scope, snapshot, promote);
    const batch = batchSql(planned);
    const statements = preparedBatch(db, batch.sql, [scope.userId, scope.eventId, snapshot.scan ? 1 : 0,
      manifest(planned), scope.now, planned.eventMs]);
    let results: unknown;
    try { results = await db.batch(statements); }
    catch (error) {
      if (sqlRollback(error, collisionMarker)) throw conflict();
      if (!sqlRollback(error, snapshotMarker)) throw new Error('D1 Event native batch failed', { cause: error });
      if (attempt === 1) throw conflict();
      previous = snapshot;
      continue;
    }
    // Decoder, dynamic C and the committed FULL sentinel are outside retry.
    const registrationClosed = committed(results, batch.sql.length, batch.mutations, planned.full);
    if (planned.full) throw new ParticipationError('Event is full', 409);
    if (!planned.state) throw new Error('Missing D1 Event prepared state');
    return { state: { ...planned.state, registrationClosed }, created: planned.created };
  }
  throw conflict();
}
function input(eventId: string, userId: string) {
  text(eventId, 1499999); text(userId, 1499999);
}
/** One first-primary SELECT, no callback transaction, mutation, retry or readback.
 * GET's C is sampled by SQL and compared to a JS-normalized absolute epoch in
 * the same statement through a bounded raw-date projection. */
export async function readD1EventParticipation(eventId: string, userId: string): Promise<State> {
  input(eventId, userId);
  const db = database();
  // Normalize the raw date after the one snapshot. The clock value belongs to
  // that SELECT; no second query or post-read side effect is introduced.
  const sql = `WITH ${contextCtes}, clock AS (SELECT ${currentClock} AS nowMs)
    SELECT c.*, k.nowMs FROM context c CROSS JOIN clock k`;
  const result = await prepare(db, sql, [userId, eventId]).all();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) throw new Error('Incomplete D1 Event read');
  const row = result.results[0]; keys(row, [...contextFields, 'nowMs']);
  const c = contextFrom(Object.fromEntries(contextFields.map(field => [field, row[field]])));
  authorize(c); validateContext(c);
  integer(row.nowMs, -DATE_LIMIT, DATE_LIMIT);
  return project(c, storedDate(c.date) <= row.nowMs);
}
/** <=2 staged reads + <=14 batch statements, at most two attempts, plus the
 * unchanged route's <=2 authentication reads = <=34 submitted statements.
 * Live AUTOINCREMENT/index/FK/trigger parity and positive production mutation
 * QA remain deployment prerequisites/limitations, not claims of this helper. */
export async function joinD1Event(eventId: string, userId: string, allowWaitlist: boolean) {
  input(eventId, userId);
  if (typeof allowWaitlist !== 'boolean') throw new Error('Invalid D1 Event waitlist choice');
  return mutate({ eventId, userId, mode: 'join', allowWaitlist, now: new Date().toISOString().replace(/Z$/, '+00:00') });
}
export async function leaveD1Event(eventId: string, userId: string): Promise<State> {
  input(eventId, userId);
  const result = await mutate({ eventId, userId, mode: 'leave', allowWaitlist: false, now: new Date().toISOString().replace(/Z$/, '+00:00') });
  return result.state;
}

// Pure shared FIFO/transport/rollback/result primitives for native admin PUT.
// Existing RSVP execution and SQL remain unchanged above this export list.
export {
  prefixCtes, noticeContent, failure, keys, integer, text, bit, status,
  jsonBytes, boundedJson, prepare, preparedBatch, sqlRollback, committed,
};
