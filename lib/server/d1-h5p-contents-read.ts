import 'server-only';

import { env } from 'cloudflare:workers';

type Content = { id: string; title: string; contentType: string; createdAt: string };
const columns = ['kind', 'fits', 'expectedCount', 'id', 'title', 'contentType', 'createdAt'] as const;
type Row = Record<typeof columns[number], unknown>;
const DATE_LIMIT = 8640000000000000;
const DATE_BYTES = 1024;
const ROW_BYTES = 200000;
const RESULT_BYTES = 1200000;
const RESPONSE_BYTES = 1200000;
const BIND_BYTES = 1500000;
const SQL_BYTES = 100000;
const REQUEST_WIRE_BYTES = 1200000;

// These are local fail-closed operational bounds, not package/title/ID caps.
// Only the complete authorized set contributes to any projection budget.
// The final compound ORDER BY references the projected raw stored timestamp;
// context's NULL timestamp does not change the relative order of content rows.
const contentsSql = `WITH authority AS (
    SELECT (?2 = 1 AND EXISTS(
      SELECT 1 FROM "User" u WHERE u."id" = ?1 AND u."role" = 'ADMIN'
    )) AS allVisible
  ), visible AS (
    SELECT h."id", h."title", h."contentType", h."createdAt"
    FROM "H5PContent" h CROSS JOIN authority a
    WHERE a.allVisible = 1 OR h."userId" = ?1
  ), costs AS (
    SELECT (typeof(v."id") = 'text' AND typeof(v."title") = 'text'
      AND typeof(v."contentType") = 'text'
      AND ((typeof(v."createdAt") IN ('integer', 'real')
        AND v."createdAt" BETWEEN -${DATE_LIMIT} AND ${DATE_LIMIT})
        OR (typeof(v."createdAt") = 'text'
          AND length(CAST(v."createdAt" AS BLOB)) BETWEEN 1 AND ${DATE_BYTES}
          AND instr(CAST(v."createdAt" AS BLOB), x'00') = 0))) AS typed,
      COALESCE(length(CAST(v."id" AS BLOB)), 0) AS idBytes,
      COALESCE(length(CAST(v."title" AS BLOB)), 0) AS titleBytes,
      COALESCE(length(CAST(v."contentType" AS BLOB)), 0) AS contentTypeBytes,
      CASE WHEN typeof(v."createdAt") IN ('integer', 'real') THEN 32
        ELSE COALESCE(length(CAST(v."createdAt" AS BLOB)), 0) END AS dateBytes
    FROM visible v
  ), budget AS (
    SELECT COUNT(*) AS expectedCount,
      (COALESCE(MIN(typed), 1) = 1
        AND COALESCE(MAX(idBytes + titleBytes + contentTypeBytes + dateBytes), 0) <= ${ROW_BYTES}
        AND COALESCE(SUM(6 * (idBytes + titleBytes + contentTypeBytes + dateBytes) + 256), 0) + 256 <= ${RESULT_BYTES}
        AND COALESCE(SUM(6 * (2 * idBytes + titleBytes + contentTypeBytes) + 128), 0) + 2 <= ${RESPONSE_BYTES}) AS fits
    FROM costs
  )
  SELECT 'context' AS kind, b.fits AS fits, b.expectedCount AS expectedCount,
    NULL AS id, NULL AS title, NULL AS contentType, NULL AS createdAt
  FROM budget b
  UNION ALL
  SELECT 'content', NULL, NULL, v."id", v."title", v."contentType", v."createdAt"
  FROM visible v CROSS JOIN budget b WHERE b.fits = 1
  ORDER BY createdAt DESC`;

/** Exact UTF-8 size of a well-formed JSON string, without constructing it.
 * Controls and lone surrogates count their JSON escapes; a surrogate pair is
 * one four-byte UTF-8 scalar. Quotes are included. */
function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index += 1; }
      else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid D1 H5P contents text');
}

/** Local copy of the reviewed bounded-absolute pathway normalizer. This is a
 * supported stored-date domain, not arbitrary malformed legacy DateTime parity.
 * Normalization affects only the output, never database ordering. */
function storedDate(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < -DATE_LIMIT || value > DATE_LIMIT) throw new Error('Invalid D1 H5P contents numeric date');
    const result = new Date(value);
    if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 H5P contents date');
    return result.toISOString();
  }
  text(value);
  if (!value.length || Buffer.byteLength(value, 'utf8') > DATE_BYTES) throw new Error('Oversized D1 H5P contents date');
  const dateOnly = /^\d{4}-\d\d-\d\d$/.exec(value);
  let normalized: string;
  if (dateOnly && dateOnly[0] === value) normalized = `${value}T00:00:00Z`;
  else {
    const absolute = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(value);
    if (!absolute || absolute[0] !== value || value.includes('\0')) throw new Error('Invalid D1 H5P contents date');
    normalized = value.replace(' ', 'T');
    if (absolute[1] === undefined) normalized += 'Z';
    else if (absolute[1] !== 'Z' && absolute[1].length === 3) normalized += ':00';
  }
  const result = new Date(normalized);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 H5P contents date');
  return result.toISOString();
}

function typedRow(value: unknown): asserts value is Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== columns.length || columns.some(column => !Object.hasOwn(value, column))) {
    throw new Error('Invalid D1 H5P contents row');
  }
  const row = value as Row;
  if (columns.some(column => row[column] !== null && typeof row[column] !== 'string' &&
      (typeof row[column] !== 'number' || !Number.isFinite(row[column])))) {
    throw new Error('Invalid D1 H5P contents scalar');
  }
}

/** One fresh primary SELECT. Neither missing/demoted actors nor non-ADMIN
 * session hints lose the original raw caller-owned fallback. No owners, roles
 * or profile data are returned, and provider errors never enter route logging. */
export async function listD1H5PContents(userId: string, sessionAdmin: boolean): Promise<Content[]> {
  if (typeof userId !== 'string' || Buffer.byteLength(userId, 'utf8') >= BIND_BYTES ||
      Buffer.byteLength(contentsSql, 'utf8') > SQL_BYTES) throw new Error('Unsafe D1 H5P contents binding');
  // Conservative local SQL-plus-bind JSON envelope, not a measured provider
  // request limit. Include escaped SQL, escaped actor, the one-byte bit and a
  // 256-byte fixed allowance before opening a session or calling the provider.
  if (jsonStringBytes(contentsSql) + jsonStringBytes(userId) + 1 + 256 > REQUEST_WIRE_BYTES) {
    throw new Error('D1 H5P contents request exceeds safe byte limits');
  }
  let rows: unknown[];
  try {
    if (!env.DB) throw new Error('Unavailable D1 binding');
    const result = await env.DB.withSession('first-primary').prepare(contentsSql)
      .bind(userId, sessionAdmin === true ? 1 : 0).all<unknown>();
    if (result.success !== true || !Array.isArray(result.results)) throw new Error('Incomplete D1 result');
    rows = result.results;
  } catch {
    // No cause/message/SQL/bindings from the provider escape to the route's log.
    throw new Error('D1 H5P contents read failed');
  }

  let context: Row | undefined;
  const records: Row[] = [];
  for (const row of rows) {
    typedRow(row);
    if (row.kind === 'context') {
      if (context || (row.fits !== 0 && row.fits !== 1) ||
          typeof row.expectedCount !== 'number' || !Number.isSafeInteger(row.expectedCount) || row.expectedCount < 0 ||
          row.id !== null || row.title !== null || row.contentType !== null || row.createdAt !== null) {
        throw new Error('Invalid D1 H5P contents context');
      }
      context = row;
    } else if (row.kind === 'content' && row.fits === null && row.expectedCount === null) records.push(row);
    else throw new Error('Invalid D1 H5P contents kind');
  }
  if (!context || context.fits !== 1 || context.expectedCount !== records.length) {
    throw new Error('Incomplete or oversized D1 H5P contents read');
  }

  // SQL reserves 256 bytes for context/array and 256 per typed content row;
  // six times raw UTF-8 bounds every JSON escape. Numeric dates reserve 32 bytes.
  // The separate response bound reserves 128 per row: keys/structure/quotes,
  // a comma, the 11-byte /h5p/embed/ prefix and up to 27 ISO date bytes fit in 105.
  // The raw ID is counted twice. There is no whole-response JSON allocation.
  const ids = new Set<string>();
  const contents: Content[] = [];
  let resultBytes = 256;
  let responseBytes = 2;
  for (const row of records) {
    text(row.id); text(row.title); text(row.contentType);
    if (typeof row.createdAt !== 'number' && typeof row.createdAt !== 'string') throw new Error('Invalid D1 H5P contents date type');
    const rawBytes = Buffer.byteLength(row.id, 'utf8') + Buffer.byteLength(row.title, 'utf8') +
      Buffer.byteLength(row.contentType, 'utf8') + (typeof row.createdAt === 'number' ? 32 : Buffer.byteLength(row.createdAt, 'utf8'));
    resultBytes += 6 * rawBytes + 256;
    if (rawBytes > ROW_BYTES || resultBytes > RESULT_BYTES || ids.has(row.id)) {
      throw new Error('Invalid or oversized D1 H5P contents projection');
    }
    ids.add(row.id);
    const createdAt = storedDate(row.createdAt);
    // 56 bytes are the object's five keys, colons, commas and braces. Each
    // string counter includes its quotes; prefixing the raw ID adds 11 bytes.
    responseBytes += (contents.length ? 1 : 0) + 56 + 2 * jsonStringBytes(row.id) +
      jsonStringBytes(row.title) + jsonStringBytes(row.contentType) + jsonStringBytes(createdAt) + 11;
    if (responseBytes > RESPONSE_BYTES) throw new Error('D1 H5P contents response exceeds safe byte limits');
    contents.push({ id: row.id, title: row.title, contentType: row.contentType, createdAt });
  }
  // Retain received row order; the route owns the unchanged raw-ID embed URL.
  return contents;
}
