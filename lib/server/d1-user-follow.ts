import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';

function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
type Database = ReturnType<typeof database>;
type FollowResult = { following: { name: string | null } };
type DomainCode = 'P2002' | 'P2025';
const ROW_BYTES = 200_000;
const RESULT_BYTES = 1_200_000;
const RESPONSE_BYTES = 1_200_000;
const BATCH_BYTES = 8_000_000;
const SQL_BYTES = 100_000;
const duplicateMarker = 'D1_USER_FOLLOW_CREATE_DUPLICATE';
const missingMarker = 'D1_USER_FOLLOW_CREATE_MISSING';
const invariantMarker = 'D1_USER_FOLLOW_CREATE_WRITE_INVARIANT';
const failure = (marker: string) => `json_extract('[]', '${marker}')`;

/** The only projected stored value is the target's current nullable name.
 * Six bytes per UTF-8 byte bounds JSON escaping, with fixed room for every
 * assertion row, field name and the route's complete success response. These
 * are infrastructure limits, never truncation or product-level name rules. */
const nameFits = `EXISTS(SELECT 1 FROM User u WHERE u.id = ?2
  AND typeof(u.name) IN ('text', 'null')
  AND COALESCE(length(CAST(u.name AS BLOB)), 0) <= ${ROW_BYTES}
  AND 6 * COALESCE(length(CAST(u.name AS BLOB)), 0) + 4096 <= ${RESULT_BYTES}
  AND 6 * COALESCE(length(CAST(u.name AS BLOB)), 0) + 256 <= ${RESPONSE_BYTES})`;
const liveUsers = `EXISTS(SELECT 1 FROM User WHERE id = ?1)
  AND EXISTS(SELECT 1 FROM User WHERE id = ?2)`;
const exactFollow = `EXISTS(SELECT 1 FROM Follow f WHERE f.id IS ?4
  AND f.followerId IS ?1 AND f.followingId IS ?2
  AND typeof(f.createdAt) = 'text' AND f.createdAt IS ?6)
  AND (SELECT COUNT(*) FROM Follow WHERE id IS ?4) = 1
  AND (SELECT COUNT(*) FROM Follow WHERE followerId = ?1 AND followingId = ?2) = 1`;
const exactNotice = `EXISTS(SELECT 1 FROM Notification n WHERE n.id IS ?5
  AND n.userId IS ?2 AND n.type IS 'FOLLOW' AND n.content IS ?3
  AND n.targetType IS 'USER' AND n.targetId IS ?1
  AND typeof(n.isRead) = 'integer' AND n.isRead IS 0
  AND typeof(n.createdAt) = 'text' AND n.createdAt IS ?6)
  AND (SELECT COUNT(*) FROM Notification WHERE id IS ?5) = 1`;

/** Source-owned numbered slots: actor, target, ORIGINAL session notice text,
 * generated Follow ID, generated Notification ID, one stable UTC timestamp.
 * The final SELECT has no FROM/WHERE: a vanished target still throws and can
 * never suppress the assertion or turn the projection into an empty result. */
function queries() {
  const end = `${liveUsers} AND ${exactFollow} AND ${exactNotice} AND ${nameFits}`;
  return [
    `SELECT CASE
      WHEN EXISTS(SELECT 1 FROM Follow WHERE followerId = ?1 AND followingId = ?2)
        THEN ${failure(duplicateMarker)}
      WHEN NOT (${liveUsers}) THEN ${failure(missingMarker)}
      WHEN NOT (${nameFits}) THEN ${failure(invariantMarker)}
      WHEN EXISTS(SELECT 1 FROM Follow WHERE id = ?4)
        OR EXISTS(SELECT 1 FROM Notification WHERE id = ?5) THEN ${failure(duplicateMarker)}
      ELSE 1 END AS guarded`,
    `INSERT INTO Follow (id, followerId, followingId, createdAt) VALUES (?4, ?1, ?2, ?6)`,
    `SELECT CASE WHEN changes() = 1 AND ${exactFollow}
      THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`,
    `INSERT INTO Notification (id, userId, type, content, targetType, targetId, isRead, createdAt)
      VALUES (?5, ?2, 'FOLLOW', ?3, 'USER', ?1, 0, ?6)`,
    `SELECT CASE WHEN changes() = 1 AND ${exactNotice}
      THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`,
    `SELECT CASE WHEN ${end} THEN 1 ELSE ${failure(invariantMarker)} END AS guarded,
      CASE WHEN ${end} THEN (SELECT name FROM User WHERE id = ?2) END AS name`,
  ];
}

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > ROW_BYTES) {
    throw new Error('D1 Follow input exceeds safe scalar limits');
  }
}

/** Expand only our source-owned slots. Each anonymous placeholder gets exactly
 * one bind, including repeated slots; sparse numbered-parameter behavior is
 * never delegated to the driver. No request value becomes SQL text. */
function bindingPlan(query: string, values: readonly string[]) {
  const binds: string[] = [];
  const sql = query.replace(/\?(\d+)/g, (_token, number: string) => {
    const index = Number(number) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= values.length) {
      throw new Error('Invalid D1 Follow SQL slot');
    }
    binds.push(values[index]);
    return '?';
  });
  if (binds.length > 100 || Buffer.byteLength(sql, 'utf8') > SQL_BYTES) {
    throw new Error('D1 Follow statement exceeds safe limits');
  }
  return { sql, values: binds };
}

// Exact JSON string size, including control escapes and lone surrogates,
// without constructing an encoded string or invoking application helpers.
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

function prepared(db: Database, values: readonly string[]) {
  const plans = queries().map(query => bindingPlan(query, values));
  if (plans.length !== 6) throw new Error('Unexpected D1 Follow batch size');
  const escapedBytes = new Map<string, number>();
  const jsonBytes = (value: string) => {
    let size = escapedBytes.get(value);
    if (size === undefined) {
      size = jsonStringBytes(value);
      escapedBytes.set(value, size);
    }
    return size;
  };
  // Bound complete escaped SQL/binds, array punctuation and a conservative
  // per-statement envelope before preparing or submitting any native write.
  let wireBytes = 2;
  for (const plan of plans) {
    wireBytes += jsonBytes(plan.sql) + 128 + 2 + Math.max(0, plan.values.length - 1);
    for (const value of plan.values) wireBytes += jsonBytes(value);
    if (wireBytes > BATCH_BYTES) throw new Error('D1 Follow batch exceeds safe byte limits');
  }
  return plans.map(plan => db.prepare(plan.sql).bind(...plan.values));
}

/** A qualified own first-guard SQL error may preserve the original domain
 * mapping. Inspect the WHOLE bounded cause chain first: transport, uncertain
 * commit, constraints, invariants and other codes/markers always win. There
 * is no retry, ID regeneration, readback or generic constraint conversion. */
function domainCode(error: unknown): DomainCode | null {
  const details: string[] = [], seen = new Set<unknown>();
  let current = error, total = 0;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return null;
      seen.add(current);
      if (typeof current === 'string') {
        if (current.length > 65536 || (total += current.length) > 262144) return null;
        details.push(current);
        break;
      }
      if (typeof current !== 'object') return null;
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code']) if (field in record) {
        const value = record[field];
        if (typeof value !== 'string' || value.length > 65536 || (total += value.length) > 262144) return null;
        if (field === 'code' && !['D1_ERROR', 'SQLITE_ERROR'].includes(value)) return null;
        if (field === 'name' && !['Error', 'D1Error', 'D1_ERROR', 'SqliteError'].includes(value)) return null;
        details.push(value);
      }
      current = 'cause' in record ? record.cause : null;
    }
  } catch { return null; }
  if (details.some(value => /D1_[A-Z0-9_]*INVARIANT|\binvariant\b|constraint|\bunique\b|foreign[_\s-]*key|not[_\s-]*null|primary[_\s-]*key|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|cancel|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|\bRPC\b|\bHTTP\b|\bTLS\b|\bSSL\b|\bDNS\b|disconnect|broken pipe|unexpected token|invalid response|syntax error|no such (?:table|column|function)|datatype mismatch|out of memory|\bBUSY\b|\blocked\b/i.test(value))) return null;
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? [])
    .some(marker => !['D1_ERROR', duplicateMarker, missingMarker].includes(marker)))) return null;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? [])
    .some(code => code !== 'SQLITE_ERROR'))) return null;
  const duplicate = details.some(value => value.includes(duplicateMarker));
  const missing = details.some(value => value.includes(missingMarker));
  if (duplicate === missing) return null;
  const marker = duplicate ? duplicateMarker : missingMarker;
  const qualified = new RegExp(`\\b(?:D1_ERROR|SQLITE_ERROR)\\b[^\\n]*\\b${marker}\\b|\\b${marker}\\b[^\\n]*\\b(?:D1_ERROR|SQLITE_ERROR)\\b`);
  return details.some(value => qualified.test(value)) ? (duplicate ? 'P2002' : 'P2025') : null;
}

function keys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length ||
      expected.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid D1 Follow result row');
}

function committed(results: unknown): FollowResult {
  if (!Array.isArray(results) || results.length !== 6 || results.some(result => !result || typeof result !== 'object' ||
      result.success !== true || !Array.isArray(result.results))) {
    throw new Error('Incomplete D1 Follow batch');
  }
  for (const index of [1, 3]) if (results[index].results.length !== 0) {
    throw new Error('Unexpected D1 Follow mutation projection');
  }
  for (const index of [0, 2, 4]) {
    const rows: unknown[] = results[index].results;
    if (rows.length !== 1) throw new Error('Missing D1 Follow assertion');
    keys(rows[0], ['guarded']);
    if (rows[0].guarded !== 1) throw new Error('Invalid D1 Follow assertion');
  }
  const rows: unknown[] = results[5].results;
  if (rows.length !== 1) throw new Error('Missing D1 Follow committed result');
  keys(rows[0], ['guarded', 'name']);
  const row = rows[0];
  if (row.guarded !== 1 || (row.name !== null && typeof row.name !== 'string')) {
    throw new Error('Invalid D1 Follow committed result');
  }
  if (row.name !== null) text(row.name);
  // The route interpolates null literally and adds only a fixed success prefix.
  const nameBytes = row.name === null ? 4 : Buffer.byteLength(row.name, 'utf8');
  if (6 * nameBytes + 4096 > RESULT_BYTES || 6 * nameBytes + 256 > RESPONSE_BYTES) {
    throw new Error('D1 Follow response exceeds safe byte limits');
  }
  return { following: { name: row.name } };
}

/** One primary-session atomic batch, no preliminary read and no retries.
 * Both User connects, the exact Follow and one ordinary historical FOLLOW
 * notice commit together. A repeat POST remains a duplicate, not an ACK;
 * unfollow/refollow may create a new notice. The retained route duplicate
 * read plus <=2 existing authentication reads give <=9 source statements. */
export async function createD1UserFollow(actorId: string, followingId: string, noticeContent: string): Promise<FollowResult> {
  text(actorId); text(followingId); text(noticeContent);
  const followId = randomUUID(), noticeId = randomUUID();
  const createdAt = new Date().toISOString().replace(/Z$/, '+00:00');
  const values = [actorId, followingId, noticeContent, followId, noticeId, createdAt];
  for (const value of values) text(value);
  const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
  if (bytes(followId) + bytes(actorId) + bytes(followingId) + bytes(createdAt) + 128 > ROW_BYTES ||
      bytes(noticeId) + bytes(followingId) + bytes(noticeContent) + bytes(actorId) + bytes(createdAt) + 256 > ROW_BYTES) {
    throw new Error('D1 Follow write row exceeds safe byte limits');
  }
  const db = database();
  const statements = prepared(db, values);
  let results: unknown;
  try { results = await db.batch(statements); }
  catch (error) {
    const code = domainCode(error);
    if (code !== null) throw Object.assign(new Error('D1 Follow guarded domain failure'), { code });
    // The unchanged route recognizes top-level Prisma codes. A rejected
    // foreign/native code must not accidentally bypass this narrow classifier.
    throw new Error('D1 Follow native batch failed', { cause: error });
  }
  // Malformed success and unknown-commit decoding never enter domain mapping
  // and can never trigger another write or an optimistic success response.
  return committed(results);
}
