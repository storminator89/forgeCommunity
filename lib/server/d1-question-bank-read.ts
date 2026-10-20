import 'server-only';

import { env } from 'cloudflare:workers';
import { QuestionBankError } from '@/lib/server/question-bank';
import type { QuizQuestion } from '@/app/courses/[courseId]/contents/types';

const MAX_DATE_MS = 8640000000000000;
const MAX_ROW_BYTES = 1900 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// Match the native analytics reader: normalize numeric millisecond and UTC text
// timestamps BEFORE cursor comparison, ordering, and Date conversion.
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


type Row = { ordinal: number; accountExists: number; targetExists: number; oversize: number; invalidClock: number;
  id: string | null; latestRevision: number | null; revision: number | null;
  timestamp: number | null; questionJson: string | null };

// A single primary SELECT is the consistency boundary, not withSession alone.
// Authority, cursor/target existence, ordered rows and bounds are one snapshot.
// The header is always present, even for an empty bank or revision history.
const authority = `viewer AS MATERIALIZED (SELECT id FROM User WHERE id = ?1),
  owned AS MATERIALIZED (SELECT i.id, i.latestRevision, i.updatedAt FROM QuestionBankItem i
    JOIN viewer v ON v.id = i.ownerId)`;
function envelope(selection: string, target: string, invalidClock = 'EXISTS(SELECT 1 FROM selected WHERE revision IS NOT NULL AND timestamp IS NULL)') {
  const cost = `1024 + 6 * (COALESCE(length(CAST(id AS BLOB)), 0)
    + COALESCE(length(CAST(questionJson AS BLOB)), 0))`;
  return `WITH ${authority}, ${selection},
    costs AS MATERIALIZED (SELECT ${cost} AS n FROM selected),
    budget AS MATERIALIZED (SELECT COALESCE(MAX(n), 0) > ${MAX_ROW_BYTES}
      OR COALESCE(SUM(n), 0) > ${MAX_RESPONSE_BYTES} AS oversize FROM costs),
    header AS MATERIALIZED (SELECT EXISTS(SELECT 1 FROM viewer) AS accountExists,
      ${target} AS targetExists, oversize, ${invalidClock} AS invalidClock FROM budget)
    SELECT -1 AS ordinal, accountExists, targetExists, oversize, invalidClock,
      NULL AS id, NULL AS latestRevision, NULL AS revision, NULL AS timestamp, NULL AS questionJson FROM header
    UNION ALL SELECT s.ordinal, h.accountExists, h.targetExists, h.oversize, h.invalidClock,
      s.id, s.latestRevision, s.revision, s.timestamp, s.questionJson
      FROM selected s CROSS JOIN header h WHERE h.accountExists AND h.targetExists AND NOT h.oversize AND NOT h.invalidClock
    ORDER BY ordinal`;
}
const listSql = envelope(`cursor_row AS MATERIALIZED (SELECT id, ${milliseconds('updatedAt')} AS timestamp FROM owned WHERE id = ?2),
  page AS MATERIALIZED (SELECT i.id, i.latestRevision, ${milliseconds('i.updatedAt')} AS timestamp
    FROM owned i WHERE ?2 IS NULL OR EXISTS(SELECT 1 FROM cursor_row c WHERE
      ${milliseconds('i.updatedAt')} < c.timestamp OR (${milliseconds('i.updatedAt')} = c.timestamp AND i.id < c.id))
    ORDER BY ${milliseconds('i.updatedAt')} DESC, i.id DESC LIMIT 51),
  selected AS MATERIALIZED (SELECT ROW_NUMBER() OVER (ORDER BY p.timestamp DESC, p.id DESC) AS ordinal,
    p.id, p.latestRevision, NULL AS revision, p.timestamp,
    (SELECT r.questionJson FROM QuestionBankRevision r WHERE r.itemId = p.id ORDER BY r.revision DESC LIMIT 1) AS questionJson FROM page p)`,
  `(?2 IS NULL OR EXISTS(SELECT 1 FROM cursor_row))`,
  `EXISTS(SELECT 1 FROM owned WHERE ${milliseconds('updatedAt')} IS NULL)`);
const historySql = envelope(`target AS MATERIALIZED (SELECT id, latestRevision FROM owned WHERE id = ?2),
  history AS MATERIALIZED (SELECT r.revision, ${milliseconds('r.createdAt')} AS timestamp
    FROM QuestionBankRevision r JOIN target t ON t.id = r.itemId ORDER BY r.revision DESC LIMIT 100),
  selected AS MATERIALIZED (SELECT 0 AS ordinal, id, latestRevision, NULL AS revision, NULL AS timestamp, NULL AS questionJson FROM target
    UNION ALL SELECT ROW_NUMBER() OVER (ORDER BY revision DESC), NULL, NULL, revision, timestamp, NULL FROM history)`,
  `EXISTS(SELECT 1 FROM target)`);
const revisionSql = envelope(`selected AS MATERIALIZED (SELECT 0 AS ordinal, NULL AS id, NULL AS latestRevision,
    r.revision, ${milliseconds('r.createdAt')} AS timestamp, r.questionJson
    FROM QuestionBankRevision r JOIN owned i ON i.id = r.itemId WHERE i.id = ?2 AND r.revision = ?3 LIMIT 1)`,
  `EXISTS(SELECT 1 FROM selected)`);

async function read(sql: string, values: (string | number | null)[], cursor = false): Promise<Row[]> {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  const result = await env.DB.withSession('first-primary').prepare(sql).bind(...values).all<Row>();
  const header = result.results?.[0];
  if (!result.success || !header || header.ordinal !== -1) throw new Error('D1 question bank result is missing.');
  if (!header.accountExists) throw new QuestionBankError('Kein Zugriff auf den Fragenpool.', 403);
  if (!header.targetExists) throw new QuestionBankError(cursor ? 'Ungültiger Listencursor.' : 'Frage nicht gefunden.', cursor ? 400 : 404);
  // Corrupt/oversized stored data remains a server error, never partial success.
  if (header.invalidClock) throw new Error('Invalid question bank timestamp.');
  if (header.oversize) throw new Error('D1 question bank response exceeds its bounded read budget.');
  return result.results.slice(1);
}
function date(ms: number | null): Date {
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || Math.abs(ms) > MAX_DATE_MS) throw new Error('Invalid question bank timestamp.');
  return new Date(ms);
}
function question(value: string | null): QuizQuestion {
  if (typeof value !== 'string') throw new Error('Question bank revision is missing.');
  return JSON.parse(value) as QuizQuestion;
}
export async function d1ListBankQuestions(ownerId: string, cursor: string | null) {
  const rows = await read(listSql, [ownerId, cursor], true);
  const items = rows.slice(0, 50);
  return { questions: items.map(item => {
    const value = question(item.questionJson);
    // Never return grading keys on the listing endpoint.
    return { id: item.id!, latestRevision: item.latestRevision!, updatedAt: date(item.timestamp), question: value.question, type: value.type };
  }), nextCursor: rows.length > 50 ? items.at(-1)!.id : null };
}
export async function d1BankQuestionHistory(ownerId: string, itemId: string) {
  const [item, ...revisions] = await read(historySql, [ownerId, itemId]);
  if (!item || item.ordinal !== 0) throw new Error('Question bank history is missing.');
  return { id: item.id!, latestRevision: item.latestRevision!, revisions: revisions.map(row => ({ revision: row.revision!, createdAt: date(row.timestamp) })) };
}
export async function d1BankQuestionRevision(ownerId: string, itemId: string, revision: number) {
  const [row] = await read(revisionSql, [ownerId, itemId, revision]);
  if (!row) throw new Error('Question bank revision is missing.');
  return { revision: row.revision!, question: question(row.questionJson), createdAt: date(row.timestamp) };
}
