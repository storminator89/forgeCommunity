import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';

type CreationInput = {
  actorId: string; requestId: string | null; payload: string; digest: string;
  price: number | null; currency: string | null; maxStudents: number | null;
};

type CreatedCourseRow = {
  id: string; title: string; description: string; instructorId: string;
  startDate: string | number | null; endDate: string | number | null;
  price: number | null; currency: string | null; maxStudents: number | null;
  rewardEligible: number; rewardApprovalRevision: string | null; imageUrl: string | null;
  activePublicationId: string | null; createdAt: string | number; updatedAt: string | number;
  instructorName: string; draftPayload: string; draftDigest: string;
};

export type D1AuthorDraftRow = {
  id: string; title: string; description: string; startDate: string | number | null;
  endDate: string | number | null; imageUrl: string | null; instructorId: string;
  activePublicationId: string | null; revision: number | null; digest: string | null;
  payload: string | null; basePublicationId: string | null;
  publicationId: string | null; publicationCourseId: string | null;
  publicationSequence: number | null; publicationDigest: string | null;
  publicationPayload: string | null; rewardEligible: number; rewardApprovalRevision: string | null;
};

export function d1CourseDatabase() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}

export const d1AuthorProjection = `SELECT c.id, c.title, c.description, c.startDate, c.endDate,
  c.imageUrl, c.instructorId, c.activePublicationId, c.rewardEligible, c.rewardApprovalRevision,
  d.revision, d.digest, d.payload, d.basePublicationId,
  p.id AS publicationId, p.courseId AS publicationCourseId,
  p.sequence AS publicationSequence, p.digest AS publicationDigest, p.payload AS publicationPayload
  FROM Course c JOIN User u ON u.id = ?
  LEFT JOIN CourseDraft d ON d.courseId = c.id
  LEFT JOIN CoursePublication p ON p.id = c.activePublicationId`;

/** D1 batch is the atomic boundary. Never emulate an interactive callback. */
export async function createD1CourseDraft(input: CreationInput) {
  const db = d1CourseDatabase();
  const id = input.requestId
    ? `course_${createHash('sha256').update(JSON.stringify([input.actorId, input.requestId])).digest('hex')}`
    : `course_${randomUUID()}`;
  const now = new Date().toISOString().replace(/Z$/, '+00:00');
  const results = await db.batch([
    db.prepare(`INSERT INTO Course
      (id, title, description, instructorId, price, currency, maxStudents, createdAt, updatedAt)
      SELECT ?, 'Unveröffentlichter Kurs', '', u.id, ?, ?, ?, ?, ? FROM User u WHERE u.id = ?
      ON CONFLICT(id) DO NOTHING`).bind(id, input.price, input.currency, input.maxStudents, now, now, input.actorId),
    db.prepare(`INSERT INTO CourseDraft
      (courseId, revision, payload, digest, lastEditorId, updatedAt)
      SELECT c.id, 0, ?, ?, ?, ? FROM Course c WHERE c.id = ? AND c.instructorId = ?
      ON CONFLICT(courseId) DO NOTHING`).bind(input.payload, input.digest, input.actorId, now, id, input.actorId),
    db.prepare(`SELECT c.*, u.name AS instructorName, d.payload AS draftPayload, d.digest AS draftDigest
      FROM Course c JOIN User u ON u.id = c.instructorId JOIN CourseDraft d ON d.courseId = c.id
      WHERE c.id = ? AND c.instructorId = ?`).bind(id, input.actorId),
  ]);
  const row = results[2].results[0] as CreatedCourseRow | undefined;
  if (!row) return { kind: 'forbidden' as const };
  // An ambiguous network failure can be retried with the same key. A changed
  // payload or a draft edited since creation must never silently overwrite it.
  if (row.draftPayload !== input.payload || row.draftDigest !== input.digest ||
      row.price !== input.price || row.currency !== input.currency || row.maxStudents !== input.maxStudents) {
    return { kind: 'conflict' as const };
  }
  const { instructorName, draftPayload: _payload, draftDigest: _digest, ...course } = row;
  return { kind: 'created' as const, course: { ...course, rewardEligible: Boolean(course.rewardEligible),
    createdAt: new Date(course.createdAt), updatedAt: new Date(course.updatedAt),
    startDate: course.startDate === null ? null : new Date(course.startDate),
    endDate: course.endDate === null ? null : new Date(course.endDate),
    instructor: { name: instructorName } } };
}

/** Account existence and every private row are read in one D1 snapshot. */
export async function listD1AuthorDrafts(actorId: string) {
  const db = d1CourseDatabase();
  const results = await db.batch([
    db.prepare('SELECT id FROM User WHERE id = ?').bind(actorId),
    db.prepare(`${d1AuthorProjection} WHERE c.instructorId = u.id ORDER BY c.updatedAt DESC`).bind(actorId),
  ]);
  return { accountExists: results[0].results.length === 1, rows: results[1].results as D1AuthorDraftRow[] };
}

/** The current role and ownership predicate are part of the protected query. */
export async function readD1AuthorDraft(courseId: string, actor: { id: string; role?: string | null }) {
  const result = await d1CourseDatabase().prepare(`${d1AuthorProjection}
    WHERE c.id = ? AND (c.instructorId = u.id OR (? = 'ADMIN' AND u.role = 'ADMIN'))`)
    .bind(actor.id, courseId, actor.role ?? '').all<D1AuthorDraftRow>();
  return result.results[0] ?? null;
}
