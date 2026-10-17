import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';

export class SolutionError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

type SolutionSnapshot = {
  actorExists: number; postExists: number; postOwned: number; postPublished: number;
  replyExists: number; replySamePost: number; replySelf: number; replyAuthorExists: number;
  replyIsTest: number | null; selectionExists: number; selectedCommentId: string | null;
  selectedRevision: string | null; oversized: number;
};
const snapshotFields = ['actorExists', 'postExists', 'postOwned', 'postPublished', 'replyExists', 'replySamePost',
  'replySelf', 'replyAuthorExists', 'replyIsTest', 'selectionExists', 'selectedCommentId', 'selectedRevision', 'oversized'] as const;
const REFERENCE_BYTES = 64 * 1024;
const snapshotSql = `SELECT
  CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS actorExists,
  CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END AS postExists,
  CASE WHEN p.authorId = ?1 THEN 1 ELSE 0 END AS postOwned,
  CASE WHEN p.published = 1 THEN 1 ELSE 0 END AS postPublished,
  CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END AS replyExists,
  CASE WHEN r.postId = ?2 THEN 1 ELSE 0 END AS replySamePost,
  CASE WHEN r.authorId = ?1 THEN 1 ELSE 0 END AS replySelf,
  CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END AS replyAuthorExists,
  CASE WHEN u.isTestAccount IS 0 THEN 0 WHEN u.isTestAccount IS 1 THEN 1 ELSE NULL END AS replyIsTest,
  CASE WHEN s.postId IS NOT NULL THEN 1 ELSE 0 END AS selectionExists,
  CASE WHEN length(CAST(s.commentId AS BLOB)) <= ${REFERENCE_BYTES} THEN s.commentId ELSE NULL END AS selectedCommentId,
  CASE WHEN length(CAST(s.revision AS BLOB)) <= ${REFERENCE_BYTES} THEN s.revision ELSE NULL END AS selectedRevision,
  CASE WHEN length(CAST(s.commentId AS BLOB)) > ${REFERENCE_BYTES}
    OR length(CAST(s.revision AS BLOB)) > ${REFERENCE_BYTES} THEN 1 ELSE 0 END AS oversized
  FROM (SELECT 1) seed
  LEFT JOIN User a ON a.id = ?1
  LEFT JOIN Post p ON p.id = ?2
  LEFT JOIN Comment r ON r.id = ?3
  LEFT JOIN User u ON u.id = r.authorId
  LEFT JOIN AcceptedSolution s ON s.postId = ?2`;

function solutionDatabase() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}

async function readSnapshot(db: ReturnType<typeof solutionDatabase>, postId: string, actorId: string, commentId: string | null) {
  const snapshot = await db.prepare(snapshotSql).bind(actorId, postId, commentId).first<SolutionSnapshot>();
  if (!snapshot) throw new Error('Missing accepted solution snapshot');
  return snapshot;
}

function validateSnapshot(snapshot: SolutionSnapshot, commentId: string | null) {
  if (!snapshot.actorExists) throw new SolutionError('Nicht authentifiziert', 401);
  // A private discussion never becomes visible through staff authority.
  if (!snapshot.postExists || (!snapshot.postPublished && !snapshot.postOwned)) throw new SolutionError('Beitrag nicht gefunden', 404);
  if (!snapshot.postOwned) throw new SolutionError('Nur der Beitragsautor kann eine Lösung auswählen', 403);
  if (commentId !== null) {
    if (!snapshot.postPublished) throw new SolutionError('Lösungen können nur in veröffentlichten Beiträgen ausgewählt werden', 400);
    if (!snapshot.replyExists || !snapshot.replySamePost) throw new SolutionError('Kommentar nicht gefunden', 404);
    if (snapshot.replySelf || snapshot.replyIsTest === 1) {
      throw new SolutionError('Eigene Antworten und Testkonten sind nicht als Lösung berechtigt', 400);
    }
    if (!snapshot.replyAuthorExists || snapshot.replyIsTest !== 0) throw new Error('Invalid accepted solution reply author');
  }
  // Bound old references BEFORE transporting/binding them. Never mistake an
  // oversized existing selection for an absent selection or a successful noop.
  if (snapshot.oversized) throw new SolutionError('Der Lösungsstand ist zu groß. Bitte wende dich an die Administration.', 413);
  if (snapshot.selectionExists
    ? typeof snapshot.selectedCommentId !== 'string' || typeof snapshot.selectedRevision !== 'string'
    : snapshot.selectedCommentId !== null || snapshot.selectedRevision !== null) {
    throw new Error('Invalid accepted solution state');
  }
}

function snapshotGuard(db: ReturnType<typeof solutionDatabase>, snapshot: SolutionSnapshot,
  postId: string, actorId: string, commentId: string | null) {
  // Column names are this fixed allowlist, never request values. Existence and
  // eligibility flags retain distinct NULL/missing states without private IDs.
  const match = snapshotFields.map((field, index) => `s.${field} IS ?${index + 4}`).join(' AND ');
  return db.prepare(`WITH state AS (${snapshotSql}) SELECT CASE WHEN EXISTS
    (SELECT 1 FROM state s WHERE ${match}) THEN 1
    ELSE json('D1_ACCEPTED_SOLUTION_SNAPSHOT_CONFLICT') END AS guarded`)
    .bind(actorId, postId, commentId, ...snapshotFields.map(field => snapshot[field]));
}

function possiblyChangedSnapshot(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    if (/D1_ACCEPTED_SOLUTION_SNAPSHOT_CONFLICT|malformed JSON|UNIQUE constraint failed|FOREIGN KEY constraint failed|SQLITE_CONSTRAINT_(?:UNIQUE|FOREIGNKEY)/i.test(message)) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}

/** Current authority/eligibility, selection CAS and its sole audit record share
 * one native D1 batch. This mutation awards no points, badges or notifications.
 */
export async function changeAcceptedSolution(postId: string, actorId: string, commentId: string | null, expectedRevision: string | null) {
  const db = solutionDatabase();
  let snapshot = await readSnapshot(db, postId, actorId, commentId);
  for (let attempt = 0; attempt < 4; attempt++) {
    validateSnapshot(snapshot, commentId);
    // Target eligibility deliberately precedes idempotency, including when a
    // selected reply has since become a self reply, test reply or hidden target.
    const unchanged = snapshot.selectedCommentId === commentId;
    if (!unchanged && snapshot.selectedRevision !== expectedRevision) {
      throw new SolutionError('Die Lösung wurde inzwischen geändert. Der aktuelle Stand wurde geladen; bitte erneut auswählen.', 409);
    }
    try {
      const guard = snapshotGuard(db, snapshot, postId, actorId, commentId);
      if (unchanged) {
        await db.batch([guard]);
        return { changed: false };
      }
      const revision = randomUUID();
      const now = new Date().toISOString().replace(/Z$/, '+00:00');
      const action = commentId === null ? 'CLEARED' : snapshot.selectionExists ? 'CHANGED' : 'SELECTED';
      const mutation = snapshot.selectionExists
        ? commentId === null
          ? db.prepare('DELETE FROM AcceptedSolution WHERE postId = ? AND revision = ?').bind(postId, snapshot.selectedRevision)
          : db.prepare('UPDATE AcceptedSolution SET commentId = ?, revision = ?, createdAt = ? WHERE postId = ? AND revision = ?')
            .bind(commentId, revision, now, postId, snapshot.selectedRevision)
        : db.prepare('INSERT INTO AcceptedSolution (postId, commentId, revision, createdAt) VALUES (?, ?, ?, ?)')
          .bind(postId, commentId, revision, now);
      await db.batch([
        guard,
        mutation,
        db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1
          ELSE json_extract('[]', 'D1_ACCEPTED_SOLUTION_WRITE_INVARIANT') END AS guarded`),
        db.prepare(`INSERT INTO AcceptedSolutionChange
          (id, actorId, postId, previousCommentId, commentId, action, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(revision, actorId, postId, snapshot.selectedCommentId, commentId, action, now),
        db.prepare(`SELECT CASE WHEN
          ((?2 IS NULL AND NOT EXISTS (SELECT 1 FROM AcceptedSolution WHERE postId = ?1)) OR
           (?2 IS NOT NULL AND EXISTS (SELECT 1 FROM AcceptedSolution WHERE postId = ?1
             AND commentId = ?2 AND revision = ?3 AND createdAt IS ?4)))
          AND EXISTS (SELECT 1 FROM AcceptedSolutionChange WHERE id = ?3 AND actorId = ?5 AND postId = ?1
            AND previousCommentId IS ?6 AND commentId IS ?2 AND action = ?7 AND createdAt IS ?4)
          THEN 1 ELSE json_extract('[]', 'D1_ACCEPTED_SOLUTION_WRITE_INVARIANT') END AS guarded`)
          .bind(postId, commentId, revision, now, actorId, snapshot.selectedCommentId, action),
      ]);
      return { changed: true };
    } catch (error) {
      if (!possiblyChangedSnapshot(error)) throw error;
      const current = await readSnapshot(db, postId, actorId, commentId);
      validateSnapshot(current, commentId);
      // A provider may omit the guard sentinel. Only a demonstrably changed
      // authorized readset is a race; unknown failures/commits are never retried.
      if (snapshotFields.every(field => current[field] === snapshot[field])) throw error;
      snapshot = current;
    }
  }
  throw new SolutionError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
