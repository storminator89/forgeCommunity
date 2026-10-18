import 'server-only';

import { env } from 'cloudflare:workers';
import { createHash, randomUUID } from 'node:crypto';
import type { D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import { PracticeError, type PracticeActor, type PracticeChoice, type PracticeRef } from '@/lib/server/formative-practice';

type Value = string | number | null;
type Row = Record<string, Value>;
type Field = { kind: 'text'; max: number; nullable?: boolean; empty?: boolean; digest?: boolean } | { kind: 'integer' | 'date'; nullable?: boolean };
type Fields = Record<string, Field>;
type Fact = { sql: string; args: Value[]; data: string };
type DraftPayload = { schemaVersion: 1; items: PracticeRef[] };
type SnapshotItem = PracticeRef & { objectiveTitle: string; objectiveDescription: string } & PracticeChoice;
type DraftDecoder = (payload: string) => DraftPayload;
type ChoiceDecoder = (payload: string) => PracticeChoice;
type Snapshot = { id: string; coursePublicationId: string; sequence: number; digest: string; itemCount: number; recordedAt: Date };
function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  // A fresh primary read, including assertions-only historical receipt replay.
  return env.DB;
}
type Scope = { actor: PracticeActor; courseId: string; db: ReturnType<typeof database>; facts: Fact[];
  guards: D1PreparedStatement[]; writes: D1PreparedStatement[]; assertions: Set<D1PreparedStatement>;
  reads: number; now: string };
const MAX_DATE_MS = 8640000000000000;
const MAX_INTEGER = 2147483647; // Prisma Int storage contract; leave headroom before increment.
const MAX_FACT_BYTES = 1536 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_STATEMENTS = 48;
const MAX_SQL_BYTES = 90_000;
const failure = "json_extract('[]', 'FORGE_PRACTICE_AUTHORING_CONFLICT')";
const writeFailure = "json_extract('[]', 'FORGE_PRACTICE_AUTHORING_WRITE_FENCE')";
const clockSql = "ROUND((julianday('now') - 2440587.5) * 86400000)";
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const textField = (max = 1024, nullable = false, empty = false): Field => ({ kind: 'text', max, nullable, empty });
const digestField: Field = { kind: 'text', max: 64, digest: true };
const integerField: Field = { kind: 'integer' };
const dateField: Field = { kind: 'date' };
function fail(message = 'Übungszustand ist beschädigt oder zu groß.', status = 409): never { throw new PracticeError(message, status); }
function text(value: Value | undefined) { if (typeof value !== 'string') fail(); return value; }
function integer(value: Value | undefined, min = 0, max = MAX_INTEGER) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}
function date(value: Value | undefined) { return new Date(integer(value, -MAX_DATE_MS, MAX_DATE_MS)); }
function statement(s: Scope, sql: string, values: Value[] = []) {
  if (bytes(sql) > MAX_SQL_BYTES || values.length > 100) fail('Übungsabfrage überschreitet sichere Grenzen.', 503);
  return s.db.prepare(sql).bind(...values);
}
function assertion(s: Scope, sql: string, values: Value[] = []) {
  const result = statement(s, sql, values); s.assertions.add(result); return result;
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
// Identical numeric/UTC interpretation to the v81 native learner. Each literal
// LIKE/GLOB pattern is below D1's 50-byte limit; json_object stays below 32 args.
function milliseconds(field: string) {
  const length = `length(${field})`;
  const fraction = (suffixLength: number) => `substr(${field}, 21, ${length} - ${20 + suffixLength})`;
  const fractionDigits = `CASE WHEN substr(${field}, -1) = 'Z' THEN ${fraction(1)}
    WHEN substr(${field}, -6) = '+00:00' THEN ${fraction(6)} ELSE ${fraction(0)} END`;
  return `CASE WHEN typeof(${field}) IN ('integer', 'real') THEN
      CASE WHEN ${field} BETWEEN -${MAX_DATE_MS} AND ${MAX_DATE_MS} THEN CAST(${field} AS INTEGER) END
    WHEN typeof(${field}) = 'text' AND ${length} BETWEEN 19 AND 35
      AND instr(CAST(${field} AS BLOB), x'00') = 0
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
function factSql(source: string, fields: Fields, limit: number) {
  const entries = Object.entries(fields);
  if (entries.length > 14 || limit > 10) fail();
  const values = entries.map(([key, field]) => {
    const column = `r."${key}"`;
    const value = field.kind === 'date' ? milliseconds(column) : column;
    const valid = field.kind === 'text' ? `typeof(${column}) = 'text' AND length(CAST(${column} AS BLOB)) BETWEEN ${field.empty ? 0 : 1} AND ${field.max}${field.digest ? ` AND length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'` : ''}`
      : field.kind === 'integer' ? `typeof(${column}) = 'integer' AND ${column} BETWEEN -${MAX_INTEGER} AND ${MAX_INTEGER}`
      : `(${value}) IS NOT NULL`;
    return { key, value, valid: field.nullable ? `(${column} IS NULL OR (${valid}))` : `(${valid})` };
  });
  const valid = values.map(value => value.valid).join(' AND ');
  const object = `json_object(${values.flatMap(value => [`'${value.key}'`, `CASE WHEN ${value.valid} THEN ${value.value} END`]).join(', ')}, 'invalid', CASE WHEN ${valid} THEN 0 ELSE 1 END)`;
  return `WITH rows AS MATERIALIZED (SELECT * FROM (${source}) LIMIT ${limit + 1}),
    encoded AS MATERIALIZED (SELECT ${object} AS data FROM rows r),
    cost AS (SELECT count(*) AS n, COALESCE(sum(length(CAST(data AS BLOB))), 0) AS size FROM encoded)
    SELECT CASE WHEN n <= ${limit} AND size + n + 1 <= ${MAX_FACT_BYTES} THEN
      (SELECT json_group_array(json(data)) FROM encoded) ELSE '[]' END AS data,
      CASE WHEN n > ${limit} OR size + n + 1 > ${MAX_FACT_BYTES} THEN 1 ELSE 0 END AS oversized,
      ${clockSql} AS nowMs FROM cost`;
}
async function fact(s: Scope, source: string, fields: Fields, values: Value[] = [], limit = 1) {
  if (++s.reads >= MAX_STATEMENTS) fail('Übungsabfrage überschreitet sichere Grenzen.', 503);
  const sql = factSql(source, fields, limit);
  const result = await statement(s, sql, values).first<{ data: string; oversized: number; nowMs: number }>();
  if (!result || result.oversized !== 0 || typeof result.data !== 'string' || bytes(result.data) > MAX_FACT_BYTES) fail();
  let rows: Row[];
  try { rows = JSON.parse(result.data); } catch { fail(); }
  if (!Array.isArray(rows) || rows.length > limit || rows.some(row => !row || typeof row !== 'object' || row.invalid !== 0 || Object.keys(row).length !== Object.keys(fields).length + 1)) fail();
  if (!s.now) s.now = date(result.nowMs).toISOString();
  s.facts.push({ sql, args: values, data: result.data });
  return rows;
}
// Classification changes only the response. It NEVER authorizes a retry.
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
  if (details.some(value => /FORGE_PRACTICE_AUTHORING_WRITE_FENCE|constraint|unique|foreign.key|not.null|network|fetch|connection|transport|timeout|timed.out|abort|commit|unknown|socket|ECONN|EPIPE|ENOTFOUND|invalid.response|HTTP\s*\d|SQLITE_BUSY/i.test(value))) return false;
  return details.some(value => /\b(?:D1_ERROR|SQLITE_ERROR)\b/.test(value)) &&
    details.some(value => /JSON path error[^\n]*FORGE_PRACTICE_AUTHORING_CONFLICT/i.test(value));
}
async function commit<T>(s: Scope, dto: T): Promise<T> {
  const serialized = JSON.stringify(dto);
  if (!serialized || bytes(serialized) > MAX_RESPONSE_BYTES) fail();
  const guards = s.facts.map(f => assertion(s, `SELECT CASE WHEN data IS ?${f.args.length + 1} AND oversized = 0 THEN 1 ELSE ${failure} END AS ok FROM (${f.sql})`, [...f.args, f.data]));
  const batch = [...guards, ...s.guards, ...s.writes];
  if (!batch.length || s.reads + batch.length > MAX_STATEMENTS) fail('Übungsabfrage überschreitet sichere Grenzen.', 503);
  let results: D1Result<Record<string, unknown>>[];
  // D1.batch is the atomic boundary. Unknown/transport/commit errors propagate.
  try { results = await s.db.batch<Record<string, unknown>>(batch); }
  catch (error) { if (snapshotRollback(error)) fail('Gleichzeitige Übungsänderung. Bitte neu laden.'); throw error; }
  if (!Array.isArray(results) || results.length !== batch.length || results.some((result, index) =>
    !result || result.success !== true || !Array.isArray(result.results) ||
    (s.assertions.has(batch[index]) ? result.results.length !== 1 || result.results[0]?.ok !== 1
      : result.results.length !== 0 || result.meta?.changes !== 1))) {
    fail('Übungsänderung konnte nicht bestätigt werden.', 503);
  }
  return dto;
}
async function scope(actor: PracticeActor, courseId?: string) {
  if (typeof actor.id !== 'string' || !actor.id || bytes(actor.id) > 1024) fail('Kein Zugriff auf Übungsautorenschaft.', 403);
  const s: Scope = { actor, courseId: courseId ?? '', db: database(), facts: [], guards: [], writes: [], assertions: new Set(), reads: 0, now: '' };
  const users = await fact(s, 'SELECT id, role FROM User WHERE id = ?1', { id: textField(), role: textField() }, [actor.id]);
  if (!users[0] || !['INSTRUCTOR', 'ADMIN'].includes(text(users[0].role))) fail('Kein Zugriff auf Übungsautorenschaft.', 403);
  if (courseId !== undefined) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(courseId)) fail('Kurs nicht gefunden.', 404);
    // Do NOT include activePublicationId: historical replay still has current
    // course-author ACL, without requiring the current publication or draft.
    const courses = await fact(s, 'SELECT id, instructorId FROM Course WHERE id = ?1', { id: textField(), instructorId: textField() }, [courseId]);
    if (!courses[0]) fail('Kurs nicht gefunden.', 404);
    if (courses[0].instructorId !== actor.id && users[0].role !== 'ADMIN') fail('Kein Zugriff auf den Kurs.', 403);
  }
  return s;
}
const objectiveFields: Fields = { id: textField(), ownerId: textField(), title: textField(1200), description: textField(12000, false, true), revision: integerField };
async function objective(s: Scope, id: string) {
  const rows = await fact(s, 'SELECT id, ownerId, title, description, revision FROM PracticeObjective WHERE id = ?1 AND ownerId = ?2', objectiveFields, [id, s.actor.id]);
  if (!rows[0]) fail('Lernziel nicht gefunden.', 404);
  integer(rows[0].revision, 1);
  return rows[0];
}
export async function createObjectiveNative(actor: PracticeActor, title: string, description: string) {
  const s = await scope(actor), id = randomUUID();
  guard(s, 'NOT EXISTS (SELECT 1 FROM PracticeObjective WHERE id = ?1)', [id]);
  write(s, `INSERT INTO PracticeObjective (id, ownerId, title, description, revision, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)`, [id, actor.id, title, description, s.now]);
  after(s, '(SELECT count(*) FROM PracticeObjective WHERE id = ?1 AND ownerId = ?2 AND title IS ?3 AND description IS ?4 AND revision = 1 AND createdAt IS ?5 AND updatedAt IS ?5) = 1', [id, actor.id, title, description, s.now]);
  return commit(s, { id, title, description, revision: 1 });
}
export async function reviseObjectiveNative(actor: PracticeActor, id: string, expected: number, title?: string, description?: string) {
  const s = await scope(actor), current = await objective(s, id);
  if (current.revision !== expected) fail('Lernziel wurde geändert. Bitte neu laden.', 412);
  integer(expected, 1, MAX_INTEGER - 1);
  const next = { id, title: title ?? text(current.title), description: description ?? text(current.description), revision: expected + 1 };
  write(s, `UPDATE PracticeObjective SET title = ?3, description = ?4, revision = ?5, updatedAt = ?6 WHERE id = ?1 AND ownerId = ?2 AND revision = ?7`, [id, actor.id, next.title, next.description, next.revision, s.now, expected]);
  after(s, '(SELECT count(*) FROM PracticeObjective WHERE id = ?1 AND ownerId = ?2 AND title IS ?3 AND description IS ?4 AND revision = ?5 AND updatedAt IS ?6) = 1', [id, actor.id, next.title, next.description, next.revision, s.now]);
  return commit(s, next);
}
export async function createItemNative(actor: PracticeActor, objectiveId: string, choice: PracticeChoice) {
  const s = await scope(actor); await objective(s, objectiveId);
  const id = randomUUID(), payload = JSON.stringify(choice);
  guard(s, 'NOT EXISTS (SELECT 1 FROM PracticeItem WHERE id = ?1) AND NOT EXISTS (SELECT 1 FROM PracticeItemRevision WHERE itemId = ?1)', [id]);
  write(s, `INSERT INTO PracticeItem (id, ownerId, objectiveId, latestRevision, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)`, [id, actor.id, objectiveId, s.now]);
  write(s, 'INSERT INTO PracticeItemRevision (itemId, revision, payload, createdAt) VALUES (?1, 1, ?2, ?3)', [id, payload, s.now]);
  after(s, `(SELECT count(*) FROM PracticeItem i JOIN PracticeItemRevision r ON r.itemId = i.id WHERE i.id = ?1 AND i.ownerId = ?2 AND i.objectiveId = ?3 AND i.latestRevision = 1 AND i.createdAt IS ?4 AND i.updatedAt IS ?4 AND r.revision = 1 AND r.payload IS ?5 AND r.createdAt IS ?4) = 1 AND (SELECT count(*) FROM PracticeItemRevision WHERE itemId = ?1) = 1`, [id, actor.id, objectiveId, s.now, payload]);
  return commit(s, { id, objectiveId, latestRevision: 1 });
}
export async function reviseItemNative(actor: PracticeActor, id: string, expected: number, choice: PracticeChoice) {
  const s = await scope(actor);
  const rows = await fact(s, `SELECT i.id, i.ownerId, i.objectiveId, i.latestRevision, o.ownerId AS objectiveOwnerId,
    r.revision AS currentRevision
    FROM PracticeItem i JOIN PracticeObjective o ON o.id = i.objectiveId
    LEFT JOIN PracticeItemRevision r ON r.itemId = i.id AND r.revision = i.latestRevision WHERE i.id = ?1 AND i.ownerId = ?2 AND o.ownerId = ?2`,
  { id: textField(), ownerId: textField(), objectiveId: textField(), latestRevision: integerField, objectiveOwnerId: textField(), currentRevision: { kind: 'integer', nullable: true } }, [id, actor.id]);
  const current = rows[0];
  if (!current) fail('Übungsfrage nicht gefunden.', 404);
  if (current.latestRevision !== expected) fail('Übungsfrage wurde geändert. Bitte neu laden.', 412);
  integer(expected, 1, MAX_INTEGER - 1);
  if (current.currentRevision !== expected) fail();
  const next = expected + 1, payload = JSON.stringify(choice), objectiveId = text(current.objectiveId);
  guard(s, 'NOT EXISTS (SELECT 1 FROM PracticeItemRevision WHERE itemId = ?1 AND revision = ?2)', [id, next]);
  write(s, 'UPDATE PracticeItem SET latestRevision = ?3, updatedAt = ?4 WHERE id = ?1 AND ownerId = ?2 AND latestRevision = ?5 AND objectiveId = ?6', [id, actor.id, next, s.now, expected, objectiveId]);
  write(s, 'INSERT INTO PracticeItemRevision (itemId, revision, payload, createdAt) VALUES (?1, ?2, ?3, ?4)', [id, next, payload, s.now]);
  after(s, `(SELECT count(*) FROM PracticeItem i JOIN PracticeItemRevision r ON r.itemId = i.id WHERE i.id = ?1 AND i.ownerId = ?2 AND i.objectiveId = ?3 AND i.latestRevision = ?4 AND i.updatedAt IS ?5 AND r.revision = ?4 AND r.payload IS ?6 AND r.createdAt IS ?5) = 1`, [id, actor.id, objectiveId, next, s.now, payload]);
  return commit(s, { id, objectiveId, latestRevision: next });
}
async function publicationPointer(s: Scope) {
  const rows = await fact(s, 'SELECT activePublicationId FROM Course WHERE id = ?1', { activePublicationId: textField(1024, true) }, [s.courseId]);
  if (!rows[0]) fail('Kurs nicht gefunden.', 404);
  return rows[0].activePublicationId === null ? null : text(rows[0].activePublicationId);
}
const snapshotFields: Fields = { id: textField(), coursePublicationId: textField(), sequence: integerField, digest: digestField, itemCount: integerField, recordedAt: dateField };
async function activeSnapshot(s: Scope, publicationId: string | null): Promise<Snapshot | null> {
  if (!publicationId) return null;
  const rows = await fact(s, 'SELECT id, coursePublicationId, sequence, digest, itemCount, recordedAt FROM PracticeSnapshot WHERE courseId = ?1 AND coursePublicationId = ?2 ORDER BY sequence DESC LIMIT 1', snapshotFields, [s.courseId, publicationId]);
  const row = rows[0];
  if (!row) return null;
  return { id: text(row.id), coursePublicationId: text(row.coursePublicationId), sequence: integer(row.sequence, 1), digest: text(row.digest), recordedAt: date(row.recordedAt), itemCount: integer(row.itemCount, 1, 100) };
}
const emptyPayload: DraftPayload = { schemaVersion: 1, items: [] };
const emptyJson = JSON.stringify(emptyPayload);
const draftFields: Fields = { courseId: textField(), revision: integerField, payload: textField(32 * 1024), digest: digestField, lastEditorId: textField(1024, true), updatedAt: dateField };
async function draft(s: Scope) {
  const rows = await fact(s, 'SELECT courseId, revision, payload, digest, lastEditorId, updatedAt FROM CoursePracticeDraft WHERE courseId = ?1', draftFields, [s.courseId]);
  if (rows[0]) integer(rows[0].revision);
  return rows[0];
}
function materialize(s: Scope) {
  write(s, 'INSERT INTO CoursePracticeDraft (courseId, revision, payload, digest, lastEditorId, updatedAt) VALUES (?1, 0, ?2, ?3, NULL, ?4)', [s.courseId, emptyJson, hash(emptyJson), s.now]);
  after(s, '(SELECT count(*) FROM CoursePracticeDraft WHERE courseId = ?1 AND revision = 0 AND payload IS ?2 AND digest IS ?3 AND lastEditorId IS NULL AND updatedAt IS ?4) = 1', [s.courseId, emptyJson, hash(emptyJson), s.now]);
}
export async function readDraftNative(courseId: string, actor: PracticeActor, parseDraft: DraftDecoder) {
  const s = await scope(actor, courseId), activeCoursePublicationId = await publicationPointer(s), current = await draft(s);
  const projected = { revision: current ? integer(current.revision) : 0, payload: parseDraft(current ? text(current.payload) : emptyJson), digest: current ? text(current.digest) : hash(emptyJson) };
  const snapshot = await activeSnapshot(s, activeCoursePublicationId);
  if (!current) materialize(s);
  // Existing-row GET is assertions-only and does not touch editor/updatedAt.
  return commit(s, { draft: projected, activeCoursePublicationId, activeSnapshot: snapshot });
}
async function resolveRefs(s: Scope, refs: PracticeRef[], parseChoice: ChoiceDecoder): Promise<SnapshotItem[]> {
  const byItem = new Map<string, Row>();
  // Ten bounded rows avoid aggregating all 100 escaped payloads into one row.
  for (let start = 0; start < refs.length; start += 10) {
    const pins = JSON.stringify(refs.slice(start, start + 10));
    const rows = await fact(s, `SELECT r.itemId, r.revision, r.payload, i.objectiveId, i.ownerId AS itemOwnerId,
      o.ownerId AS objectiveOwnerId, o.title, o.description, o.revision AS objectiveRevision
      FROM json_each(?1) pin JOIN PracticeItemRevision r
        ON r.itemId = json_extract(pin.value, '$.itemId') AND r.revision = json_extract(pin.value, '$.itemRevision')
      JOIN PracticeItem i ON i.id = r.itemId JOIN PracticeObjective o ON o.id = i.objectiveId
      WHERE i.ownerId = ?2 AND o.ownerId = ?2 ORDER BY CAST(pin.key AS INTEGER)`,
    { itemId: textField(), revision: integerField, payload: textField(16 * 1024), objectiveId: textField(), itemOwnerId: textField(), objectiveOwnerId: textField(), title: textField(1200), description: textField(12000, false, true), objectiveRevision: integerField }, [pins, s.actor.id], 10);
    for (const row of rows) { if (byItem.has(text(row.itemId))) fail(); byItem.set(text(row.itemId), row); }
  }
  return refs.map(ref => {
    const row = byItem.get(ref.itemId);
    if (!row || row.revision !== ref.itemRevision || row.objectiveId !== ref.objectiveId) fail('Eine Übungsreferenz fehlt oder gehört einem anderen Autor.', 409);
    if (row.objectiveRevision !== ref.objectiveRevision) fail('Lernziel wurde geändert. Übungsentwurf bitte neu speichern.', 412);
    return { ...ref, objectiveTitle: text(row.title), objectiveDescription: text(row.description), ...parseChoice(text(row.payload)) };
  });
}
export async function saveDraftNative(courseId: string, actor: PracticeActor, expected: number, payload: DraftPayload, json: string, parseChoice: ChoiceDecoder) {
  const s = await scope(actor, courseId), activeCoursePublicationId = await publicationPointer(s), current = await draft(s);
  if ((current?.revision ?? 0) !== expected) fail('Übungsentwurf wurde geändert. Bitte neu laden.', 412);
  integer(expected, 0, MAX_INTEGER - 1);
  await resolveRefs(s, payload.items, parseChoice);
  const snapshot = await activeSnapshot(s, activeCoursePublicationId), digest = hash(json);
  if (!current) materialize(s);
  write(s, 'UPDATE CoursePracticeDraft SET revision = ?2, payload = ?3, digest = ?4, lastEditorId = ?5, updatedAt = ?6 WHERE courseId = ?1 AND revision = ?7', [courseId, expected + 1, json, digest, actor.id, s.now, expected]);
  after(s, '(SELECT count(*) FROM CoursePracticeDraft WHERE courseId = ?1 AND revision = ?2 AND payload IS ?3 AND digest IS ?4 AND lastEditorId IS ?5 AND updatedAt IS ?6) = 1', [courseId, expected + 1, json, digest, actor.id, s.now]);
  return commit(s, { draft: { revision: expected + 1, payload, digest }, activeCoursePublicationId, activeSnapshot: snapshot });
}
function snapshotDto(row: { id: string; coursePublicationId: string; sequence: number; digest: string; itemCount: number }) {
  return { id: row.id, coursePublicationId: row.coursePublicationId, sequence: row.sequence, digest: row.digest, itemCount: row.itemCount };
}
async function publicationBody(s: Scope, id: string) {
  const sql = `SELECT CASE WHEN typeof(payload) = 'text' AND length(CAST(payload AS BLOB)) <= 524288 THEN payload END AS payload,
    CASE WHEN typeof(payload) = 'text' AND length(CAST(payload AS BLOB)) <= 524288 THEN 0 ELSE 1 END AS oversized
    FROM CoursePublication WHERE id = ?1 AND courseId = ?2`;
  if (++s.reads >= MAX_STATEMENTS) fail();
  const row = await statement(s, sql, [id, s.courseId]).first<{ payload: string | null; oversized: number }>();
  if (!row || row.oversized !== 0 || typeof row.payload !== 'string' || bytes(row.payload) > 524288) fail('Kursveröffentlichung ist beschädigt.', 409);
  // Raw column, not JSON-escaped: the existing 512KiB publication remains below
  // D1's 2MB row ceiling even for worst-case string escaping.
  guard(s, `(SELECT count(*) FROM (${sql}) WHERE payload IS ?3 AND oversized = 0) = 1`, [id, s.courseId, row.payload]);
  return row.payload;
}
export async function publishDraftNative(courseId: string, actor: PracticeActor, expected: number, publicationId: string, requestId: string,
  parseDraft: DraftDecoder, parseChoice: ChoiceDecoder, assertNoCredentialDuplicates: (payload: string, items: SnapshotItem[]) => void) {
  const requestDigest = hash(JSON.stringify([actor.id, expected, publicationId]));
  const s = await scope(actor, courseId);
  const receipts = await fact(s, `SELECT r.actorId, r.requestDigest, r.snapshotId, p.id, p.courseId AS snapshotCourseId,
    p.coursePublicationId, p.sequence, p.digest, p.itemCount FROM PracticePublicationRequest r
    LEFT JOIN PracticeSnapshot p ON p.id = r.snapshotId WHERE r.courseId = ?1 AND r.requestId = ?2`,
  { actorId: textField(), requestDigest: digestField, snapshotId: textField(), id: textField(1024, true), snapshotCourseId: textField(1024, true), coursePublicationId: textField(1024, true), sequence: { kind: 'integer', nullable: true }, digest: { ...digestField, nullable: true }, itemCount: { kind: 'integer', nullable: true } }, [courseId, requestId]);
  const receipt = receipts[0];
  if (receipt) {
    if (receipt.actorId !== actor.id || receipt.requestDigest !== requestDigest || receipt.snapshotCourseId !== courseId || receipt.snapshotId !== receipt.id) fail('Anforderungs-ID wurde anders verwendet.', 409);
    const snapshot = snapshotDto({ id: text(receipt.id), coursePublicationId: text(receipt.coursePublicationId), sequence: integer(receipt.sequence, 1), digest: text(receipt.digest), itemCount: integer(receipt.itemCount, 1, 100) });
    return commit(s, { snapshot, unchanged: true, replay: true });
  }
  const active = await publicationPointer(s), currentDraft = await draft(s);
  if ((currentDraft?.revision ?? 0) !== expected || active !== publicationId) fail('Übungsentwurf oder Kursveröffentlichung wurde geändert. Bitte neu laden.', 412);
  const refs = parseDraft(currentDraft ? text(currentDraft.payload) : emptyJson).items;
  if (!refs.length) fail('Mindestens eine Übungsfrage ist erforderlich.', 409);
  const body = await publicationBody(s, publicationId), items = await resolveRefs(s, refs, parseChoice);
  assertNoCredentialDuplicates(body, items);
  const payload = { schemaVersion: 1, coursePublicationId: publicationId, items }, json = JSON.stringify(payload);
  if (bytes(json) > 1024 * 1024) fail('Übung ist zu groß.', 413);
  const digest = hash(json), current = await activeSnapshot(s, publicationId);
  let snapshot: ReturnType<typeof snapshotDto>, unchanged: boolean;
  if (current?.digest === digest) { snapshot = snapshotDto(current); unchanged = true; }
  else {
    const latest = await fact(s, 'SELECT sequence FROM PracticeSnapshot WHERE courseId = ?1 ORDER BY sequence DESC LIMIT 1', { sequence: integerField }, [courseId]);
    const sequence = (latest[0] ? integer(latest[0].sequence, 1, MAX_INTEGER - 1) : 0) + 1, id = randomUUID();
    guard(s, 'NOT EXISTS (SELECT 1 FROM PracticeSnapshot WHERE id = ?1) AND NOT EXISTS (SELECT 1 FROM PracticeSnapshot WHERE courseId = ?2 AND sequence = ?3)', [id, courseId, sequence]);
    write(s, `INSERT INTO PracticeSnapshot (id, courseId, coursePublicationId, sequence, draftRevision, payload, digest, itemCount, actorId, recordedAt)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`, [id, courseId, publicationId, sequence, expected, json, digest, items.length, actor.id, s.now]);
    after(s, '(SELECT count(*) FROM PracticeSnapshot WHERE id = ?1 AND courseId = ?2 AND coursePublicationId = ?3 AND sequence = ?4 AND draftRevision = ?5 AND payload IS ?6 AND digest IS ?7 AND itemCount = ?8 AND actorId IS ?9 AND recordedAt IS ?10) = 1', [id, courseId, publicationId, sequence, expected, json, digest, items.length, actor.id, s.now]);
    snapshot = { id, coursePublicationId: publicationId, sequence, digest, itemCount: items.length }; unchanged = false;
  }
  write(s, 'INSERT INTO PracticePublicationRequest (courseId, requestId, actorId, requestDigest, snapshotId, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)', [courseId, requestId, actor.id, requestDigest, snapshot.id, s.now]);
  after(s, '(SELECT count(*) FROM PracticePublicationRequest WHERE courseId = ?1 AND requestId = ?2 AND actorId IS ?3 AND requestDigest IS ?4 AND snapshotId IS ?5 AND createdAt IS ?6) = 1', [courseId, requestId, actor.id, requestDigest, snapshot.id, s.now]);
  return commit(s, { snapshot, unchanged, replay: false });
}
