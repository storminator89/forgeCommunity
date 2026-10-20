import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { QuestionBankError } from '@/lib/server/question-bank';

const conflict = () => new QuestionBankError('Frage wurde zwischenzeitlich geändert. Bitte neu laden.', 409);
function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
type Authority = { accountExists: number; targetExists: number; currentRevision: number | null };
const authoritySql = `SELECT EXISTS(SELECT 1 FROM User WHERE id = ?1) AS accountExists,
  EXISTS(SELECT 1 FROM QuestionBankItem WHERE id = ?2 AND ownerId = ?1) AS targetExists,
  (SELECT latestRevision FROM QuestionBankItem WHERE id = ?2 AND ownerId = ?1) AS currentRevision`;

// No statement may be placed between the item mutation and its revision INSERT:
// changes() refers to that immediately preceding mutation on the batch connection.
// D1 executes the entire batch sequentially as one transaction, rolling back ALL
// statements on a constraint/SQL failure. No callbacks or application retries.
const insertRevisionSql = `INSERT INTO QuestionBankRevision (itemId, revision, questionJson, createdAt)
  SELECT ?1, ?2, ?3, ?4 WHERE changes() = 1`;

// A missing dependent revision must abort the batch, not be discovered only
// after commit. This also fails closed on a corrupt pre-existing pointer.
const invariantSql = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM QuestionBankItem i WHERE i.id = ?1 AND i.ownerId = ?2
    AND NOT EXISTS (SELECT 1 FROM QuestionBankRevision r WHERE r.itemId = i.id AND r.revision = i.latestRevision)
  ) THEN json('D1_QUESTION_BANK_WRITE_INVARIANT') ELSE 1 END AS valid`;

function authority(row: Authority | undefined) {
  if (!row || (row.accountExists !== 0 && row.accountExists !== 1) ||
      (row.targetExists !== 0 && row.targetExists !== 1)) throw new Error('Invalid D1 question bank authority result.');
  if (!row.accountExists) throw new QuestionBankError('Kein Zugriff auf den Fragenpool.', 403);
}

/** Payload is already canonicalized and bounded by bankQuestionFromInput. The
 * existing POST contract has no request key: do not silently retry an uncertain
 * result or claim that a second POST is deduplicated. */
export async function d1CreateBankQuestion(ownerId: string, questionJson: string) {
  const db = database();
  const id = `bank_${randomUUID()}`;
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  const results = await db.batch([
    db.prepare(authoritySql).bind(ownerId, id),
    db.prepare(`INSERT INTO QuestionBankItem (id, ownerId, latestRevision, createdAt, updatedAt)
      SELECT ?1, u.id, 1, ?2, ?2 FROM User u WHERE u.id = ?3`).bind(id, now, ownerId),
    db.prepare(insertRevisionSql).bind(id, 1, questionJson, now),
    db.prepare(invariantSql).bind(id, ownerId),
  ]);
  if (results.length !== 4 || results.some(result => !result.success)) throw new Error('D1 question bank write failed.');
  authority(results[0].results[0] as Authority | undefined);
  if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1) throw new Error('D1 question bank write result is missing.');
  return { id, latestRevision: 1 };
}

export async function d1ReviseBankQuestion(ownerId: string, itemId: string, expectedRevision: number, questionJson: string) {
  const db = database();
  // Preserve safe immutable revision numbering; never bind an imprecise next integer.
  const nextRevision = expectedRevision < Number.MAX_SAFE_INTEGER ? expectedRevision + 1 : expectedRevision;
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  const results = await db.batch([
    db.prepare(authoritySql).bind(ownerId, itemId),
    db.prepare(`UPDATE QuestionBankItem SET latestRevision = ?1, updatedAt = ?2
      WHERE id = ?3 AND ownerId = ?4 AND latestRevision = ?5
        AND ?5 < 9007199254740991 AND EXISTS(SELECT 1 FROM User WHERE id = ?4)`)
      .bind(nextRevision, now, itemId, ownerId, expectedRevision),
    db.prepare(insertRevisionSql).bind(itemId, nextRevision, questionJson, now),
    db.prepare(invariantSql).bind(itemId, ownerId),
  ]);
  if (results.length !== 4 || results.some(result => !result.success)) throw new Error('D1 question bank write failed.');
  const before = results[0].results[0] as Authority | undefined;
  authority(before);
  if (!before!.targetExists) throw new QuestionBankError('Frage nicht gefunden.', 404);
  if (before!.currentRevision !== expectedRevision || expectedRevision >= Number.MAX_SAFE_INTEGER) throw conflict();
  if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1) throw new Error('D1 question bank write result is missing.');
  return { id: itemId, latestRevision: nextRevision };
}
