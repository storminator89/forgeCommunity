import 'server-only';

import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { contentQuiz, courseContentRevision, courseLeaves, publicCourseContent, type ProgressContent } from '@/lib/server/course-progress';
import { d1CourseContentVersionToken } from '@/lib/server/d1-course-version';
import { CoursePathError, coursePathAccess, publicationPathNodes } from '@/lib/server/course-path';
import { chapterReleaseLabel } from '@/lib/course-release';
import { groupCourseContents } from '@/lib/server/group-course-contents';

export type D1LearningActor = { id: string; role?: string | null };
export type D1LearningContent = ProgressContent & { title: string; order: number; createdAt: string | number; updatedAt: string | number };
type StoredDate = string | number;
type SnapshotData = {
  user: { id: string; name: string | null; email: string; role: string; isTestAccount: number } | null;
  course: { id: string; title: string; description: string; instructorId: string; activePublicationId: string | null;
    rewardEligible: number; rewardApprovalRevision: string | null; createdAt: StoredDate; updatedAt: StoredDate; canEdit: number } | null;
  publication: { id: string; courseId: string; payload: string } | null;
  enrollment: { id: string; completedAt: StoredDate | null } | null;
  contents: D1LearningContent[];
  progress: { contentId: string; revision: string }[];
  assignmentPasses: { contentId: string }[];
  quizPasses: { contentId: string; revision: string }[];
  certificate: { id: string } | null;
  attempt: { id: string; courseId: string; publicationId: string | null; answerDigest: string; confidenceDigest: string | null;
    score: number; passed: number; questionIds: string[] } | null;
  recentFailures: { submittedAt: StoredDate }[];
};
export type D1CourseSnapshot = SnapshotData & {
  raw: string; actor: D1LearningActor; courseId: string; manifest: string; target: { contentId: string; submissionId: string };
};

export function courseLearningDatabase() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}

export function d1LearningDate(value: StoredDate): Date {
  const normalized = typeof value === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid stored course timestamp');
  return date;
}

// A bounded manifest selects only current evidence. It is derived from active
// content bytes and checked against the final single-snapshot read below.
const snapshotSql = `WITH viewer AS (SELECT id, name, email, role, isTestAccount FROM User WHERE id = ?1),
  course_row AS (SELECT c.*, (c.instructorId = v.id OR (?3 = 'ADMIN' AND v.role = 'ADMIN')) AS canEdit
    FROM Course c JOIN viewer v ON 1 = 1 WHERE c.id = ?2),
  authorized AS (SELECT * FROM course_row c WHERE c.canEdit OR (c.activePublicationId IS NOT NULL AND
    EXISTS (SELECT 1 FROM Enrollment e WHERE e.userId = ?1 AND e.courseId = c.id)))
  SELECT json_object(
    'user', (SELECT json_object('id', id, 'name', name, 'email', email, 'role', role, 'isTestAccount', isTestAccount) FROM viewer),
    'course', (SELECT json_object('id', id, 'title', title, 'description', description, 'instructorId', instructorId,
      'activePublicationId', activePublicationId, 'rewardEligible', rewardEligible, 'rewardApprovalRevision', rewardApprovalRevision,
      'createdAt', createdAt, 'updatedAt', updatedAt, 'canEdit', canEdit) FROM course_row),
    'publication', (SELECT json_object('id', p.id, 'courseId', p.courseId, 'payload', p.payload)
      FROM CoursePublication p JOIN authorized c ON p.id = c.activePublicationId),
    'enrollment', (SELECT json_object('id', e.id, 'completedAt', e.completedAt) FROM Enrollment e
      JOIN authorized c ON c.id = e.courseId WHERE e.userId = ?1),
    'contents', json((SELECT json_group_array(json_object('id', id, 'courseId', courseId, 'parentId', parentId,
      'title', title, 'type', type, 'content', content, 'order', "order", 'createdAt', createdAt, 'updatedAt', updatedAt))
      FROM (SELECT x.* FROM CourseContent x JOIN authorized c ON c.id = x.courseId WHERE x.archivedAt IS NULL ORDER BY x.id))),
    'progress', json((SELECT json_group_array(json_object('contentId', contentId, 'revision', revision))
      FROM (SELECT p.* FROM CourseContentProgress p JOIN authorized c ON c.id = p.courseId
        JOIN CourseContent x ON x.id = p.contentId AND x.courseId = p.courseId AND x.archivedAt IS NULL
        WHERE p.userId = ?1 ORDER BY p.contentId))),
    'assignmentPasses', json((SELECT json_group_array(json_object('contentId', contentId)) FROM (
      SELECT s.contentId FROM AssignmentSubmission s JOIN authorized c ON c.id = s.courseId
      JOIN json_each(?4) m ON json_extract(m.value, '$.id') = s.contentId AND json_extract(m.value, '$.revision') = s.revision
      JOIN AssignmentGradeDecision g ON g.id = (SELECT newest.id FROM AssignmentGradeDecision newest
        WHERE newest.submissionId = s.id ORDER BY newest.sequence DESC LIMIT 1)
      WHERE s.userId = ?1 AND s.attemptNumber = (SELECT MAX(newer.attemptNumber) FROM AssignmentSubmission newer
        WHERE newer.userId = s.userId AND newer.contentId = s.contentId AND newer.revision = s.revision)
      AND g.action = 'GRADED' AND g.score >= s.passingScore ORDER BY s.contentId))),
    'quizPasses', json((SELECT json_group_array(json_object('contentId', contentId, 'revision', revision)) FROM (
      SELECT DISTINCT a.contentId, a.revision FROM QuizAttempt a JOIN authorized c ON c.id = a.courseId
      JOIN json_each(?4) m ON json_extract(m.value, '$.id') = a.contentId AND json_extract(m.value, '$.revision') = a.revision
      WHERE a.userId = ?1 AND a.passed = 1 ORDER BY a.contentId, a.revision))),
    'certificate', (SELECT json_object('id', cert.id) FROM Certificate cert JOIN authorized c ON c.id = cert.courseId
      WHERE cert.userId = ?1 ORDER BY cert.issuedAt DESC, cert.id DESC LIMIT 1),
    'attempt', (SELECT json_object('id', a.id, 'courseId', a.courseId, 'publicationId', a.publicationId,
      'answerDigest', a.answerDigest, 'confidenceDigest', a.confidenceDigest, 'score', a.score, 'passed', a.passed,
      'questionIds', json((SELECT json_group_array(questionId) FROM (SELECT questionId FROM QuizAttemptItemEvidence
        WHERE attemptId = a.id ORDER BY questionId))))
      FROM QuizAttempt a JOIN authorized c ON c.id = a.courseId WHERE a.userId = ?1 AND a.contentId = ?5 AND a.submissionId = ?6),
    'recentFailures', json((SELECT json_group_array(json_object('submittedAt', submittedAt)) FROM (
      SELECT a.submittedAt FROM QuizAttempt a JOIN authorized c ON c.id = a.courseId
      JOIN json_each(?4) m ON json_extract(m.value, '$.id') = a.contentId AND json_extract(m.value, '$.revision') = a.revision
      WHERE a.userId = ?1 AND a.contentId = ?5 AND a.passed = 0
      ORDER BY CASE WHEN typeof(a.submittedAt) IN ('integer', 'real') THEN a.submittedAt
        ELSE (julianday(a.submittedAt) - 2440587.5) * 86400000 END DESC, a.id DESC LIMIT 5)))
  ) AS snapshot`;

function snapshotStatement(db: ReturnType<typeof courseLearningDatabase>, actor: D1LearningActor, courseId: string, manifest: string,
  target: { contentId: string; submissionId: string }) {
  return db.prepare(snapshotSql).bind(actor.id, courseId, actor.role ?? '', manifest, target.contentId, target.submissionId);
}
function revisionManifest(contents: D1LearningContent[]) {
  return JSON.stringify(contents.map(row => ({ id: row.id, revision: courseContentRevision(row) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The final read includes identity, authorization and all current evidence.
 * Never return its raw string, quiz digests or private content to a client. */
export async function readD1CourseSnapshot(db: ReturnType<typeof courseLearningDatabase>, actor: D1LearningActor, courseId: string,
  target = { contentId: '', submissionId: '' }): Promise<D1CourseSnapshot> {
  let manifest = '[]';
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await snapshotStatement(db, actor, courseId, manifest, target).first<{ snapshot: string }>();
    if (!result) throw new Error('Missing D1 course snapshot');
    const data = JSON.parse(result.snapshot) as SnapshotData;
    const next = revisionManifest(data.contents);
    if (next === manifest) return { ...data, raw: result.snapshot, actor, courseId, manifest, target };
    manifest = next;
  }
  throw new CoursePathError('Course changed concurrently; retry', 409);
}

export function assertD1LearnerSnapshot(snapshot: D1CourseSnapshot, options: { requireEnrollment?: boolean; requirePublication?: boolean } = {}) {
  if (!snapshot.user) throw new CoursePathError('Access denied to this course', 403);
  if (!snapshot.course) throw new CoursePathError('Course not found', 404);
  if (!snapshot.course.activePublicationId && (!snapshot.course.canEdit || options.requirePublication)) throw new CoursePathError('Course not found', 404);
  if ((!snapshot.course.canEdit || options.requireEnrollment) && !snapshot.enrollment) throw new CoursePathError('Enrollment required', 403);
}

/** Include topology, labels, type and private scoring bytes in projection parity. */
export function d1PublicationNodes(snapshot: D1CourseSnapshot) {
  const course = snapshot.course;
  if (!course?.activePublicationId) throw new CoursePathError('Course not found', 404);
  const publication = snapshot.publication;
  if (!publication || publication.id !== course.activePublicationId || publication.courseId !== course.id) throw new CoursePathError('Course publication is unavailable', 409);
  const nodes = publicationPathNodes(publication.payload);
  const payload = JSON.parse(publication.payload) as { title: unknown; description: unknown; contents: Array<{ id: string; title: string; type: string | null; content: string }> };
  const projected = new Map(snapshot.contents.map(row => [row.id, row]));
  if (projected.size !== nodes.length || payload.title !== course.title || payload.description !== course.description || nodes.some(node => {
    const row = projected.get(node.id);
    const published = payload.contents.find(content => content.id === node.id)!;
    return !row || row.parentId !== node.parentId || row.order !== node.order || row.title !== published.title ||
      row.type !== (published.type === 'QUIZ' ? 'TEXT' : published.type) || row.content !== published.content;
  })) throw new CoursePathError('Published course contents do not match the active publication', 409);
  return nodes;
}

export function d1CompletionState(snapshot: D1CourseSnapshot, now = Date.now()) {
  const nodes = d1PublicationNodes(snapshot);
  const leaves = courseLeaves(snapshot.contents);
  const progress = new Map(snapshot.progress.map(row => [row.contentId, row.revision]));
  const assignments = new Set(snapshot.assignmentPasses.map(row => row.contentId));
  const rawCompleted = leaves.filter(row => row.type === 'ASSIGNMENT'
    ? Boolean(parseAssignmentContent(row.content)?.prompt.trim() && assignments.has(row.id))
    : progress.get(row.id) === courseContentRevision(row)).map(row => row.id);
  const access = coursePathAccess(nodes, rawCompleted, now);
  const completedContentIds = leaves.filter(row => access.get(row.id)?.completed).map(row => row.id);
  const complete = leaves.length > 0 && completedContentIds.length === leaves.length;
  return { completedContentIds, complete, canIssueCertificate: complete && [...access.values()].every(gate => !gate.releaseLocked) };
}

export function assertD1ContentAccess(snapshot: D1CourseSnapshot, contentId: string, requirePrerequisites = true, now = Date.now()) {
  const nodes = d1PublicationNodes(snapshot);
  const gate = coursePathAccess(nodes, d1CompletionState(snapshot, now).completedContentIds, now).get(contentId);
  if (!gate) throw new CoursePathError('Content not found', 404);
  if (gate.releaseLocked) throw new CoursePathError(`Freigabe ab ${chapterReleaseLabel(gate.releaseOn!)}`, 423);
  if (requirePrerequisites && gate.missingPrerequisites.length) throw new CoursePathError('Complete the required earlier content before continuing', 423);
}

/** A false assertion aborts the whole D1 batch before any mutation. A no-op
 * conditional write would let later reward statements run and is insufficient. */
export function d1CourseSnapshotGuard(db: ReturnType<typeof courseLearningDatabase>, snapshot: D1CourseSnapshot) {
  return db.prepare(`SELECT CASE WHEN (SELECT snapshot FROM (${snapshotSql})) IS ?7
    THEN 1 ELSE json('D1_COURSE_SNAPSHOT_CONFLICT') END AS guarded`)
    .bind(snapshot.actor.id, snapshot.courseId, snapshot.actor.role ?? '', snapshot.manifest,
      snapshot.target.contentId, snapshot.target.submissionId, snapshot.raw);
}

export function isD1CourseSnapshotConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (/malformed JSON|D1_COURSE_SNAPSHOT_CONFLICT/i.test(current instanceof Error ? current.message : String(current))) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}

/** Append after the guard in the same batch as the learning mutation. */
export function d1CompletionStatements(db: ReturnType<typeof courseLearningDatabase>, snapshot: D1CourseSnapshot,
  state: ReturnType<typeof d1CompletionState>, now = new Date().toISOString()) {
  if (!state.complete) return [];
  return [
    db.prepare('UPDATE Enrollment SET completedAt = ? WHERE userId = ? AND courseId = ? AND completedAt IS NULL').bind(now, snapshot.actor.id, snapshot.courseId),
    db.prepare(`INSERT INTO CourseCompletionRecord (userId, courseId, courseTitle, completedAt)
      SELECT e.userId, e.courseId, c.title, e.completedAt FROM Enrollment e JOIN Course c ON c.id = e.courseId
      WHERE e.userId = ? AND e.courseId = ? AND e.completedAt IS NOT NULL
      ON CONFLICT(userId, courseId) DO UPDATE SET completedAt = excluded.completedAt`).bind(snapshot.actor.id, snapshot.courseId),
  ];
}

export function d1CourseDetail(snapshot: D1CourseSnapshot) {
  assertD1LearnerSnapshot(snapshot);
  const course = snapshot.course!;
  if (course.activePublicationId) d1PublicationNodes(snapshot);
  return { id: course.id, name: course.title, canEdit: Boolean(course.canEdit), description: course.description,
    createdAt: d1LearningDate(course.createdAt), updatedAt: d1LearningDate(course.updatedAt), activePublicationId: course.activePublicationId };
}

export function d1CourseContents(snapshot: D1CourseSnapshot) {
  assertD1LearnerSnapshot(snapshot);
  const nodes = snapshot.course!.activePublicationId ? d1PublicationNodes(snapshot) : [];
  const state = snapshot.course!.activePublicationId ? d1CompletionState(snapshot) : null;
  const access = state ? coursePathAccess(nodes, state.completedContentIds) : null;
  const paths = new Map(nodes.map(node => [node.id, node]));
  return groupCourseContents(snapshot.contents.map(row => {
    const path = paths.get(row.id);
    const gate = access?.get(row.id);
    const presented = { ...row, type: contentQuiz(row) ? 'QUIZ' : row.type ?? 'TEXT',
      createdAt: d1LearningDate(row.createdAt), updatedAt: d1LearningDate(row.updatedAt),
      publicationId: snapshot.course!.activePublicationId,
      contentVersionToken: snapshot.course!.activePublicationId ? d1CourseContentVersionToken(snapshot.course!.activePublicationId, row.id) : null };
    if (snapshot.course!.canEdit) return { ...presented, prerequisiteIds: path?.prerequisiteIds ?? [], releaseOn: path?.releaseOn ?? null };
    if (gate?.locked) return { ...presented, content: '', contentVersionToken: null, locked: true,
      releaseOn: gate.releaseOn, releaseLocked: gate.releaseLocked, prerequisiteIds: gate.prerequisiteIds, missingPrerequisites: gate.missingPrerequisites };
    return { ...publicCourseContent(presented), locked: false, releaseOn: gate?.releaseOn ?? null,
      releaseLocked: false, prerequisiteIds: gate?.prerequisiteIds ?? [], missingPrerequisites: [] };
  }));
}

// All capacity/price/completion/account predicates are evaluated by SQLite in
// one atomic batch. A last-seat race cannot bypass the insertion predicate.
export async function mutateD1CourseEnrollment(userId: string, courseId: string, join: boolean) {
  const db = courseLearningDatabase();
  const before = db.prepare(`SELECT c.price, c.maxStudents, e.id AS enrollmentId, e.completedAt,
    (SELECT COUNT(*) FROM Enrollment n WHERE n.courseId = c.id) AS participants
    FROM Course c JOIN User u ON u.id = ?1 LEFT JOIN Enrollment e ON e.courseId = c.id AND e.userId = u.id
    JOIN CoursePublication p ON p.id = c.activePublicationId AND p.courseId = c.id WHERE c.id = ?2`).bind(userId, courseId);
  const mutation = join ? db.prepare(`INSERT INTO Enrollment (id, userId, courseId, enrolledAt)
    SELECT ?, u.id, c.id, ? FROM User u JOIN Course c ON c.id = ? JOIN CoursePublication p ON p.id = c.activePublicationId AND p.courseId = c.id
    WHERE u.id = ? AND (c.price IS NULL OR c.price <= 0)
      AND (c.maxStudents IS NULL OR (SELECT COUNT(*) FROM Enrollment n WHERE n.courseId = c.id) < c.maxStudents)
    ON CONFLICT(userId, courseId) DO NOTHING`).bind(`enrollment_${randomUUID()}`, new Date().toISOString(), courseId, userId)
    : db.prepare(`DELETE FROM Enrollment WHERE userId = ? AND courseId = ? AND completedAt IS NULL
      AND EXISTS (SELECT 1 FROM User u JOIN Course c ON c.id = ? JOIN CoursePublication p ON p.id = c.activePublicationId AND p.courseId = c.id
        WHERE u.id = ? AND (c.price IS NULL OR c.price <= 0))`).bind(userId, courseId, courseId, userId);
  const results = await db.batch([before, mutation,
    db.prepare(`SELECT COUNT(*) AS participants, EXISTS (SELECT 1 FROM Enrollment own WHERE own.userId = ?1 AND own.courseId = ?2) AS enrolled
      FROM Enrollment WHERE courseId = ?2`).bind(userId, courseId)]);
  const row = results[0].results[0] as { price: number | null; maxStudents: number | null; enrollmentId: string | null; completedAt: StoredDate | null; participants: number } | undefined;
  if (!row) throw new CoursePathError('Course not found', 404);
  if (join && row.enrollmentId) return { participants: row.participants, created: false };
  if (row.price !== null && row.price > 0) throw new CoursePathError(join ? 'Paid courses require a separate checkout' : 'Paid enrollment cannot be cancelled here', 403);
  if (join && row.maxStudents !== null && row.participants >= row.maxStudents) throw new CoursePathError('Course is full', 409);
  if (!join && row.completedAt !== null) throw new CoursePathError('Completed course enrollment cannot be removed', 409);
  const after = results[2].results[0] as { participants: number; enrolled: number };
  if (Boolean(after.enrolled) !== join) throw new CoursePathError('Enrollment changed concurrently; retry', 409);
  return { participants: after.participants, created: join && results[1].meta.changes === 1 };
}
