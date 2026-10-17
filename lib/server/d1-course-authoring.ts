import 'server-only';

import { d1AuthorProjection, d1CourseDatabase, type D1AuthorDraftRow } from './d1-course-drafts';
import { d1CourseRewardStatements, type D1RewardMaterial } from './d1-course-rewards';
import type { CoursePayload } from './course-authoring';

export type D1CourseAuthor = { id: string; role?: string | null };
export type D1CourseReferences = { contentIds: string[]; assetIds: string[]; h5pIds: string[] };
export type D1ReferenceFlags = { foreignContent: number; missingAsset: number; missingH5p: number; foreignH5p: number };

const authorWhere = `c.id = ? AND (c.instructorId = u.id OR (? = 'ADMIN' AND u.role = 'ADMIN'))`;

/** All reference collections are one bound JSON value, including 500-node courses. */
const referenceProjection = `
  EXISTS (SELECT 1 FROM json_each(refs.value, '$.contentIds') j
    JOIN CourseContent x ON x.id = j.value WHERE x.courseId <> c.id) AS foreignContent,
  EXISTS (SELECT 1 FROM json_each(refs.value, '$.assetIds') j
    LEFT JOIN CourseAsset a ON a.id = j.value AND a.courseId = c.id WHERE a.id IS NULL) AS missingAsset,
  EXISTS (SELECT 1 FROM json_each(refs.value, '$.h5pIds') j
    LEFT JOIN H5PContent h ON h.id = j.value WHERE h.id IS NULL) AS missingH5p,
  EXISTS (SELECT 1 FROM json_each(refs.value, '$.h5pIds') j
    JOIN H5PContent h ON h.id = j.value
    WHERE h.userId <> u.id AND NOT (? = 'ADMIN' AND u.role = 'ADMIN')) AS foreignH5p`;

/** The same predicates fence the first write, never merely an earlier read. */
export const d1ReferenceFence = `
  NOT EXISTS (SELECT 1 FROM json_each(refs.value, '$.contentIds') j
    JOIN CourseContent x ON x.id = j.value WHERE x.courseId <> c.id)
  AND NOT EXISTS (SELECT 1 FROM json_each(refs.value, '$.assetIds') j
    LEFT JOIN CourseAsset a ON a.id = j.value AND a.courseId = c.id WHERE a.id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM json_each(refs.value, '$.h5pIds') j
    LEFT JOIN H5PContent h ON h.id = j.value
    WHERE h.id IS NULL OR (h.userId <> u.id AND NOT (? = 'ADMIN' AND u.role = 'ADMIN')))`;

export async function readD1AuthorReferences(courseId: string, actor: D1CourseAuthor,
  state: D1AuthorDraftRow, references: D1CourseReferences) {
  return d1CourseDatabase().prepare(`WITH refs(value) AS (VALUES (?))
    SELECT ${referenceProjection},
      (SELECT COUNT(*) FROM Enrollment e WHERE e.courseId = c.id) AS enrolledLearners
    FROM Course c JOIN User u ON u.id = ? JOIN CourseDraft d ON d.courseId = c.id CROSS JOIN refs
    WHERE ${authorWhere} AND d.revision = ? AND d.digest = ? AND d.payload = ?
      AND c.activePublicationId IS ?`)
    .bind(JSON.stringify(references), actor.role ?? '', actor.id, courseId, actor.role ?? '',
      state.revision, state.digest, state.payload, state.activePublicationId)
    .first<D1ReferenceFlags & { enrolledLearners: number }>();
}

export async function writeD1CourseDraft(courseId: string, actor: D1CourseAuthor, state: D1AuthorDraftRow,
  next: { payload: string; digest: string; basePublicationId?: string | null }, references: D1CourseReferences) {
  const db = d1CourseDatabase();
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  const results = await db.batch([
    db.prepare(`WITH refs(value) AS (VALUES (?))
      UPDATE CourseDraft SET revision = revision + 1, payload = ?, digest = ?, lastEditorId = ?, updatedAt = ?,
        basePublicationId = CASE WHEN ? THEN ? ELSE basePublicationId END
      WHERE courseId = ? AND revision = ? AND digest = ? AND payload = ?
        AND EXISTS (SELECT 1 FROM Course c JOIN User u ON u.id = ? CROSS JOIN refs
          WHERE ${authorWhere} AND c.activePublicationId IS ? AND ${d1ReferenceFence})`)
      .bind(JSON.stringify(references), next.payload, next.digest, actor.id, now,
        next.basePublicationId !== undefined ? 1 : 0, next.basePublicationId ?? null,
        courseId, state.revision, state.digest, state.payload, actor.id, courseId, actor.role ?? '',
        state.activePublicationId, actor.role ?? ''),
    db.prepare(`${d1AuthorProjection} WHERE ${authorWhere}`).bind(actor.id, courseId, actor.role ?? ''),
  ]);
  // There are no writes after the CAS. A zero-row write cannot partially apply.
  if (results[0].meta.changes !== 1) return null;
  return results[1].results[0] as D1AuthorDraftRow | undefined ?? null;
}

export async function readD1AuthorHistory(courseId: string, actor: D1CourseAuthor) {
  const db = d1CourseDatabase();
  const results = await db.batch([
    db.prepare(`${d1AuthorProjection} WHERE ${authorWhere}`).bind(actor.id, courseId, actor.role ?? ''),
    db.prepare(`SELECT p.id, p.sequence, p.source, p.recordedAt, p.digest
      FROM CoursePublication p JOIN Course c ON c.id = p.courseId JOIN User u ON u.id = ?
      WHERE ${authorWhere} ORDER BY p.sequence DESC`).bind(actor.id, courseId, actor.role ?? ''),
  ]);
  if (!results[0].results.length) return null;
  return results[1].results as Array<{ id: string; sequence: number; source: 'AUTHOR' | 'RESTORE'; recordedAt: string | number; digest: string }>;
}

export async function readD1RestorePublication(courseId: string, actor: D1CourseAuthor, publicationId: string) {
  return d1CourseDatabase().prepare(`SELECT p.id, p.payload, p.digest
    FROM CoursePublication p JOIN Course c ON c.id = p.courseId JOIN User u ON u.id = ?
    WHERE ${authorWhere} AND p.id = ?`).bind(actor.id, courseId, actor.role ?? '', publicationId)
    .first<{ id: string; payload: string; digest: string }>();
}

export type D1PublicationReceipt = {
  actorId: string; requestDigest: string; publicationId: string; publicationCourseId: string | null;
  sequence: number | null; digest: string | null;
};

const receiptProjection = `SELECT r.actorId, r.requestDigest, r.publicationId,
  p.courseId AS publicationCourseId, p.sequence, p.digest
  FROM Course c JOIN User u ON u.id = ? JOIN PublicationRequest r ON r.courseId = c.id
  LEFT JOIN CoursePublication p ON p.id = r.publicationId
  WHERE ${authorWhere} AND r.requestId = ?`;

/** Replays reauthorize the current account but are independent of a later active pointer. */
export async function readD1PublicationReceipt(courseId: string, actor: D1CourseAuthor, requestId: string) {
  return d1CourseDatabase().prepare(receiptProjection).bind(actor.id, courseId, actor.role ?? '', requestId)
    .first<D1PublicationReceipt>();
}

export async function publishD1CourseDraft(input: {
  courseId: string; actor: D1CourseAuthor; state: D1AuthorDraftRow; payload: CoursePayload;
  references: D1CourseReferences; requestId: string; requestDigest: string; publicationId: string;
  nodes: D1RewardMaterial; scoringChangeReason: 'QUIZ_REVISED' | 'LEARNING_CHANGED'; unchanged: boolean;
}) {
  const { courseId, actor, state } = input;
  const db = d1CourseDatabase();
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  // This exact immutable id exists only if THIS batch's first write passed all
  // fences. Every dependent write uses it; a zero-row CAS makes them all no-ops.
  const gate = { sql: 'SELECT 1 FROM CoursePublication WHERE id = ? AND courseId = ?', values: [input.publicationId, courseId] };
  const fence = `FROM Course c JOIN User u ON u.id = ? JOIN CourseDraft d ON d.courseId = c.id
    LEFT JOIN CoursePublication p ON p.id = c.activePublicationId CROSS JOIN refs
    WHERE ${authorWhere} AND d.revision = ? AND d.digest = ? AND d.payload = ? AND c.activePublicationId IS ?
      AND c.rewardEligible IS ? AND c.rewardApprovalRevision IS ?
      AND (c.activePublicationId IS NULL OR p.courseId = c.id)
      AND ${d1ReferenceFence}
      AND NOT EXISTS (SELECT 1 FROM PublicationRequest r WHERE r.courseId = c.id AND r.requestId = ?)`;
  const fenceValues = [actor.id, courseId, actor.role ?? '', state.revision, state.digest, state.payload,
    state.activePublicationId, state.rewardEligible, state.rewardApprovalRevision, actor.role ?? '', input.requestId];
  const statements = [];
  if (input.unchanged) {
    statements.push(db.prepare(`WITH refs(value) AS (VALUES (?))
      INSERT INTO PublicationRequest (courseId, requestId, actorId, requestDigest, publicationId, createdAt)
      SELECT c.id, ?, u.id, ?, p.id, ? ${fence} AND p.digest = d.digest`)
      .bind(JSON.stringify(input.references), input.requestId, input.requestDigest, now, ...fenceValues));
  } else {
    statements.push(db.prepare(`WITH refs(value) AS (VALUES (?))
      INSERT INTO CoursePublication
        (id, courseId, sequence, source, payload, digest, contentCount, previousPublicationId, actorId, recordedAt)
      SELECT ?, c.id, COALESCE(p.sequence, 0) + 1,
        CASE WHEN d.basePublicationId IS NOT NULL AND d.basePublicationId IS NOT c.activePublicationId THEN 'RESTORE' ELSE 'AUTHOR' END,
        d.payload, d.digest, json_array_length(d.payload, '$.contents'), c.activePublicationId, u.id, ?
      ${fence}`)
      .bind(JSON.stringify(input.references), input.publicationId, now, ...fenceValues));
    statements.push(db.prepare(`UPDATE CourseContent SET archivedAt = COALESCE(archivedAt, ?), parentId = NULL, updatedAt = ?
      WHERE courseId = ? AND (archivedAt IS NULL OR parentId IS NOT NULL)
        AND EXISTS (${gate.sql}) AND NOT EXISTS (SELECT 1 FROM CoursePublication p, json_each(p.payload, '$.contents') j
          WHERE p.id = ? AND json_extract(j.value, '$.id') = CourseContent.id)`)
      .bind(now, now, courseId, ...gate.values, input.publicationId));
    // One set projection permits same-statement parent references. No loop can
    // expose half a tree, and global content ids were checked by the first CAS.
    statements.push(db.prepare(`INSERT INTO CourseContent
      (id, courseId, title, type, content, parentId, "order", archivedAt, createdAt, updatedAt)
      SELECT json_extract(j.value, '$.id'), p.courseId, json_extract(j.value, '$.title'),
        CASE WHEN json_extract(j.value, '$.type') = 'QUIZ' THEN 'TEXT' ELSE json_extract(j.value, '$.type') END,
        json_extract(j.value, '$.content'), json_extract(j.value, '$.parentId'), json_extract(j.value, '$.order'), NULL, ?, ?
      FROM CoursePublication p, json_each(p.payload, '$.contents') j WHERE p.id = ? AND p.courseId = ?
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, type = excluded.type, content = excluded.content,
        parentId = excluded.parentId, "order" = excluded."order", archivedAt = NULL, updatedAt = excluded.updatedAt
      WHERE CourseContent.courseId = excluded.courseId AND (CourseContent.title IS NOT excluded.title OR
        CourseContent.type IS NOT excluded.type OR CourseContent.content IS NOT excluded.content OR
        CourseContent.parentId IS NOT excluded.parentId OR CourseContent."order" IS NOT excluded."order" OR CourseContent.archivedAt IS NOT NULL)`)
      .bind(now, now, ...gate.values));
    const approvalInvalidated = Boolean(state.rewardEligible && state.rewardApprovalRevision !== input.nodes.fingerprint);
    statements.push(db.prepare(`UPDATE Course SET title = ?, description = ?, startDate = ?, endDate = ?, imageUrl = ?,
        activePublicationId = ?, updatedAt = ?,
        rewardEligible = CASE WHEN ? THEN 0 ELSE rewardEligible END,
        rewardApprovalRevision = CASE WHEN ? THEN NULL ELSE rewardApprovalRevision END
      WHERE id = ? AND EXISTS (${gate.sql})`)
      .bind(input.payload.title, input.payload.description,
        input.payload.startDate ? new Date(input.payload.startDate).toISOString().replace(/Z$/, '+00:00') : null,
        input.payload.endDate ? new Date(input.payload.endDate).toISOString().replace(/Z$/, '+00:00') : null,
        input.payload.imageUrl, input.publicationId, now, approvalInvalidated ? 1 : 0, approvalInvalidated ? 1 : 0,
        courseId, ...gate.values));
    statements.push(...d1CourseRewardStatements(db, { courseId, operationId: input.publicationId, now, gate, nodes: input.nodes,
      mode: { kind: 'publication', approvalInvalidated, scoringChangeReason: input.scoringChangeReason } }));
    statements.push(db.prepare(`UPDATE CourseDraft SET basePublicationId = ?, updatedAt = ?
      WHERE courseId = ? AND EXISTS (${gate.sql})`).bind(input.publicationId, now, courseId, ...gate.values));
    statements.push(db.prepare(`INSERT INTO PublicationRequest (courseId, requestId, actorId, requestDigest, publicationId, createdAt)
      SELECT courseId, ?, ?, ?, id, ? FROM CoursePublication WHERE id = ? AND courseId = ?`)
      .bind(input.requestId, actor.id, input.requestDigest, now, ...gate.values));
  }
  statements.push(db.prepare(receiptProjection).bind(actor.id, courseId, actor.role ?? '', input.requestId));
  const results = await db.batch(statements);
  return results[results.length - 1].results[0] as D1PublicationReceipt | undefined ?? null;
}
