import 'server-only';

import { env } from 'cloudflare:workers';
import { createHash, randomUUID } from 'node:crypto';
import type { D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import { PracticeError } from '@/lib/server/formative-practice';
import { choosePracticeCandidate, practiceObjectiveOf, type PracticeObjective, isPracticeRetentionHealthy, practiceReviewIntervalMs, projectPracticeSelection, PRACTICE_SESSION_LIMIT } from '@/lib/formative-practice-availability';

type Value = string | number | null;
type Row = Record<string, Value>;
type Kind = 'text' | 'nullableText' | 'number' | 'date' | 'nullableDate';
type Fields = Record<string, Kind>;
type Item = { objective?: PracticeObjective; itemId: string; itemRevision: number; objectiveTitle: string; prompt: string; options: string[]; correctIndex: number; explanation: string };
type Pool = { id: string; coursePublicationId: string; itemCount: number; payload: string; items: Item[] };
type Fact = { sql: string; args: Value[]; data: string };
function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  // Mutation requests use the primary even when their final batch is only
  // assertions (receipt/pending/no-op replay). A used session could read a
  // replica; sequential consistency alone cannot prove current revocation.
  return env.DB;
}
type Scope = {
  userId: string; courseId: string; sessionId: string; reservationId: string; submissionId: string;
  db: ReturnType<typeof database>; facts: Fact[]; guards: D1PreparedStatement[];
  writes: D1PreparedStatement[]; assertions: Set<D1PreparedStatement>; reads: number; nowMs: number; now: string;
};
const ID = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_POOL_BYTES = 1024 * 1024;
const MAX_FACT_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_DATE_MS = 8640000000000000;
const MAX_VERSION = 2147483645; // Leave room for the original answer + completion increments.
const MAX_STATEMENTS = 48;
const MAX_SQL_BYTES = 90_000;
const clockSql = "ROUND((julianday('now') - 2440587.5) * 86400000)";
// Invalid JSON paths throw with a specific SQL marker; malformed JSON alone
// never qualifies as a known rollback or authorizes another mutation.
const failure = "json_extract('[]', 'FORGE_PRACTICE_SNAPSHOT_CONFLICT')";
const writeFailure = "json_extract('[]', 'FORGE_PRACTICE_WRITE_FENCE')";
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
function fail(message = 'Übungszustand ist beschädigt oder zu groß.', status = 409): never { throw new PracticeError(message, status); }
function requireId(value: unknown, name: string) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${name} ist ungültig.`, 400);
  return value;
}
function text(value: Value | undefined) { if (typeof value !== 'string' || !value || bytes(value) > 1024) fail(); return value; }
function integer(value: Value | undefined, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}
function boolean(value: Value | undefined) { return integer(value, 0, 1) === 1; }
function date(value: Value | undefined) { return new Date(integer(value, -MAX_DATE_MS, MAX_DATE_MS)); }
function nullableText(value: Value | undefined) { return value === null ? null : text(value); }
const input = `WITH input(userId, courseId, sessionId, reservationId, submissionId) AS (VALUES (?1, ?2, ?3, ?4, ?5)),
  scope AS (SELECT c.id, c.activePublicationId FROM Course c, input i WHERE c.id = i.courseId
    AND EXISTS (SELECT 1 FROM User WHERE id = i.userId)
    AND EXISTS (SELECT 1 FROM Enrollment WHERE userId = i.userId AND courseId = i.courseId))`;
const own = "userId = (SELECT userId FROM input) AND courseId = (SELECT courseId FROM input) AND EXISTS (SELECT 1 FROM scope)";
const target = `SELECT * FROM PracticeLearnerSession WHERE ${own} AND id = (SELECT sessionId FROM input)`;
const currentPool = `SELECT p.* FROM PracticeSnapshot p, scope c WHERE p.courseId = c.id
  AND p.coursePublicationId = c.activePublicationId ORDER BY p.sequence DESC LIMIT 1`;
function args(s: Scope): Value[] { return [s.userId, s.courseId, s.sessionId, s.reservationId, s.submissionId]; }
function statement(s: Scope, sql: string, values: Value[] = []) {
  if (bytes(sql) > MAX_SQL_BYTES || values.length > 100) fail('Übungsabfrage überschreitet sichere Grenzen.', 503);
  return s.db.prepare(sql).bind(...values);
}
async function read<T>(s: Scope, sql: string, values: Value[]) {
  if (++s.reads >= MAX_STATEMENTS) fail('Übungsabfrage überschreitet sichere Grenzen.', 503);
  const result = await statement(s, sql, values).first<T>();
  if (!result) fail();
  return result;
}

// Same UTC/numeric date contract as the unchanged native reader.
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

/** Small independent read facts become one consistent snapshot only when every
 * fact is proved again BEFORE any write in the same atomic D1 batch. */
function factSql(source: string, fields: Fields, limit: number) {
  const entries = Object.entries(fields);
  if (entries.length > 14 || limit > 100) fail(); // json_object <= 30 arguments.
  const values = entries.map(([key, kind]) => {
    const column = `r."${key}"`;
    const nullable = kind === 'nullableText' || kind === 'nullableDate';
    const value = kind === 'date' || kind === 'nullableDate' ? milliseconds(column) : column;
    const valid = kind === 'number' ? `typeof(${column}) IN ('integer', 'real') AND length(CAST(${column} AS TEXT)) <= 35`
      : kind === 'date' || kind === 'nullableDate' ? `(${value}) IS NOT NULL`
      : `typeof(${column}) = 'text' AND length(CAST(${column} AS BLOB)) BETWEEN 1 AND 1024`;
    return { key, value, valid: nullable ? `(${column} IS NULL OR (${valid}))` : `(${valid})` };
  });
  const valid = values.map(value => value.valid).join(' AND ');
  const object = `json_object(${values.flatMap(value => [`'${value.key}'`, `CASE WHEN ${value.valid} THEN ${value.value} END`]).join(', ')}, 'invalid', CASE WHEN ${valid} THEN 0 ELSE 1 END)`;
  return `${input}, rows AS MATERIALIZED (SELECT * FROM (${source}) LIMIT ${limit + 1}),
    encoded AS MATERIALIZED (SELECT ${object} AS data FROM rows r),
    cost AS (SELECT count(*) AS n, COALESCE(sum(length(CAST(data AS BLOB))), 0) AS size FROM encoded)
    SELECT CASE WHEN n <= ${limit} AND size <= ${MAX_FACT_BYTES} THEN
      (SELECT json_group_array(json(data)) FROM encoded) ELSE '[]' END AS data,
      CASE WHEN n > ${limit} OR size > ${MAX_FACT_BYTES} THEN 1 ELSE 0 END AS oversized,
      ${clockSql} AS nowMs FROM cost`;
}
async function fact(s: Scope, source: string, fields: Fields, limit = 1) {
  const sql = factSql(source, fields, limit);
  const values = args(s);
  const result = await read<{ data: string; oversized: number; nowMs: number }>(s, sql, values);
  if (result.oversized !== 0 || typeof result.data !== 'string' || bytes(result.data) > MAX_FACT_BYTES) fail();
  let rows: Row[];
  try { rows = JSON.parse(result.data); } catch { fail(); }
  if (!Array.isArray(rows) || rows.length > limit || rows.some(row => !row || row.invalid !== 0)) fail();
  if (!s.nowMs) { s.nowMs = integer(result.nowMs, 1, MAX_DATE_MS); s.now = date(s.nowMs).toISOString(); }
  s.facts.push({ sql, args: values, data: result.data });
  return rows;
}
async function scope(courseId: string, userId: string, ids: Partial<Pick<Scope, 'sessionId' | 'reservationId' | 'submissionId'>> = {}) {
  requireId(courseId, 'Kurs-ID');
  // Session authority is unchanged: no new role, test-account or ID-regex gate.
  text(userId);
  const s: Scope = { userId, courseId, sessionId: '', reservationId: '', submissionId: '', ...ids,
    db: database(), facts: [], guards: [], writes: [], assertions: new Set(), reads: 0, nowMs: 0, now: '' };
  const rows = await fact(s, `SELECT c.id AS courseId, u.id AS userId, e.id AS enrollmentId FROM Course c
    LEFT JOIN User u ON u.id = (SELECT userId FROM input)
    LEFT JOIN Enrollment e ON e.userId = u.id AND e.courseId = c.id
    WHERE c.id = (SELECT courseId FROM input)`, { courseId: 'text', userId: 'nullableText', enrollmentId: 'nullableText' });
  if (!rows.length) fail('Kurs nicht gefunden.', 404);
  if (!rows[0].userId || !rows[0].enrollmentId) fail('Keine Kursteilnahme.', 403);
  return s;
}
async function setting(s: Scope, mode: 'flags' | 'activity' | 'exists' | 'reset' = 'flags') {
  const fields: Fields = { userId: 'text', courseId: 'text' };
  if (mode === 'flags') Object.assign(fields, { optedIn: 'number', paused: 'number' });
  if (mode === 'flags' || mode === 'activity') fields.lastActivityAt = 'date';
  if (mode === 'reset') Object.assign(fields, { resetTokenHash: 'nullableText', resetTokenExpiresAt: 'nullableDate' });
  const rows = await fact(s, `SELECT * FROM PracticeLearnerSetting WHERE ${own}`, fields);
  if (rows[0] && mode === 'flags') { boolean(rows[0].optedIn); boolean(rows[0].paused); }
  if (rows[0] && (mode === 'flags' || mode === 'activity') && date(rows[0].lastActivityAt).getTime() > s.nowMs) {
    fail('Gleichzeitige Übungsänderung. Bitte erneut versuchen.');
  }
  return rows[0];
}
function assertion(s: Scope, sql: string, values: Value[] = []) {
  const value = statement(s, sql, values);
  s.assertions.add(value);
  return value;
}
function guard(s: Scope, condition: string, values: Value[] = []) {
  s.guards.push(assertion(s, `SELECT CASE WHEN (${condition}) THEN 1 ELSE ${failure} END AS ok`, values));
}
function after(s: Scope, condition: string, values: Value[] = []) {
  s.writes.push(assertion(s, `SELECT CASE WHEN (${condition}) THEN 1 ELSE ${writeFailure} END AS ok`, values));
}
function write(s: Scope, sql: string, values: Value[]) {
  s.writes.push(statement(s, sql, values), assertion(s, `SELECT CASE WHEN changes() = 1 THEN 1 ELSE ${writeFailure} END AS ok`));
}
/** Narrow presentation-only classification. This never retries. */
function snapshotRollback(error: unknown) {
  const details: string[] = [], seen = new Set<unknown>();
  let current = error, total = 0;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 16 || seen.has(current) || typeof current !== 'object') return false;
      seen.add(current);
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code']) if (field in record) {
        const value = record[field];
        if (typeof value !== 'string' || value.length > 16384 || (total += value.length) > 65536) return false;
        if (field === 'code' && !['D1_ERROR', 'SQLITE_ERROR'].includes(value)) return false;
        if (field === 'name' && !['Error', 'D1Error', 'D1_ERROR', 'SqliteError'].includes(value)) return false;
        details.push(value);
      }
      current = record.cause;
    }
  } catch { return false; }
  if (details.some(value => /FORGE_PRACTICE_WRITE_FENCE|constraint|unique|foreign.key|not.null|network|fetch|connection|transport|timeout|timed.out|abort|commit|unknown|socket|ECONN|EPIPE|ENOTFOUND|invalid.response|HTTP\s*\d|SQLITE_BUSY/i.test(value))) return false;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) &&
    details.some(value => /JSON path error[^\n]*FORGE_PRACTICE_SNAPSHOT_CONFLICT/i.test(value));
}
async function commit<T>(s: Scope, dto: T): Promise<T> {
  // Validate/serialize the final projection BEFORE mutating. No post-commit
  // decoder, extra reads, or retry can turn an uncertain commit into a regrade.
  const serialized = JSON.stringify(dto);
  if (!serialized || bytes(serialized) > MAX_RESPONSE_BYTES) fail();
  const guards = s.facts.map(f => assertion(s, `SELECT CASE WHEN data IS ?6 AND oversized = 0 THEN 1 ELSE ${failure} END AS ok FROM (${f.sql})`, [...f.args, f.data]));
  guards.push(assertion(s, `${input} SELECT CASE WHEN EXISTS (SELECT 1 FROM scope)
    AND ${clockSql} BETWEEN ?6 AND ?7 THEN 1 ELSE ${failure} END AS ok`, [...args(s), s.nowMs - 1, s.nowMs + 60_000]));
  const batch = [...guards, ...s.guards, ...s.writes];
  if (s.reads + batch.length > MAX_STATEMENTS) fail('Übungsabfrage überschreitet sichere Grenzen.', 503);
  // D1.batch is the transaction, not withSession or a Prisma callback.
  // Unknown transport/commit errors propagate: there is deliberately NO retry.
  let results: D1Result<Record<string, unknown>>[];
  try { results = await s.db.batch<Record<string, unknown>>(batch); }
  catch (error) {
    if (snapshotRollback(error)) fail('Gleichzeitige Übungsänderung. Bitte erneut versuchen.');
    throw error;
  }
  if (!Array.isArray(results) || results.length !== batch.length || results.some((result, index) =>
    !result || result.success !== true || (s.assertions.has(batch[index]) &&
      (!Array.isArray(result.results) || result.results.length !== 1 || result.results[0]?.ok !== 1)))) {
    fail('Übungsänderung konnte nicht bestätigt werden.', 503);
  }
  return dto;
}
async function pool(s: Scope, historical = false, body = true): Promise<Pool | undefined> {
  const source = historical ? `SELECT p.* FROM PracticeSnapshot p JOIN (${target}) t ON t.snapshotId = p.id AND t.courseId = p.courseId` : currentPool;
  const boundedId = "CASE WHEN typeof(p.id) = 'text' AND length(CAST(p.id AS BLOB)) BETWEEN 1 AND 1024 THEN p.id END";
  const boundedPublication = "CASE WHEN typeof(p.coursePublicationId) = 'text' AND length(CAST(p.coursePublicationId AS BLOB)) BETWEEN 1 AND 1024 THEN p.coursePublicationId END";
  const fields = body ? `'id', ${boundedId}, 'publicationId', ${boundedPublication}, 'itemCount', CASE WHEN typeof(p.itemCount) = 'integer' AND p.itemCount BETWEEN 1 AND 100 THEN p.itemCount END` : `'id', ${boundedId}`;
  const invalid = body ? "typeof(p.id) != 'text' OR length(CAST(p.id AS BLOB)) NOT BETWEEN 1 AND 1024 OR typeof(p.coursePublicationId) != 'text' OR length(CAST(p.coursePublicationId AS BLOB)) NOT BETWEEN 1 AND 1024 OR typeof(p.itemCount) != 'integer' OR p.itemCount NOT BETWEEN 1 AND 100" : "typeof(p.id) != 'text' OR length(CAST(p.id AS BLOB)) NOT BETWEEN 1 AND 1024";
  const sql = `${input} SELECT json_object(${fields}, 'invalid', CASE WHEN ${invalid} THEN 1 ELSE 0 END) AS meta,
    ${body ? `CASE WHEN typeof(p.payload) = 'text' AND length(CAST(p.payload AS BLOB)) <= ${MAX_POOL_BYTES} THEN p.payload END` : 'NULL'} AS payload,
    ${body ? `CASE WHEN typeof(p.payload) = 'text' AND length(CAST(p.payload AS BLOB)) <= ${MAX_POOL_BYTES} THEN 0 ELSE 1 END` : '0'} AS oversized FROM (${source}) p`;
  if (++s.reads >= MAX_STATEMENTS) fail();
  const values = args(s);
  const result = await statement(s, sql, values).first<{ meta: string; payload: string | null; oversized: number }>();
  if (!result) {
    guard(s, `(SELECT count(*) FROM (${sql})) = 0`, values);
    return undefined;
  }
  if (result.oversized !== 0 || typeof result.meta !== 'string' || bytes(result.meta) > 16 * 1024) fail();
  let meta: Row;
  try { meta = JSON.parse(result.meta); } catch { fail(); }
  if (meta.invalid !== 0) fail();
  guard(s, `(SELECT count(*) FROM (${sql}) WHERE meta IS ?6 AND payload IS ?7 AND oversized = 0) = 1`, [...values, result.meta, result.payload]);
  const value: Pool = { id: text(meta.id), coursePublicationId: body ? text(meta.publicationId) : '',
    itemCount: body ? integer(meta.itemCount, 1, 100) : 0, payload: result.payload ?? '', items: [] };
  if (body) value.items = itemsOf(value);
  return value;
}
function itemsOf(value: Pool): Item[] {
  let parsed: { schemaVersion?: unknown; coursePublicationId?: unknown; items?: unknown };
  try { parsed = JSON.parse(value.payload); } catch { fail('Übungspool ist beschädigt.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schemaVersion !== 1 || parsed.coursePublicationId !== value.coursePublicationId ||
      !Array.isArray(parsed.items) || parsed.items.length !== value.itemCount) fail('Übungspool ist beschädigt.');
  const seen = new Set<string>();
  return parsed.items.map(candidate => {
    const item = candidate as Item;
    if (!item || typeof item !== 'object' || typeof item.itemId !== 'string' || !ID.test(item.itemId) ||
        !Number.isSafeInteger(item.itemRevision) || item.itemRevision < 1 || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 8 ||
        typeof item.prompt !== 'string' || typeof item.objectiveTitle !== 'string' || typeof item.explanation !== 'string' ||
        item.options.some(option => typeof option !== 'string') || !Number.isSafeInteger(item.correctIndex) || item.correctIndex < 0 ||
        item.correctIndex >= item.options.length || seen.has(item.itemId)) fail('Übungspool ist beschädigt.');
    seen.add(item.itemId);
    return { ...item, objective: practiceObjectiveOf(candidate as { objectiveId?: unknown; objectiveRevision?: unknown }) };
  });
}
async function retention(s: Scope) {
  const rows = await fact(s, "SELECT lastSuccessAt FROM PracticeRetentionHealth WHERE id = 'learner'", { lastSuccessAt: 'nullableDate' });
  if (!isPracticeRetentionHealthy(rows[0]?.lastSuccessAt != null ? date(rows[0].lastSuccessAt) : null, date(s.nowMs))) fail('Privates Üben ist vorübergehend nicht verfügbar. Bitte später erneut versuchen.', 503);
  guard(s, `EXISTS (SELECT 1 FROM PracticeRetentionHealth WHERE id = 'learner' AND
    (${milliseconds('lastSuccessAt')}) BETWEEN ${clockSql} - 2700000 AND ${clockSql} + 300000)`);
}
async function ready(s: Scope) {
  const flags = await setting(s);
  if (!flags || !boolean(flags.optedIn)) fail('Übung muss zuerst aktiviert werden.');
  if (boolean(flags.paused)) fail('Übung ist pausiert.');
  if (!await pool(s, false, false)) fail('Keine aktive Übungsveröffentlichung.');
  await retention(s);
  const value = await pool(s);
  if (!value) fail('Keine aktive Übungsveröffentlichung.');
  return value;
}
async function pin(s: Scope, item: Item) {
  const sql = `SELECT CASE WHEN typeof(payload) = 'text' AND length(CAST(payload AS BLOB)) <= ${MAX_POOL_BYTES} THEN payload END AS payload
    FROM PracticeItemRevision WHERE itemId = ?1 AND revision = ?2`;
  const row = await read<{ payload: string | null }>(s, sql, [item.itemId, item.itemRevision]);
  if (typeof row.payload !== 'string') fail('Veröffentlichte Übungsrevision fehlt oder ist zu groß.');
  let source: Item;
  try { source = JSON.parse(row.payload); } catch { fail('Veröffentlichte Übungsrevision ist beschädigt.'); }
  if (!source || source.prompt !== item.prompt || JSON.stringify(source.options) !== JSON.stringify(item.options) || source.correctIndex !== item.correctIndex || source.explanation !== item.explanation) fail('Veröffentlichte Übungsrevision stimmt nicht überein.');
  guard(s, `EXISTS (SELECT 1 FROM PracticeItemRevision WHERE itemId = ?1 AND revision = ?2 AND payload IS ?3)`, [item.itemId, item.itemRevision, row.payload]);
}
const sessionFields: Fields = { id: 'text', userId: 'text', courseId: 'text', snapshotId: 'text', status: 'text',
  answeredCount: 'number', pendingReservationId: 'nullableText', version: 'number', createdAt: 'date', updatedAt: 'date' };
function validateSession(row: Row) {
  for (const key of ['id', 'userId', 'courseId', 'snapshotId']) text(row[key]);
  if (!['ACTIVE', 'COMPLETE', 'SUPERSEDED'].includes(text(row.status))) fail();
  integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT); integer(row.version, 0, MAX_VERSION);
  nullableText(row.pendingReservationId); date(row.createdAt); date(row.updatedAt);
  return row;
}
async function active(s: Scope) {
  // LIMIT 2 detects duplicates; the full accepted ACTIVE set (0 or 1) is fenced.
  const rows = await fact(s, `SELECT * FROM PracticeLearnerSession WHERE ${own} AND status = 'ACTIVE' ORDER BY id`, sessionFields);
  return rows[0] ? validateSession(rows[0]) : undefined;
}
async function session(s: Scope) {
  const rows = await fact(s, target, sessionFields);
  if (!rows[0]) fail('Sitzung nicht gefunden.', 404);
  return validateSession(rows[0]);
}
function activeAfter(s: Scope) {
  after(s, '(SELECT count(*) FROM PracticeLearnerSession WHERE userId = ?1 AND courseId = ?2 AND status = \'ACTIVE\') <= 1', [s.userId, s.courseId]);
}
const reservationFields: Fields = { id: 'text', sessionId: 'text', ordinal: 'number', itemId: 'text', itemRevision: 'number', shownAt: 'date' };
const answerFields: Fields = { id: 'text', reservationId: 'text', optionIndex: 'number', correct: 'number', canContinue: 'number', confidence: 'nullableText', nextDueAt: 'date', answeredAt: 'date' };
function validateReservation(row: Row) {
  text(row.id); text(row.sessionId); text(row.itemId); integer(row.ordinal, 1, PRACTICE_SESSION_LIMIT);
  integer(row.itemRevision, 1, Number.MAX_SAFE_INTEGER); date(row.shownAt);
  return row;
}
function validateAnswer(row: Row) {
  text(row.id); text(row.reservationId); integer(row.optionIndex, 0, 7); boolean(row.correct); boolean(row.canContinue);
  if (row.confidence !== null && !['SURE', 'SOMEWHAT_SURE', 'UNSURE', 'GUESSED'].includes(text(row.confidence))) fail();
  date(row.nextDueAt); date(row.answeredAt);
  return row;
}
async function evidence(s: Scope, row: Row, items: Item[]) {
  const reservations = await fact(s, `SELECT r.* FROM PracticeLearnerReservation r JOIN (${target}) t ON r.sessionId = t.id ORDER BY r.ordinal, r.id`, reservationFields, PRACTICE_SESSION_LIMIT);
  const answers = await fact(s, `SELECT a.* FROM PracticeLearnerAnswer a JOIN PracticeLearnerReservation r ON r.id = a.reservationId JOIN (${target}) t ON t.id = r.sessionId ORDER BY r.ordinal, a.id`, answerFields, PRACTICE_SESSION_LIMIT);
  const answered = new Map(answers.map(answer => { validateAnswer(answer); return [text(answer.reservationId), answer]; }));
  const seen = new Set<string>();
  for (const [index, reservation] of reservations.entries()) {
    validateReservation(reservation);
    if (reservation.sessionId !== row.id || reservation.ordinal !== index + 1 || seen.has(text(reservation.itemId)) ||
        !items.some(item => item.itemId === reservation.itemId && item.itemRevision === reservation.itemRevision)) fail();
    seen.add(text(reservation.itemId));
    if (index < integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT)) {
      if (!answered.has(text(reservation.id))) fail();
    } else if (reservation.id !== row.pendingReservationId || answered.has(text(reservation.id))) fail();
  }
  const count = integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT);
  if (answers.length !== count || reservations.length !== count + (row.pendingReservationId === null ? 0 : 1)) fail();
  return { reservations, answersByReservation: answered };
}
async function selection(s: Scope, value: Pool, reservations: Row[]) {
  const schedules = await fact(s, `SELECT x.* FROM PracticeLearnerSchedule x WHERE ${own} AND snapshotId =
    (SELECT id FROM (${currentPool})) ORDER BY itemId`, { itemId: 'text', itemRevision: 'number', dueAt: 'date', intervalDays: 'number', streak: 'number', lastAnsweredAt: 'date' }, 100);
  const states = schedules.map(row => {
    integer(row.itemRevision, 1, Number.MAX_SAFE_INTEGER); integer(row.intervalDays, 0, 30); integer(row.streak, 0, 6); date(row.lastAnsweredAt);
    return { itemId: text(row.itemId), itemRevision: row.itemRevision as number, dueAt: date(row.dueAt) };
  });
  const shownAt = milliseconds('r.shownAt');
  // The inner LIMIT 2 is semantic, not overflow truncation. Corrupt timestamps
  // are brought first and rejected rather than silently filtered out.
  const recent = await fact(s, `SELECT itemId, shownAt FROM (SELECT r.itemId, r.shownAt, r.id FROM PracticeLearnerReservation r
    JOIN PracticeLearnerSession t ON t.id = r.sessionId WHERE t.userId = (SELECT userId FROM input)
      AND t.courseId = (SELECT courseId FROM input) AND t.snapshotId = (SELECT id FROM (${currentPool}))
      AND EXISTS (SELECT 1 FROM scope) AND ((${shownAt}) >= ${s.nowMs - 24 * 3600_000} OR (${shownAt}) IS NULL)
    ORDER BY ((${shownAt}) IS NULL) DESC, (${shownAt}) DESC, r.id DESC LIMIT 2)`, { itemId: 'text', shownAt: 'date' }, 2);
  return { items: value.items, states, recent: recent.map(row => ({ itemId: text(row.itemId), shownAt: date(row.shownAt) })),
    sessionItemIds: reservations.map(row => text(row.itemId)), now: date(s.nowMs), schedules };
}
function publicItem(item: Item) { return { itemId: item.itemId, itemRevision: item.itemRevision, objectiveTitle: item.objectiveTitle, prompt: item.prompt, options: item.options }; }
function activity(s: Scope) {
  write(s, 'UPDATE PracticeLearnerSetting SET lastActivityAt = ?3 WHERE userId = ?1 AND courseId = ?2', [s.userId, s.courseId, s.now]);
  after(s, 'EXISTS (SELECT 1 FROM PracticeLearnerSetting WHERE userId = ?1 AND courseId = ?2 AND lastActivityAt IS ?3)', [s.userId, s.courseId, s.now]);
}
function changeSession(s: Scope, row: Row, pending: string | null, count: number, status: string, increments = 1) {
  const version = integer(row.version, 0, MAX_VERSION);
  write(s, `UPDATE PracticeLearnerSession SET pendingReservationId = ?5, answeredCount = ?6, status = ?7, version = ?8, updatedAt = ?9
    WHERE id = ?1 AND userId = ?2 AND courseId = ?3 AND version = ?4 AND status = 'ACTIVE' AND pendingReservationId IS ?10`,
  [text(row.id), s.userId, s.courseId, version, pending, count, status, version + increments, s.now, nullableText(row.pendingReservationId)]);
  after(s, `EXISTS (SELECT 1 FROM PracticeLearnerSession WHERE id = ?1 AND userId = ?2 AND courseId = ?3 AND snapshotId = ?4
    AND pendingReservationId IS ?5 AND answeredCount = ?6 AND status = ?7 AND version = ?8 AND updatedAt IS ?9)`,
  [text(row.id), s.userId, s.courseId, text(row.snapshotId), pending, count, status, version + increments, s.now]);
}
async function reserve(s: Scope, value: Pool, row: Row, fresh = false) {
  s.sessionId = text(row.id);
  const { reservations, answersByReservation } = fresh
    ? { reservations: [] as Row[], answersByReservation: new Map<string, Row>() }
    : await evidence(s, row, value.items);
  const count = integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT);
  if (row.pendingReservationId !== null) {
    const reservation = reservations.find(candidate => candidate.id === row.pendingReservationId);
    const item = reservation && value.items.find(candidate => candidate.itemId === reservation.itemId && candidate.itemRevision === reservation.itemRevision);
    if (!reservation || !item || reservation.ordinal !== count + 1) fail('Sitzungsreservierung ist beschädigt.');
    activeAfter(s);
    return commit(s, { sessionId: s.sessionId, answeredCount: count, pending: { reservationId: text(reservation.id), ordinal: count + 1, item: publicItem(item) }, complete: false });
  }
  let item: Item | undefined;
  if (count < PRACTICE_SESSION_LIMIT) {
    const candidates = projectPracticeSelection(await selection(s, value, reservations)).candidates;
    // evidence has validated contiguous ordinals, answer presence and snapshot
    // item revisions. Its existing transaction facts fence this priority too.
    const previousReservation = reservations.find(candidate => candidate.ordinal === count);
    const previousAnswer = previousReservation && answersByReservation.get(text(previousReservation.id));
    const previousItem = previousReservation && value.items.find(candidate => candidate.itemId === previousReservation.itemId
      && candidate.itemRevision === previousReservation.itemRevision);
    const validPrevious = previousAnswer && previousItem
      && integer(previousAnswer.optionIndex, 0, 7) < previousItem.options.length
      && boolean(previousAnswer.correct) === (previousAnswer.optionIndex === previousItem.correctIndex);
    item = choosePracticeCandidate(candidates, validPrevious && previousAnswer && previousItem
      ? { item: previousItem, correct: boolean(previousAnswer.correct), confidence: nullableText(previousAnswer.confidence) } : undefined);
  }
  if (!item) {
    changeSession(s, row, null, count, 'COMPLETE');
    activeAfter(s);
    return commit(s, { sessionId: s.sessionId, answeredCount: count, complete: true });
  }
  await pin(s, item);
  const id = randomUUID();
  write(s, `INSERT INTO PracticeLearnerReservation(id, sessionId, ordinal, itemId, itemRevision, shownAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    [id, s.sessionId, count + 1, item.itemId, item.itemRevision, s.now]);
  changeSession(s, row, id, count, 'ACTIVE');
  activity(s);
  after(s, `EXISTS (SELECT 1 FROM PracticeLearnerReservation WHERE id = ?1 AND sessionId = ?2 AND ordinal = ?3
    AND itemId = ?4 AND itemRevision = ?5 AND shownAt IS ?6)`, [id, s.sessionId, count + 1, item.itemId, item.itemRevision, s.now]);
  activeAfter(s);
  return commit(s, { sessionId: s.sessionId, answeredCount: count, pending: { reservationId: id, ordinal: count + 1, item: publicItem(item) }, complete: false });
}

export async function optInLearnerPractice(courseId: string, userId: string) {
  const s = await scope(courseId, userId);
  await setting(s, 'activity');
  if (!await pool(s, false, false)) fail('Keine aktive Übungsveröffentlichung.');
  await retention(s);
  write(s, `INSERT INTO PracticeLearnerSetting(userId, courseId, optedIn, paused, lastActivityAt) VALUES (?1, ?2, 1, 0, ?3)
    ON CONFLICT(userId, courseId) DO UPDATE SET optedIn = 1, paused = 0, lastActivityAt = excluded.lastActivityAt`, [userId, courseId, s.now]);
  after(s, 'EXISTS (SELECT 1 FROM PracticeLearnerSetting WHERE userId = ?1 AND courseId = ?2 AND optedIn = 1 AND paused = 0 AND lastActivityAt IS ?3)', [userId, courseId, s.now]);
  return commit(s, { optedIn: true, paused: false });
}
export async function pauseLearnerPractice(courseId: string, userId: string) {
  const s = await scope(courseId, userId);
  const flags = await setting(s);
  if (!flags || !boolean(flags.optedIn)) fail('Übung ist nicht aktiviert.');
  write(s, 'UPDATE PracticeLearnerSetting SET paused = 1, lastActivityAt = ?3 WHERE userId = ?1 AND courseId = ?2 AND optedIn = 1', [userId, courseId, s.now]);
  after(s, 'EXISTS (SELECT 1 FROM PracticeLearnerSetting WHERE userId = ?1 AND courseId = ?2 AND optedIn = 1 AND paused = 1 AND lastActivityAt IS ?3)', [userId, courseId, s.now]);
  return commit(s, { optedIn: true, paused: true });
}
export async function optOutLearnerPractice(courseId: string, userId: string) {
  const s = await scope(courseId, userId);
  // Opt-out can repair flags, and remains a successful no-op without a setting.
  if (await setting(s, 'activity')) {
    write(s, 'UPDATE PracticeLearnerSetting SET optedIn = 0, paused = 0, lastActivityAt = ?3 WHERE userId = ?1 AND courseId = ?2', [userId, courseId, s.now]);
    after(s, 'EXISTS (SELECT 1 FROM PracticeLearnerSetting WHERE userId = ?1 AND courseId = ?2 AND optedIn = 0 AND paused = 0 AND lastActivityAt IS ?3)', [userId, courseId, s.now]);
  }
  return commit(s, { optedIn: false, paused: false });
}
export async function startLearnerPractice(courseId: string, userId: string) {
  const s = await scope(courseId, userId);
  const value = await ready(s);
  let row = await active(s);
  if (row && row.snapshotId !== value.id) {
    changeSession(s, row, null, integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT), 'SUPERSEDED');
    row = undefined;
  }
  let fresh = false;
  if (!row) {
    fresh = true;
    const id = randomUUID();
    write(s, `INSERT INTO PracticeLearnerSession(id, userId, courseId, snapshotId, status, answeredCount, pendingReservationId, version, createdAt, updatedAt)
      VALUES (?1, ?2, ?3, ?4, 'ACTIVE', 0, NULL, 0, ?5, ?5)`, [id, userId, courseId, value.id, s.now]);
    row = { id, userId, courseId, snapshotId: value.id, status: 'ACTIVE', answeredCount: 0, pendingReservationId: null, version: 0, createdAt: s.nowMs, updatedAt: s.nowMs };
  }
  return reserve(s, value, row, fresh);
}
export async function nextLearnerPractice(courseId: string, userId: string, sessionIdInput: unknown) {
  const s = await scope(courseId, userId, { sessionId: requireId(sessionIdInput, 'Sitzungs-ID') });
  const value = await ready(s);
  await active(s);
  const row = await session(s);
  if (row.status !== 'ACTIVE' || row.snapshotId !== value.id) fail('Sitzung ist veraltet.');
  return reserve(s, value, row);
}
export async function closeLearnerPractice(courseId: string, userId: string, sessionIdInput: unknown) {
  const s = await scope(courseId, userId, { sessionId: requireId(sessionIdInput, 'Sitzungs-ID') });
  const value = await pool(s, false, false);
  await active(s);
  const row = await session(s);
  if (!value || row.snapshotId !== value.id || !['ACTIVE', 'COMPLETE'].includes(text(row.status))) fail('Sitzung ist veraltet.');
  if (row.pendingReservationId !== null) fail('Eine geöffnete Frage wartet noch auf deine Antwort.');
  if (row.status === 'ACTIVE') changeSession(s, row, null, integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT), 'COMPLETE');
  activeAfter(s);
  return commit(s, { sessionId: s.sessionId, complete: true });
}

export async function answerLearnerPractice(courseId: string, userId: string, body: Record<string, unknown>) {
  const sessionId = requireId(body.sessionId, 'Sitzungs-ID');
  const reservationId = requireId(body.reservationId, 'Reservierungs-ID');
  const submissionId = requireId(body.submissionId, 'Übermittlungs-ID');
  const optionIndex = body.optionIndex;
  if (typeof optionIndex !== 'number' || !Number.isSafeInteger(optionIndex) || optionIndex < 0) fail('Antwortindex ist ungültig.', 400);
  const confidence = body.confidence === undefined || body.confidence === null ? null : body.confidence;
  if (confidence !== null && (typeof confidence !== 'string' || !['SURE', 'SOMEWHAT_SURE', 'UNSURE', 'GUESSED'].includes(confidence))) fail('Sicherheitseinschätzung ist ungültig.', 400);
  const selectedConfidence = confidence as 'SURE' | 'SOMEWHAT_SURE' | 'UNSURE' | 'GUESSED' | null;
  // Keep the historical digest byte-for-byte compatible.
  const digest = hash(JSON.stringify([sessionId, reservationId, optionIndex, confidence]));
  const s = await scope(courseId, userId, { sessionId, reservationId, submissionId });
  const receipts = await fact(s, `SELECT q.* FROM PracticeLearnerSubmissionReceipt q JOIN (${target}) t ON t.id = q.sessionId
    WHERE q.submissionId = (SELECT submissionId FROM input)`, { sessionId: 'text', submissionId: 'text', answerId: 'text', requestDigest: 'text' });
  if (receipts.length) {
    const receipt = receipts[0];
    if (receipt.sessionId !== sessionId || receipt.submissionId !== submissionId || receipt.requestDigest !== digest) fail('Übermittlungs-ID wurde anders verwendet.');
    const reservations = await fact(s, `SELECT r.* FROM PracticeLearnerReservation r JOIN (${target}) t ON t.id = r.sessionId
      WHERE r.id = (SELECT reservationId FROM input)`, reservationFields);
    const answers = await fact(s, `SELECT a.* FROM PracticeLearnerAnswer a JOIN PracticeLearnerSubmissionReceipt q ON q.answerId = a.id
      JOIN PracticeLearnerReservation r ON r.id = a.reservationId JOIN (${target}) t ON t.id = r.sessionId AND t.id = q.sessionId
      WHERE q.submissionId = (SELECT submissionId FROM input) AND r.id = (SELECT reservationId FROM input)`, answerFields);
    if (!reservations[0] || !answers[0]) fail('Gespeicherte Übermittlung ist beschädigt.');
    const reservation = validateReservation(reservations[0]);
    const answer = validateAnswer(answers[0]);
    if (reservation.sessionId !== sessionId || reservation.id !== reservationId || answer.id !== receipt.answerId ||
        answer.reservationId !== reservationId || answer.optionIndex !== optionIndex || answer.confidence !== confidence) fail('Gespeicherte Übermittlung ist beschädigt.');
    // Historical snapshot only: pause, opt-out, republish and retention expiry
    // do not invalidate an already committed matching receipt.
    const value = await pool(s, true);
    const item = value?.items.find(candidate => candidate.itemId === reservation.itemId && candidate.itemRevision === reservation.itemRevision);
    if (!item || optionIndex >= item.options.length || boolean(answer.correct) !== (optionIndex === item.correctIndex)) fail('Übungsrevision fehlt oder ist beschädigt.');
    return commit(s, { correct: boolean(answer.correct), correctIndex: item.correctIndex, explanation: item.explanation,
      nextDueAt: date(answer.nextDueAt).toISOString(), canContinue: boolean(answer.canContinue), answeredCount: integer(reservation.ordinal, 1, PRACTICE_SESSION_LIMIT), replay: true });
  }
  const value = await ready(s);
  await active(s);
  const row = await session(s);
  if (row.status !== 'ACTIVE' || row.snapshotId !== value.id) fail('Sitzung ist veraltet.');
  if (row.pendingReservationId !== reservationId) fail('Reservierung ist nicht mehr aktuell.');
  const { reservations } = await evidence(s, row, value.items);
  const reservation = reservations.find(candidate => candidate.id === reservationId);
  const item = reservation && value.items.find(candidate => candidate.itemId === reservation.itemId && candidate.itemRevision === reservation.itemRevision);
  if (!reservation || !item || reservation.ordinal !== integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT) + 1) fail('Frage wurde bereits beantwortet oder ist beschädigt.');
  if (optionIndex >= item.options.length) fail('Antwortindex ist ungültig.', 400);
  await pin(s, item);
  const state = await selection(s, value, reservations);
  const prior = state.schedules.find(candidate => candidate.itemId === item.itemId);
  const correct = optionIndex === item.correctIndex;
  const streak = correct ? Math.min((prior ? integer(prior.streak, 0, 6) : 0) + 1, 6) : 0;
  const reviewMs = practiceReviewIntervalMs(correct, selectedConfidence, streak);
  const dueMs = integer(s.nowMs + reviewMs, -MAX_DATE_MS, MAX_DATE_MS);
  const dueAt = date(dueMs).toISOString();
  const intervalDays = Math.floor(reviewMs / 86400_000);
  const answeredCount = integer(row.answeredCount, 0, PRACTICE_SESSION_LIMIT - 1) + 1;
  const updatedStates = state.states.filter(candidate => candidate.itemId !== item.itemId);
  updatedStates.push({ itemId: item.itemId, itemRevision: item.itemRevision, dueAt: date(dueMs) });
  // Include every existing session reservation, including the just-answered
  // one, while projecting the post-answer schedule exactly as before.
  const canContinue = answeredCount < PRACTICE_SESSION_LIMIT && projectPracticeSelection({ ...state, states: updatedStates }).candidates.length > 0;
  changeSession(s, row, null, answeredCount, canContinue ? 'ACTIVE' : 'COMPLETE', canContinue ? 1 : 2);
  write(s, `INSERT INTO PracticeLearnerSchedule(userId, courseId, snapshotId, itemId, itemRevision, dueAt, intervalDays, streak, lastAnsweredAt)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(userId, courseId, snapshotId, itemId)
    DO UPDATE SET itemRevision = excluded.itemRevision, dueAt = excluded.dueAt, intervalDays = excluded.intervalDays,
      streak = excluded.streak, lastAnsweredAt = excluded.lastAnsweredAt`,
    [userId, courseId, value.id, item.itemId, item.itemRevision, dueAt, intervalDays, streak, s.now]);
  const answerId = randomUUID();
  write(s, `INSERT INTO PracticeLearnerAnswer(id, reservationId, optionIndex, correct, canContinue, confidence, nextDueAt, answeredAt)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`, [answerId, reservationId, optionIndex, Number(correct), Number(canContinue), selectedConfidence, dueAt, s.now]);
  write(s, `INSERT INTO PracticeLearnerSubmissionReceipt(sessionId, submissionId, answerId, requestDigest, createdAt) VALUES (?1, ?2, ?3, ?4, ?5)`,
    [sessionId, submissionId, answerId, digest, s.now]);
  activity(s);
  after(s, `EXISTS (SELECT 1 FROM PracticeLearnerSchedule WHERE userId = ?1 AND courseId = ?2 AND snapshotId = ?3 AND itemId = ?4
    AND itemRevision = ?5 AND dueAt IS ?6 AND intervalDays = ?7 AND streak = ?8 AND lastAnsweredAt IS ?9)`,
    [userId, courseId, value.id, item.itemId, item.itemRevision, dueAt, intervalDays, streak, s.now]);
  after(s, `EXISTS (SELECT 1 FROM PracticeLearnerSubmissionReceipt q JOIN PracticeLearnerAnswer a ON a.id = q.answerId
    JOIN PracticeLearnerReservation r ON r.id = a.reservationId JOIN PracticeLearnerSession t ON t.id = r.sessionId
    JOIN PracticeLearnerSchedule x ON x.userId = t.userId AND x.courseId = t.courseId AND x.snapshotId = t.snapshotId AND x.itemId = r.itemId
    JOIN PracticeLearnerSetting f ON f.userId = t.userId AND f.courseId = t.courseId
    WHERE q.sessionId = ?1 AND q.submissionId = ?2 AND q.answerId = ?3 AND q.requestDigest = ?4 AND q.createdAt IS ?5
      AND t.id = q.sessionId AND t.userId = ?6 AND t.courseId = ?7 AND t.snapshotId = ?8
      AND t.pendingReservationId IS NULL AND t.answeredCount = ?12 AND t.status = ?18 AND t.version = ?19 AND t.updatedAt IS ?5
      AND r.id = ?9 AND r.itemId = ?10 AND r.itemRevision = ?11 AND r.ordinal = ?12
      AND a.optionIndex = ?13 AND a.correct = ?14 AND a.canContinue = ?15 AND a.confidence IS ?16 AND a.nextDueAt IS ?17 AND a.answeredAt IS ?5
      AND x.itemRevision = ?11 AND x.dueAt IS ?17 AND x.intervalDays = ?20 AND x.streak = ?21 AND x.lastAnsweredAt IS ?5
      AND f.optedIn = 1 AND f.paused = 0 AND f.lastActivityAt IS ?5)`,
    [sessionId, submissionId, answerId, digest, s.now, userId, courseId, value.id, reservationId, item.itemId, item.itemRevision, answeredCount,
      optionIndex, Number(correct), Number(canContinue), selectedConfidence, dueAt, canContinue ? 'ACTIVE' : 'COMPLETE',
      integer(row.version, 0, MAX_VERSION) + (canContinue ? 1 : 2), intervalDays, streak]);
  activeAfter(s);
  return commit(s, { correct, correctIndex: item.correctIndex, explanation: item.explanation, nextDueAt: dueAt, canContinue, answeredCount, replay: false });
}

export async function prepareLearnerPracticeReset(courseId: string, userId: string) {
  const s = await scope(courseId, userId);
  if (!await setting(s, 'exists')) fail('Keine Übungsdaten zum Zurücksetzen.');
  const token = randomUUID();
  const expiresAt = date(s.nowMs + 10 * 60_000).toISOString();
  write(s, 'UPDATE PracticeLearnerSetting SET resetTokenHash = ?3, resetTokenExpiresAt = ?4 WHERE userId = ?1 AND courseId = ?2', [userId, courseId, hash(token), expiresAt]);
  after(s, 'EXISTS (SELECT 1 FROM PracticeLearnerSetting WHERE userId = ?1 AND courseId = ?2 AND resetTokenHash IS ?3 AND resetTokenExpiresAt IS ?4)', [userId, courseId, hash(token), expiresAt]);
  return commit(s, { token, expiresAt, confirmation: 'RESET_MY_PRACTICE' });
}
export async function resetLearnerPractice(courseId: string, userId: string, tokenInput: unknown, confirmation: unknown) {
  const token = requireId(tokenInput, 'Zurücksetzen-Token');
  if (confirmation !== 'RESET_MY_PRACTICE') fail('Explizite Bestätigung zum Zurücksetzen erforderlich.', 428);
  const s = await scope(courseId, userId);
  const flags = await setting(s, 'reset');
  if (!flags || flags.resetTokenHash !== hash(token) || flags.resetTokenExpiresAt === null || date(flags.resetTokenExpiresAt).getTime() <= s.nowMs) fail('Zurücksetzen-Token ist ungültig oder abgelaufen.');
  write(s, `DELETE FROM PracticeLearnerSetting WHERE userId = ?1 AND courseId = ?2 AND resetTokenHash = ?3
    AND (${milliseconds('resetTokenExpiresAt')}) > ${clockSql}`, [userId, courseId, hash(token)]);
  // Existing declared CASCADE FKs delete sessions/reservations/answers/receipts
  // and schedules together with this one setting deletion. No schema shim.
  after(s, `NOT EXISTS (SELECT 1 FROM PracticeLearnerSetting WHERE userId = ?1 AND courseId = ?2)
    AND NOT EXISTS (SELECT 1 FROM PracticeLearnerSession WHERE userId = ?1 AND courseId = ?2)
    AND NOT EXISTS (SELECT 1 FROM PracticeLearnerSchedule WHERE userId = ?1 AND courseId = ?2)`, [userId, courseId]);
  return commit(s, { reset: true, optedIn: false });
}
