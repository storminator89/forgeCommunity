import 'server-only';

import { env } from 'cloudflare:workers';
import { PracticeError } from '@/lib/server/formative-practice';
import { practiceObjectiveOf, samePracticeObjective, type PracticeObjective, isPracticeRetentionHealthy, projectPracticeSelection, PRACTICE_SESSION_LIMIT } from '@/lib/formative-practice-availability';

type SnapshotItem = {
  objective?: PracticeObjective;
  itemId: string; itemRevision: number; objectiveTitle: string;
  prompt: string; options: string[]; correctIndex: number; explanation: string;
};
type Snapshot = { id: string; coursePublicationId: string; payload: string; itemCount: number };
const ID = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_POOL_BYTES = 1024 * 1024;
const MAX_FIELD_BYTES = 1024;
const MAX_ROW_BYTES = 1900 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_DATE_MS = 8640000000000000;

type Row = {
  previousItemId: string | null; previousItemRevision: number | null; previousCorrect: number | null;
  previousConfidence: string | null; previousOptionIndex: number | null;
  kind: 'context' | 'schedule' | 'recent' | 'sessionItem' | 'pending';
  courseExists: number | null; accountExists: number | null; enrolled: number | null;
  hasPublication: number | null; hasSnapshot: number | null; everPublished: number | null;
  publicationId: string | null; snapshotId: string | null; itemCount: number | null;
  optedIn: number | null; paused: number | null; nowMs: number | null; retentionAtMs: number | null;
  metadataOversize: number | null; poolOversize: number | null; poolInvalid: number | null;
  contextOversize: number | null; oversize: number | null;
  scheduleOverflow: number | null; sessionItemsOverflow: number | null; sessionClockInvalid: number | null;
  sessionId: string | null; answeredCount: number | null; pendingReservationId: string | null;
  pendingExists: number | null; pendingInPool: number | null;
  id: string | null; itemId: string | null; itemRevision: number | null;
  dueAtMs: number | null; shownAtMs: number | null; ordinal: number | null; payload: string | null;
};
type Column = Exclude<keyof Row, 'kind'>;
const columns: Column[] = ['courseExists', 'accountExists', 'enrolled', 'hasPublication', 'hasSnapshot', 'everPublished',
  'publicationId', 'snapshotId', 'itemCount', 'optedIn', 'paused', 'nowMs', 'retentionAtMs',
  'metadataOversize', 'poolOversize', 'poolInvalid', 'contextOversize', 'oversize', 'scheduleOverflow',
  'sessionItemsOverflow', 'sessionClockInvalid', 'sessionId', 'answeredCount', 'pendingReservationId',
  'pendingExists', 'pendingInPool', 'id', 'itemId', 'itemRevision', 'dueAtMs', 'shownAtMs', 'ordinal', 'payload',
  'previousItemId', 'previousItemRevision', 'previousCorrect', 'previousConfidence', 'previousOptionIndex'];
function selectRow(kind: Row['kind'], fields: Partial<Record<Column, string>>) {
  return `SELECT '${kind}' AS kind, ${columns.map(key => `${fields[key] ?? 'NULL'} AS "${key}"`).join(', ')}`;
}
function byteSum(fields: string[]) {
  return fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)), 0)`).join(' + ') || '0';
}
function rowCost(fields: string[]) {
  // Raw row size and the sixfold JSON-escaping bound are separate limits.
  return `2048 + (${byteSum(fields)}) AS rawBytes, 2048 + 6 * (${byteSum(fields)}) AS responseBytes`;
}
function fieldsOversize(fields: string[]) {
  return fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)), 0) > ${MAX_FIELD_BYTES}`).join(' OR ') || '0';
}

/** SQLite numeric dates are JS milliseconds. SQLite parses bare ISO dates as
 * UTC; only UTC text suffixes are accepted here, never the host timezone.
 * Validate the text shape before julianday. Convert whole UTC seconds first,
 * then truncate fractional seconds to JS milliseconds without SQLite rounding
 * a sub-millisecond fraction into another millisecond. Numeric dates use JS
 * Date's TimeClip range. */
function milliseconds(field: string) {
  const length = `length(${field})`;
  const fraction = (suffixLength: number) => `substr(${field}, 21, ${length} - ${20 + suffixLength})`;
  const fractionDigits = `CASE WHEN substr(${field}, -1) = 'Z' THEN ${fraction(1)}
    WHEN substr(${field}, -6) = '+00:00' THEN ${fraction(6)} ELSE ${fraction(0)} END`;
  return `CASE WHEN typeof(${field}) IN ('integer', 'real') THEN
      CASE WHEN ${field} BETWEEN -${MAX_DATE_MS} AND ${MAX_DATE_MS} THEN CAST(${field} AS INTEGER) END
    WHEN typeof(${field}) = 'text' AND ${length} BETWEEN 19 AND 35
      AND instr(CAST(${field} AS BLOB), x'00') = 0
      -- D1 caps each LIKE/GLOB pattern at 50 bytes, including literal classes.
      AND substr(${field}, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND substr(${field}, 11, 1) IN ('T', ' ')
      AND substr(${field}, 12, 8) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      AND strftime('%Y-%m-%d %H:%M:%S', julianday(substr(${field}, 1, 19)))
        = replace(substr(${field}, 1, 19), 'T', ' ')
      AND (substr(${field}, 20) IN ('', 'Z', '+00:00') OR (substr(${field}, 20, 1) = '.' AND (
        (${length} BETWEEN 21 AND 29 AND ${fraction(0)} NOT GLOB '*[^0-9]*')
        OR (${length} BETWEEN 22 AND 30 AND substr(${field}, -1) = 'Z' AND ${fraction(1)} NOT GLOB '*[^0-9]*')
        OR (${length} BETWEEN 27 AND 35 AND substr(${field}, -6) = '+00:00' AND ${fraction(6)} NOT GLOB '*[^0-9]*'))))
    THEN ROUND((julianday(substr(${field}, 1, 19)) - 2440587.5) * 86400000)
      + CASE WHEN substr(${field}, 20, 1) = '.'
        THEN CAST(substr((${fractionDigits}) || '000', 1, 3) AS INTEGER) ELSE 0 END END`;
}

// One statement is the entire read snapshot. Materialized, shallow shared
// inputs avoid repeatedly expanding an authorization/payload CTE per arm.
// Workerd permits five compound SELECT terms: both compounds below have five.
const snapshotSql = `WITH
  clock AS MATERIALIZED (SELECT ROUND((julianday('now') - 2440587.5) * 86400000) AS nowMs),
  course_row AS MATERIALIZED (SELECT id, activePublicationId FROM Course WHERE id = ?2),
  authority AS MATERIALIZED (
    SELECT EXISTS (SELECT 1 FROM course_row) AS courseExists,
      EXISTS (SELECT 1 FROM User WHERE id = ?1) AS accountExists,
      EXISTS (SELECT 1 FROM Enrollment WHERE userId = ?1 AND courseId = ?2) AS enrolled
  ), authorized AS MATERIALIZED (
    SELECT c.activePublicationId FROM course_row c, authority a WHERE a.accountExists AND a.enrolled
  ), pool_meta AS MATERIALIZED (
    SELECT p.id, p.itemCount, length(CAST(p.payload AS BLOB)) AS payloadBytes
    FROM PracticeSnapshot p, authorized a
    WHERE p.courseId = ?2 AND p.coursePublicationId = a.activePublicationId
    ORDER BY p.sequence DESC LIMIT 1
  ), lazy_state AS MATERIALIZED (
    SELECT clock.nowMs, a.*, c.activePublicationId AS publicationId, p.id AS snapshotId, p.itemCount, p.payloadBytes,
      CASE WHEN c.activePublicationId IS NOT NULL AND p.id IS NULL
        THEN EXISTS (SELECT 1 FROM PracticeSnapshot WHERE courseId = ?2) ELSE 0 END AS everPublished,
      COALESCE(setting.optedIn, 0) AS optedIn, COALESCE(setting.paused, 0) AS paused,
      ${milliseconds('health.lastSuccessAt')} AS retentionAtMs
    FROM clock CROSS JOIN authority a LEFT JOIN authorized c ON 1 LEFT JOIN pool_meta p ON 1
    LEFT JOIN PracticeLearnerSetting setting ON setting.userId = ?1 AND setting.courseId = ?2
      AND a.accountExists AND a.enrolled AND a.courseExists
    LEFT JOIN PracticeRetentionHealth health ON health.id = 'learner' AND p.id IS NOT NULL
      AND setting.optedIn AND NOT setting.paused
  ), read_gate AS MATERIALIZED (
    SELECT s.*, (s.snapshotId IS NOT NULL AND s.optedIn AND NOT s.paused
      AND s.retentionAtMs BETWEEN s.nowMs - 2700000 AND s.nowMs + 300000) AS enabled
    FROM lazy_state s
  ), pool_payload AS MATERIALIZED (
    SELECT p.payload, g.itemCount FROM PracticeSnapshot p, read_gate g
    WHERE g.enabled AND g.payloadBytes <= ${MAX_POOL_BYTES} AND p.id = g.snapshotId AND p.courseId = ?2
  ), pool_shape AS MATERIALIZED (
    SELECT p.*, CASE WHEN json_valid(p.payload) THEN CASE
      WHEN json_type(p.payload) = 'object' AND json_type(p.payload, '$.items') = 'array' THEN
        json_array_length(p.payload, '$.items') BETWEEN 1 AND 100
        AND json_array_length(p.payload, '$.items') = p.itemCount
      ELSE 0 END ELSE 0 END AS shapeValid FROM pool_payload p
  ), pool_items AS MATERIALIZED (
    SELECT CASE WHEN j.type = 'object' THEN json_extract(j.value, '$.itemId') END AS itemId,
      CASE WHEN j.type = 'object' THEN json_extract(j.value, '$.itemRevision') END AS itemRevision
    FROM pool_shape p, json_each(CASE WHEN p.shapeValid THEN p.payload ELSE '{"items":[]}' END, '$.items') j
  ), latest_active AS MATERIALIZED (
    SELECT s.id, s.snapshotId, s.answeredCount, s.pendingReservationId,
      ${milliseconds('s.createdAt')} AS createdAtMs
    FROM PracticeLearnerSession s, read_gate g
    WHERE g.enabled AND s.userId = ?1 AND s.courseId = ?2 AND s.status = 'ACTIVE'
    -- A corrupt clock must fail closed rather than resurrect another session.
    ORDER BY createdAtMs IS NULL DESC, createdAtMs DESC, s.id DESC LIMIT 1
  ), current_session AS MATERIALIZED (
    SELECT s.* FROM latest_active s, read_gate g WHERE s.snapshotId = g.snapshotId
  ), schedule_page AS MATERIALIZED (
    SELECT s.itemId, s.itemRevision, ${milliseconds('s.dueAt')} AS dueAtMs
    FROM PracticeLearnerSchedule s, read_gate g
    WHERE g.enabled AND s.userId = ?1 AND s.courseId = ?2 AND s.snapshotId = g.snapshotId
      AND EXISTS (SELECT 1 FROM pool_items p WHERE p.itemId = s.itemId)
    -- Keep mismatched revisions: the pure projection deliberately excludes them.
    ORDER BY s.itemId LIMIT 101
  ), recent_page AS MATERIALIZED (
    SELECT r.itemId, ${milliseconds('r.shownAt')} AS shownAtMs
    FROM PracticeLearnerReservation r JOIN PracticeLearnerSession s ON s.id = r.sessionId
    JOIN read_gate g ON g.enabled AND s.snapshotId = g.snapshotId
    WHERE s.userId = ?1 AND s.courseId = ?2
      AND ${milliseconds('r.shownAt')} >= g.nowMs - 86400000
    ORDER BY shownAtMs DESC, r.id DESC LIMIT 2
  ), session_item_page AS MATERIALIZED (
    SELECT r.itemId FROM PracticeLearnerReservation r JOIN current_session s ON s.id = r.sessionId
    ORDER BY r.ordinal, r.id LIMIT ${PRACTICE_SESSION_LIMIT + 1}
  ), pending_proof AS MATERIALIZED (
    SELECT r.id, r.sessionId, r.ordinal, r.itemId, r.itemRevision,
      EXISTS (SELECT 1 FROM pool_items p WHERE p.itemId = r.itemId AND p.itemRevision = r.itemRevision) AS inPool
    FROM current_session s JOIN PracticeLearnerReservation r
      ON r.id = s.pendingReservationId AND r.sessionId = s.id
  ), previous_answer_page AS MATERIALIZED (
    -- At most two rows: ambiguity omits the optional explanation. The exact
    -- predecessor is scoped to this current, authorized, pinned session.
    SELECT r.itemId,
      CASE WHEN typeof(r.itemRevision) = 'integer' AND r.itemRevision BETWEEN 1 AND 9007199254740991 THEN r.itemRevision END AS itemRevision,
      CASE WHEN typeof(a.correct) = 'integer' AND a.correct IN (0, 1) THEN a.correct END AS correct,
      a.confidence,
      CASE WHEN typeof(a.optionIndex) = 'integer' AND a.optionIndex BETWEEN 0 AND 7 THEN a.optionIndex END AS optionIndex
    FROM pending_proof p JOIN current_session s ON s.id = p.sessionId
    JOIN PracticeLearnerReservation r ON r.sessionId = s.id AND r.ordinal = p.ordinal - 1
    JOIN PracticeLearnerAnswer a ON a.reservationId = r.id
    WHERE p.inPool AND p.ordinal = s.answeredCount + 1 AND p.ordinal BETWEEN 2 AND ${PRACTICE_SESSION_LIMIT}
    ORDER BY r.id, a.id LIMIT 2
  ), pending_context AS MATERIALIZED (
    SELECT p.*, a.itemId AS previousItemId, a.itemRevision AS previousItemRevision,
      a.correct AS previousCorrect, a.confidence AS previousConfidence, a.optionIndex AS previousOptionIndex
    FROM pending_proof p LEFT JOIN previous_answer_page a ON (SELECT COUNT(*) FROM previous_answer_page) = 1
  ), context_cost AS MATERIALIZED (
    SELECT ${rowCost(['g.publicationId', 'g.snapshotId', 'p.payload', 's.id', 's.pendingReservationId'])},
      (${fieldsOversize(['g.publicationId', 'g.snapshotId', 's.id', 's.pendingReservationId'])}) AS fieldOversize
    FROM read_gate g LEFT JOIN pool_shape p ON p.shapeValid LEFT JOIN current_session s ON 1
  ), costs AS MATERIALIZED (
    SELECT rawBytes, responseBytes, fieldOversize FROM context_cost
    UNION ALL SELECT ${rowCost(['itemId'])}, (${fieldsOversize(['itemId'])}) FROM schedule_page
    UNION ALL SELECT ${rowCost(['itemId'])}, (${fieldsOversize(['itemId'])}) FROM recent_page
    UNION ALL SELECT ${rowCost(['itemId'])}, (${fieldsOversize(['itemId'])}) FROM session_item_page
    UNION ALL SELECT ${rowCost(['id', 'sessionId', 'itemId', 'previousItemId', 'previousConfidence'])}, (${fieldsOversize(['id', 'sessionId', 'itemId', 'previousItemId', 'previousConfidence'])})
      FROM pending_context WHERE inPool
  ), budget AS MATERIALIZED (
    SELECT (${fieldsOversize(['g.publicationId', 'g.snapshotId'])}) AS metadataOversize,
      (g.enabled AND g.payloadBytes > ${MAX_POOL_BYTES}) AS poolOversize,
      EXISTS (SELECT 1 FROM pool_shape WHERE NOT shapeValid) AS poolInvalid,
      EXISTS (SELECT 1 FROM context_cost WHERE fieldOversize OR rawBytes > ${MAX_ROW_BYTES}
        OR responseBytes > ${MAX_RESPONSE_BYTES}) AS contextOversize,
      (EXISTS (SELECT 1 FROM costs WHERE fieldOversize OR rawBytes > ${MAX_ROW_BYTES})
        OR (SELECT COALESCE(SUM(responseBytes), 0) FROM costs) > ${MAX_RESPONSE_BYTES}) AS oversize,
      (SELECT COUNT(*) FROM schedule_page) > 100 AS scheduleOverflow,
      (SELECT COUNT(*) FROM session_item_page) > ${PRACTICE_SESSION_LIMIT} AS sessionItemsOverflow
    FROM read_gate g
  )
  ${selectRow('context', {
    courseExists: 'g.courseExists', accountExists: 'g.accountExists', enrolled: 'g.enrolled',
    hasPublication: 'g.publicationId IS NOT NULL', hasSnapshot: 'g.snapshotId IS NOT NULL', everPublished: 'g.everPublished',
    publicationId: 'CASE WHEN NOT b.metadataOversize THEN g.publicationId END',
    snapshotId: 'CASE WHEN NOT b.metadataOversize THEN g.snapshotId END', itemCount: 'g.itemCount',
    optedIn: 'g.optedIn', paused: 'g.paused', nowMs: 'g.nowMs', retentionAtMs: 'g.retentionAtMs',
    metadataOversize: 'b.metadataOversize', poolOversize: 'b.poolOversize', poolInvalid: 'b.poolInvalid',
    contextOversize: 'b.contextOversize', oversize: 'b.oversize',
    scheduleOverflow: 'b.scheduleOverflow', sessionItemsOverflow: 'b.sessionItemsOverflow',
    sessionClockInvalid: 'EXISTS (SELECT 1 FROM latest_active WHERE createdAtMs IS NULL)',
    sessionId: 'CASE WHEN NOT b.contextOversize THEN s.id END',
    answeredCount: 'CASE WHEN NOT b.contextOversize THEN s.answeredCount END',
    pendingReservationId: 'CASE WHEN NOT b.contextOversize THEN s.pendingReservationId END',
    pendingExists: 'EXISTS (SELECT 1 FROM pending_proof)',
    pendingInPool: 'EXISTS (SELECT 1 FROM pending_proof WHERE inPool)',
    // If another arm overflows, this one bounded payload still allows the
    // original pool validation error to take precedence. All child arms stop.
    payload: 'CASE WHEN g.enabled AND NOT b.contextOversize AND p.shapeValid THEN p.payload END',
  })} FROM read_gate g CROSS JOIN budget b LEFT JOIN pool_shape p ON 1 LEFT JOIN current_session s ON 1
  UNION ALL ${selectRow('schedule', { itemId: 's.itemId', itemRevision: 's.itemRevision', dueAtMs: 's.dueAtMs' })}
    FROM schedule_page s, budget b WHERE NOT b.poolOversize AND NOT b.poolInvalid AND NOT b.oversize
      AND NOT b.scheduleOverflow AND NOT b.sessionItemsOverflow
  UNION ALL ${selectRow('recent', { itemId: 'r.itemId', shownAtMs: 'r.shownAtMs' })}
    FROM recent_page r, budget b WHERE NOT b.poolOversize AND NOT b.poolInvalid AND NOT b.oversize
      AND NOT b.scheduleOverflow AND NOT b.sessionItemsOverflow
  UNION ALL ${selectRow('sessionItem', { itemId: 's.itemId' })}
    FROM session_item_page s, budget b WHERE NOT b.poolOversize AND NOT b.poolInvalid AND NOT b.oversize
      AND NOT b.scheduleOverflow AND NOT b.sessionItemsOverflow
  UNION ALL ${selectRow('pending', { id: 'p.id', sessionId: 'p.sessionId', ordinal: 'p.ordinal', itemId: 'p.itemId', itemRevision: 'p.itemRevision',
    previousItemId: 'p.previousItemId', previousItemRevision: 'p.previousItemRevision', previousCorrect: 'p.previousCorrect',
    previousConfidence: 'p.previousConfidence', previousOptionIndex: 'p.previousOptionIndex' })}
    FROM pending_context p, budget b WHERE p.inPool AND NOT b.poolOversize AND NOT b.poolInvalid AND NOT b.oversize
      AND NOT b.scheduleOverflow AND NOT b.sessionItemsOverflow`;

// Deliberately copied from the mutation module. Its immutable pool validation
// and explicit public-item allowlist remain identical. Optional objective
// metadata is normalized identically for both private paths.
function itemsOf(snapshot: Snapshot): SnapshotItem[] {
  let payload: unknown;
  try { payload = JSON.parse(snapshot.payload); } catch { throw new PracticeError('Übungspool ist beschädigt.', 409); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PracticeError('Übungspool ist beschädigt.', 409);
  const parsed = payload as { schemaVersion?: unknown; coursePublicationId?: unknown; items?: unknown };
  if (parsed.schemaVersion !== 1 || parsed.coursePublicationId !== snapshot.coursePublicationId ||
      !Array.isArray(parsed.items) || parsed.items.length !== snapshot.itemCount || parsed.items.length < 1 || parsed.items.length > 100) {
    throw new PracticeError('Übungspool ist beschädigt.', 409);
  }
  const seen = new Set<string>();
  return parsed.items.map(value => {
    const item = value as SnapshotItem;
    if (!item || typeof item !== 'object' || !ID.test(item.itemId) ||
        !Number.isSafeInteger(item.itemRevision) || item.itemRevision < 1 ||
        !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 8 ||
        typeof item.prompt !== 'string' || typeof item.objectiveTitle !== 'string' ||
        typeof item.explanation !== 'string' || item.options.some(option => typeof option !== 'string') ||
        !Number.isSafeInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= item.options.length ||
        seen.has(item.itemId)) throw new PracticeError('Übungspool ist beschädigt.', 409);
    seen.add(item.itemId);
    return { ...item, objective: practiceObjectiveOf(value as { objectiveId?: unknown; objectiveRevision?: unknown }) };
  });
}

function publicItem(item: SnapshotItem) {
  return { itemId: item.itemId, itemRevision: item.itemRevision, objectiveTitle: item.objectiveTitle,
    prompt: item.prompt, options: item.options };
}

function storedId(value: string | null) {
  if (typeof value !== 'string' || !ID.test(value)) throw new PracticeError('Übungsdaten sind beschädigt.', 409);
  return value;
}
function integer(value: number | null, minimum = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new PracticeError('Übungsdaten sind beschädigt.', 409);
  }
  return value;
}
function date(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || Math.abs(value) > MAX_DATE_MS) {
    throw new PracticeError('Übungszeitpunkt ist beschädigt.', 409);
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new PracticeError('Übungszeitpunkt ist beschädigt.', 409);
  return result;
}

/** Native, read-only D1 replacement for this GET alone. No settings, retention,
 * reservations, sessions, evidence, signing or author revisions are mutated. */
export async function d1ReadLearnerPractice(courseId: string, userId: string) {
  if (typeof courseId !== 'string' || !ID.test(courseId)) throw new PracticeError('Kurs-ID ist ungültig.');
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  const result = await env.DB.withSession('first-primary').prepare(snapshotSql).bind(userId, courseId).all<Row>();
  if (!result.success) throw new Error('D1 learner practice snapshot failed.');
  const context = result.results.find(row => row.kind === 'context');
  if (!context) throw new Error('Missing D1 learner practice snapshot.');
  // Preserve course -> account/enrollment -> lazy state -> resource errors.
  if (!context.courseExists) throw new PracticeError('Kurs nicht gefunden.', 404);
  if (!context.accountExists || !context.enrolled) throw new PracticeError('Keine Kursteilnahme.', 403);
  const unavailable = { availability: 'unavailable' as const, dueCount: 0, nextAvailableAt: null };
  if (!context.hasPublication) return { status: 'unpublished', ...unavailable };
  if (!context.hasSnapshot) return { status: context.everPublished ? 'archived' : 'off', ...unavailable };
  if (context.metadataOversize) throw new PracticeError('Diese Übungsansicht ist zu groß.', 413);
  const base = { publicationId: storedId(context.publicationId), snapshotId: storedId(context.snapshotId) };
  if (!context.optedIn) return { ...base, status: 'available', availability: 'notOptedIn', dueCount: 0, nextAvailableAt: null };
  if (context.paused) return { ...base, status: 'paused', availability: 'paused', dueCount: 0, nextAvailableAt: null };
  const now = date(context.nowMs);
  const retentionAt = context.retentionAtMs === null ? null : date(context.retentionAtMs);
  if (!isPracticeRetentionHealthy(retentionAt, now)) return { ...base, status: 'unavailable', ...unavailable };
  if (context.poolOversize) throw new PracticeError('Diese Übungsansicht ist zu groß.', 413);
  if (context.poolInvalid) throw new PracticeError('Übungspool ist beschädigt.', 409);
  if (context.contextOversize) throw new PracticeError('Diese Übungsansicht ist zu groß.', 413);
  if (typeof context.payload !== 'string') throw new PracticeError('Übungspool ist beschädigt.', 409);
  const items = itemsOf({ id: base.snapshotId, coursePublicationId: base.publicationId,
    payload: context.payload, itemCount: integer(context.itemCount, 1) });
  if (context.scheduleOverflow) throw new PracticeError('Zu viele Übungszeitpläne für diese Ansicht.', 413);
  if (context.sessionItemsOverflow) throw new PracticeError('Zu viele Sitzungsreservierungen für diese Ansicht.', 413);
  if (context.oversize) throw new PracticeError('Diese Übungsansicht ist zu groß.', 413);
  if (context.sessionClockInvalid) throw new PracticeError('Übungszeitpunkt ist beschädigt.', 409);
  const input = {
    items,
    states: result.results.filter(row => row.kind === 'schedule').map(row => ({ itemId: storedId(row.itemId),
      itemRevision: integer(row.itemRevision, 1), dueAt: date(row.dueAtMs) })),
    recent: result.results.filter(row => row.kind === 'recent').map(row => ({ itemId: storedId(row.itemId), shownAt: date(row.shownAtMs) })),
    sessionItemIds: result.results.filter(row => row.kind === 'sessionItem').map(row => storedId(row.itemId)),
    now,
  };
  const selection = projectPracticeSelection(input);
  if (context.sessionId !== null) {
    const sessionId = storedId(context.sessionId);
    const answeredCount = integer(context.answeredCount);
    let pending: { reservationId: string; ordinal: number; item: ReturnType<typeof publicItem>; questionContext?: 'sameObjectiveAfterConfidentError' } | undefined;
    if (context.pendingReservationId !== null) {
      if (!context.pendingExists) throw new PracticeError('Sitzungsreservierung ist beschädigt.', 409);
      if (!context.pendingInPool) throw new PracticeError('Übungsrevision ist nicht mehr in der Veröffentlichung.', 409);
      const reservation = result.results.find(row => row.kind === 'pending');
      if (!reservation || reservation.id !== context.pendingReservationId || reservation.sessionId !== sessionId) {
        throw new PracticeError('Sitzungsreservierung ist beschädigt.', 409);
      }
      const item = items.find(candidate => candidate.itemId === reservation.itemId && candidate.itemRevision === reservation.itemRevision);
      if (!item) throw new PracticeError('Übungsrevision ist nicht mehr in der Veröffentlichung.', 409);
      const previous = items.find(candidate => candidate.itemId === reservation.previousItemId
        && candidate.itemRevision === reservation.previousItemRevision);
      const previousOption = reservation.previousOptionIndex;
      // This proves a relationship, not the historical algorithm's reason.
      // No raw confidence, objective ID, previous answer or key leaves GET.
      const sameObjectiveAfterConfidentError = reservation.ordinal === answeredCount + 1
        && typeof reservation.ordinal === 'number' && reservation.ordinal >= 2 && reservation.ordinal <= PRACTICE_SESSION_LIMIT
        && previous && previous.itemId !== item.itemId && samePracticeObjective(previous.objective, item.objective)
        && reservation.previousCorrect === 0 && reservation.previousConfidence === 'SURE'
        && typeof previousOption === 'number' && Number.isSafeInteger(previousOption)
        && previousOption >= 0 && previousOption < previous.options.length && previousOption !== previous.correctIndex;
      pending = { reservationId: storedId(reservation.id), ordinal: integer(reservation.ordinal, 1), item: publicItem(item),
        ...(sameObjectiveAfterConfidentError && { questionContext: 'sameObjectiveAfterConfidentError' as const }) };
    }
    const remaining = Math.max(0, PRACTICE_SESSION_LIMIT - answeredCount - (pending ? 1 : 0));
    const dueCount = Math.min(remaining, selection.candidates.length);
    const availability = pending ? 'resume' : dueCount ? 'ready' : 'sessionComplete';
    const nextAvailableAt = pending || dueCount ? null
      : projectPracticeSelection({ ...input, sessionItemIds: [] }).nextAvailableAt;
    return { ...base, status: 'active', availability, dueCount, nextAvailableAt,
      session: { id: sessionId, answeredCount, ...(pending && { pending }) } };
  }
  const dueCount = Math.min(PRACTICE_SESSION_LIMIT, selection.candidates.length);
  return { ...base, status: dueCount ? 'ready' : 'complete', availability: dueCount ? 'ready' : 'waiting',
    dueCount, nextAvailableAt: dueCount ? null : selection.nextAvailableAt };
}
