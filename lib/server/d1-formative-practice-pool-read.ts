import 'server-only';

import { env } from 'cloudflare:workers';
import { PracticeError } from '@/lib/server/formative-practice';

const MAX_DATE_MS = 8640000000000000;
const MAX_ROW_BYTES = 1900 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
type Cursor = { updatedAt: Date; id: string } | null;

// Normalize legacy UTC text and native numeric milliseconds before ordering.
function milliseconds(field: string) {
  const length = `length(${field})`;
  const fraction = (suffix: number) => `substr(${field}, 21, ${length} - ${20 + suffix})`;
  const digits = `CASE WHEN substr(${field}, -1) = 'Z' THEN ${fraction(1)}
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
      + CASE WHEN substr(${field}, 20, 1) = '.' THEN CAST(substr((${digits}) || '000', 1, 3) AS INTEGER) ELSE 0 END END`;
}


type Row = { ordinal: number; author: number; target: number; oversize: number; invalidClock: number;
  id: string | null; objectiveId: string | null; title: string | null; description: string | null;
  revision: number | null; timestamp: number | null; payload: string | null };

// Each read is ONE primary SELECT: current role, owner scope, target and data
// share one snapshot. A session alone would not make several SELECTs atomic.
const authority = `viewer AS MATERIALIZED (SELECT id FROM User WHERE id = ?1 AND role IN ('INSTRUCTOR', 'ADMIN')),
  objectives AS MATERIALIZED (SELECT o.* FROM PracticeObjective o JOIN viewer v ON v.id = o.ownerId),
  items AS MATERIALIZED (SELECT i.* FROM PracticeItem i JOIN viewer v ON v.id = i.ownerId)`;
function envelope(selection: string, target: string, invalidClock = 'EXISTS(SELECT 1 FROM selected WHERE timestamp IS NULL)') {
  // Six bytes per input byte conservatively covers JSON escaping, with header
  // and numeric/field-name allowance. Reject before returning oversized data.
  const cost = `1024 + 6 * (COALESCE(length(CAST(id AS BLOB)), 0)
    + COALESCE(length(CAST(objectiveId AS BLOB)), 0) + COALESCE(length(CAST(title AS BLOB)), 0)
    + COALESCE(length(CAST(description AS BLOB)), 0) + COALESCE(length(CAST(payload AS BLOB)), 0))`;
  return `WITH ${authority}, ${selection},
    costs AS MATERIALIZED (SELECT ${cost} AS n FROM selected),
    budget AS MATERIALIZED (SELECT COALESCE(MAX(n), 0) > ${MAX_ROW_BYTES}
      OR COALESCE(SUM(n), 0) > ${MAX_RESPONSE_BYTES} AS oversize FROM costs),
    header AS MATERIALIZED (SELECT EXISTS(SELECT 1 FROM viewer) AS author,
      ${target} AS target, oversize, ${invalidClock} AS invalidClock FROM budget)
    SELECT -1 AS ordinal, author, target, oversize, invalidClock, NULL AS id, NULL AS objectiveId,
      NULL AS title, NULL AS description, NULL AS revision, NULL AS timestamp, NULL AS payload FROM header
    UNION ALL SELECT s.ordinal, h.author, h.target, h.oversize, h.invalidClock,
      s.id, s.objectiveId, s.title, s.description, s.revision, s.timestamp, s.payload
      FROM selected s CROSS JOIN header h WHERE h.author AND h.target AND NOT h.oversize AND NOT h.invalidClock
    ORDER BY ordinal`;
}
const objectiveProjection = `id, NULL AS objectiveId, title, description, revision, ${milliseconds('updatedAt')} AS timestamp, NULL AS payload`;
const objectiveListSql = envelope(`page AS MATERIALIZED (SELECT ${objectiveProjection} FROM objectives
    WHERE ?2 IS NULL OR ${milliseconds('updatedAt')} < ?2 OR (${milliseconds('updatedAt')} = ?2 AND id < ?3)
    ORDER BY ${milliseconds('updatedAt')} DESC, id DESC LIMIT 101),
  selected AS MATERIALIZED (SELECT ROW_NUMBER() OVER (ORDER BY timestamp DESC, id DESC) AS ordinal, * FROM page)`, '1',
  `EXISTS(SELECT 1 FROM objectives WHERE ${milliseconds('updatedAt')} IS NULL)`);
const objectiveSql = envelope(`selected AS MATERIALIZED (SELECT 0 AS ordinal, ${objectiveProjection}
  FROM objectives WHERE id = ?2 LIMIT 1)`, 'EXISTS(SELECT 1 FROM selected)');
const itemProjection = `i.id, i.objectiveId, NULL AS title, NULL AS description, i.latestRevision AS revision,
  ${milliseconds('i.updatedAt')} AS timestamp,
  (SELECT r.payload FROM PracticeItemRevision r WHERE r.itemId = i.id ORDER BY r.revision DESC LIMIT 1) AS payload`;
const itemListSql = envelope(`page AS MATERIALIZED (SELECT ${itemProjection} FROM items i WHERE i.objectiveId = ?2
    AND (?3 IS NULL OR ${milliseconds('i.updatedAt')} < ?3 OR (${milliseconds('i.updatedAt')} = ?3 AND i.id < ?4))
    ORDER BY ${milliseconds('i.updatedAt')} DESC, i.id DESC LIMIT 101),
  selected AS MATERIALIZED (SELECT ROW_NUMBER() OVER (ORDER BY timestamp DESC, id DESC) AS ordinal, * FROM page)`,
  'EXISTS(SELECT 1 FROM objectives WHERE id = ?2)',
  `EXISTS(SELECT 1 FROM items WHERE objectiveId = ?2 AND ${milliseconds('updatedAt')} IS NULL)`);
const itemSql = envelope(`selected AS MATERIALIZED (SELECT 0 AS ordinal, ${itemProjection} FROM items i WHERE i.id = ?2 LIMIT 1)`,
  'EXISTS(SELECT 1 FROM selected)');
const revisionSql = envelope(`selected AS MATERIALIZED (SELECT 0 AS ordinal, r.itemId AS id,
  NULL AS objectiveId, NULL AS title, NULL AS description, r.revision, ${milliseconds('r.createdAt')} AS timestamp, r.payload
  FROM PracticeItemRevision r JOIN items i ON i.id = r.itemId WHERE i.id = ?2 AND r.revision = ?3 LIMIT 1)`,
  'EXISTS(SELECT 1 FROM selected)');

async function read(sql: string, values: (string | number | null)[], missing: string): Promise<Row[]> {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  const result = await env.DB.withSession('first-primary').prepare(sql).bind(...values).all<Row>();
  const header = result.results?.[0];
  if (!result.success || !header || header.ordinal !== -1) throw new Error('D1 practice pool result is missing.');
  if (!header.author) throw new PracticeError('Kein Zugriff auf Übungsautorenschaft.', 403);
  if (!header.target) throw new PracticeError(missing, 404);
  if (header.invalidClock || header.oversize) throw new PracticeError('Übungszustand ist beschädigt oder zu groß.', 409);
  return result.results.slice(1);
}
function date(value: number | null) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_DATE_MS)
    throw new PracticeError('Übungszustand ist beschädigt.', 409);
  return new Date(value);
}
function text(value: string | null): string {
  if (typeof value !== 'string') throw new PracticeError('Übungsrevision ist beschädigt.', 409);
  return value;
}
function integer(value: number | null): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    throw new PracticeError('Übungszustand ist beschädigt.', 409);
  return value;
}
function objective(row: Row) {
  return { id: text(row.id), title: text(row.title), description: text(row.description), revision: integer(row.revision), updatedAt: date(row.timestamp) };
}
function item(row: Row) {
  return { id: text(row.id), objectiveId: text(row.objectiveId), latestRevision: integer(row.revision), updatedAt: date(row.timestamp), payload: text(row.payload) };
}
export async function listObjectivesNative(ownerId: string, cursor: Cursor) {
  return (await read(objectiveListSql, [ownerId, cursor?.updatedAt.getTime() ?? null, cursor?.id ?? null], 'Lernziel nicht gefunden.')).map(objective);
}
export async function objectiveNative(ownerId: string, objectiveId: string) {
  return objective((await read(objectiveSql, [ownerId, objectiveId], 'Lernziel nicht gefunden.'))[0]);
}
export async function listItemsNative(ownerId: string, objectiveId: string, cursor: Cursor) {
  return (await read(itemListSql, [ownerId, objectiveId, cursor?.updatedAt.getTime() ?? null, cursor?.id ?? null], 'Lernziel nicht gefunden.')).map(item);
}
export async function itemNative(ownerId: string, itemId: string) {
  return item((await read(itemSql, [ownerId, itemId], 'Übungsfrage nicht gefunden.'))[0]);
}
export async function itemRevisionNative(ownerId: string, itemId: string, revision: number) {
  const [row] = await read(revisionSql, [ownerId, itemId, revision], 'Übungsfrage nicht gefunden.');
  return { itemId: text(row.id), revision: integer(row.revision), payload: text(row.payload), createdAt: date(row.timestamp) };
}
