import 'server-only';

import { courseContentRevision } from '@/lib/server/course-progress';
import { AssignmentError } from '@/lib/server/assignment-errors';
import { courseLearningDatabase, type D1CourseSnapshot, type D1LearningActor } from '@/lib/server/d1-course-learning';

export type AssignmentSubmissionState = {
  id: string; userId: string; courseId: string; contentId: string; publicationId: string;
  revision: string; passingScore: number; requestId: string; responseDigest: string;
  attemptNumber: number; submittedAt: string | number;
};
export type AssignmentDecisionState = {
  id: string; submissionId: string; requestId: string; graderId: string;
  action: 'GRADED' | 'WITHDRAWN'; score: number | null; feedback: string | null;
  sequence: number; createdAt: string | number;
};
type TargetData = {
  account: { id: string; role: string } | null;
  course: { id: string; instructorId: string; activePublicationId: string | null } | null;
  enrolled: number; canGrade: number; submission: AssignmentSubmissionState | null;
  current: AssignmentSubmissionState | null; maxAttempt: number; passingAt: string | number | null;
  decision: AssignmentDecisionState | null; submitReceipt: AssignmentSubmissionState | null;
  gradeReceipt: AssignmentDecisionState | null;
};
export type AssignmentTargetInput = {
  mode: 'submit' | 'grade'; actor: D1LearningActor; courseId: string; contentId: string;
  revision: string; requestId: string; submissionId: string;
};
export type AssignmentTargetState = TargetData & { raw: string; input: AssignmentTargetInput };
type Database = ReturnType<typeof courseLearningDatabase>;
const MAX_FIELD_BYTES = 1024;
const MAX_TARGET_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BYTES = 1900 * 1024;
const MAX_PUBLICATION_BYTES = 512 * 1024;
// Covers 500-node proof revision strings, collection/scalar/row keys and
// punctuation. Repeated proof IDs have a separate exact escaped-byte charge;
// all other raw metadata/evidence below additionally gets sixfold escaping.
const SNAPSHOT_JSON_OVERHEAD = 200 * 1024;

const bytes = (fields: string[]) => fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)), 0)`).join(' + ');
const submissionFields = (alias: string) => ['id', 'userId', 'courseId', 'contentId', 'publicationId', 'revision', 'requestId', 'responseDigest', 'submittedAt', 'passingScore', 'attemptNumber'].map(key => `${alias}.${key}`);
const decisionFields = (alias: string) => ['id', 'submissionId', 'requestId', 'graderId', 'action', 'feedback', 'createdAt', 'score', 'sequence'].map(key => `${alias}.${key}`);
const submissionJson = (alias: string) => `json_object('id', ${alias}.id, 'userId', ${alias}.userId,
  'courseId', ${alias}.courseId, 'contentId', ${alias}.contentId, 'publicationId', ${alias}.publicationId,
  'revision', ${alias}.revision, 'passingScore', ${alias}.passingScore, 'requestId', ${alias}.requestId,
  'responseDigest', ${alias}.responseDigest, 'attemptNumber', ${alias}.attemptNumber, 'submittedAt', ${alias}.submittedAt)`;
const decisionJson = (alias: string) => `json_object('id', ${alias}.id, 'submissionId', ${alias}.submissionId,
  'requestId', ${alias}.requestId, 'graderId', ${alias}.graderId, 'action', ${alias}.action,
  'score', ${alias}.score, 'feedback', ${alias}.feedback, 'sequence', ${alias}.sequence, 'createdAt', ${alias}.createdAt)`;

/** Constant-size target evidence supplements the course snapshot, which only
 * includes passing assignment IDs. In particular a pending/failing attempt,
 * a null receipt, and an ungraded decision must participate in the CAS. */
const targetSql = `WITH
  viewer AS MATERIALIZED (SELECT id, role FROM User WHERE id = ?1),
  course_row AS MATERIALIZED (SELECT id, instructorId, CASE WHEN ?6 = '' THEN NULL ELSE activePublicationId END AS activePublicationId
    FROM Course WHERE id = ?2 AND (?4 = 'grade' OR ?6 <> '')),
  authority AS MATERIALIZED (SELECT
    EXISTS (SELECT 1 FROM Enrollment WHERE userId = ?1 AND courseId = ?2) AS enrolled,
    EXISTS (SELECT 1 FROM viewer v, course_row c WHERE c.instructorId = v.id OR (?3 = 'ADMIN' AND v.role = 'ADMIN')) AS canGrade),
  authorized AS MATERIALIZED (SELECT 1 FROM viewer, authority WHERE CASE WHEN ?4 = 'submit' THEN enrolled ELSE canGrade END),
  given_submission AS MATERIALIZED (SELECT s.* FROM AssignmentSubmission s, authorized
    WHERE ?4 = 'grade' AND s.id = ?8 AND s.courseId = ?2),
  subject AS MATERIALIZED (SELECT CASE WHEN ?4 = 'submit' THEN ?1 ELSE (SELECT userId FROM given_submission) END AS userId,
    CASE WHEN ?4 = 'submit' THEN ?5 ELSE (SELECT contentId FROM given_submission) END AS contentId),
  current_submission AS MATERIALIZED (SELECT s.* FROM AssignmentSubmission s, subject x, authorized
    WHERE ?6 <> '' AND s.userId = x.userId AND s.courseId = ?2 AND s.contentId = x.contentId AND s.revision = ?6
    ORDER BY s.attemptNumber DESC LIMIT 1),
  latest_decision AS MATERIALIZED (SELECT g.* FROM AssignmentGradeDecision g, authorized
    WHERE ?6 <> '' AND g.submissionId = CASE WHEN ?4 = 'submit' THEN (SELECT id FROM current_submission) ELSE (SELECT id FROM given_submission) END
    ORDER BY g.sequence DESC LIMIT 1),
  decision_submission AS MATERIALIZED (SELECT s.* FROM AssignmentSubmission s, authorized
    WHERE ?6 <> '' AND s.id = CASE WHEN ?4 = 'submit' THEN (SELECT id FROM current_submission) ELSE (SELECT id FROM given_submission) END),
  submit_receipt AS MATERIALIZED (SELECT s.* FROM AssignmentSubmission s, authorized
    WHERE ?4 = 'submit' AND s.userId = ?1 AND s.contentId = ?5 AND s.requestId = ?7),
  grade_receipt AS MATERIALIZED (SELECT g.* FROM AssignmentGradeDecision g, authorized
    WHERE ?4 = 'grade' AND g.submissionId = (SELECT id FROM given_submission) AND g.requestId = ?7),
  first_pass AS MATERIALIZED (SELECT g.createdAt FROM AssignmentGradeDecision g JOIN decision_submission s ON s.id = g.submissionId
      WHERE g.action = 'GRADED' AND g.score >= s.passingScore
        AND EXISTS (SELECT 1 FROM latest_decision d WHERE d.action = 'GRADED' AND d.score >= s.passingScore)
        AND g.sequence > COALESCE((SELECT MAX(b.sequence) FROM AssignmentGradeDecision b
          WHERE b.submissionId = s.id AND (b.action = 'WITHDRAWN' OR b.score < s.passingScore)), 0)
      ORDER BY g.sequence ASC LIMIT 1),
  global_attempt AS MATERIALIZED (SELECT COALESCE(MAX(s.attemptNumber), 0) AS value FROM AssignmentSubmission s, subject x, authorized
    WHERE ?6 <> '' AND s.userId = x.userId AND s.contentId = x.contentId),
  sizes AS MATERIALIZED (SELECT
    EXISTS (SELECT 1 FROM viewer v WHERE ${bytes(['v.id', 'v.role'])} > 2048)
    OR EXISTS (SELECT 1 FROM course_row c WHERE ${bytes(['c.id', 'c.instructorId', 'c.activePublicationId'])} > 3072)
    OR EXISTS (SELECT 1 FROM given_submission s WHERE ${bytes(submissionFields('s'))} > 12288)
    OR EXISTS (SELECT 1 FROM current_submission s WHERE ${bytes(submissionFields('s'))} > 12288)
    OR EXISTS (SELECT 1 FROM submit_receipt s WHERE ${bytes(submissionFields('s'))} > 12288)
    OR EXISTS (SELECT 1 FROM latest_decision g WHERE ${bytes(decisionFields('g'))} > 12288)
    OR EXISTS (SELECT 1 FROM grade_receipt g WHERE ${bytes(decisionFields('g'))} > 12288)
    OR EXISTS (SELECT 1 FROM first_pass WHERE length(CAST(createdAt AS BLOB)) > 35)
    OR EXISTS (SELECT 1 FROM global_attempt WHERE length(CAST(value AS BLOB)) > 32) AS oversize)
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM viewer) THEN json_object('error', 401)
    WHEN ?4 = 'grade' AND NOT EXISTS (SELECT 1 FROM course_row) THEN json_object('error', 404)
    WHEN ?4 = 'grade' AND NOT (SELECT canGrade FROM authority) THEN json_object('error', 403)
    WHEN ?4 = 'submit' AND NOT (SELECT enrolled FROM authority) THEN json_object('error', 403)
    WHEN (SELECT oversize FROM sizes) THEN json_object('oversize', 1) ELSE json_object(
    'account', (SELECT json_object('id', id, 'role', role) FROM viewer),
    'course', (SELECT json_object('id', id, 'instructorId', instructorId, 'activePublicationId', activePublicationId) FROM course_row),
    'enrolled', (SELECT enrolled FROM authority), 'canGrade', (SELECT canGrade FROM authority),
    'submission', (SELECT ${submissionJson('s')} FROM given_submission s),
    'current', (SELECT ${submissionJson('s')} FROM current_submission s),
    'maxAttempt', (SELECT value FROM global_attempt),
    'decision', (SELECT ${decisionJson('g')} FROM latest_decision g),
    'passingAt', (SELECT createdAt FROM first_pass),
    'submitReceipt', (SELECT ${submissionJson('s')} FROM submit_receipt s),
    'gradeReceipt', (SELECT ${decisionJson('g')} FROM grade_receipt g)
  ) END AS state`;

function targetValues(input: AssignmentTargetInput) {
  return [input.actor.id, input.courseId, input.actor.role === 'ADMIN' ? 'ADMIN' : '', input.mode,
    input.contentId, input.revision, input.requestId, input.submissionId];
}

export function assertAssignmentBind(value: string) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_FIELD_BYTES) {
    throw new AssignmentError('Ungültige Anfrage.', 400);
  }
}

function validInteger(value: number, minimum: number) {
  return Number.isSafeInteger(value) && value >= minimum && value < Number.MAX_SAFE_INTEGER;
}
export function assignmentDate(value: string | number): Date {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 8640000000000000)) ||
      (typeof value === 'string' && (value.length > 35 ||
        !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|\+00:00)?$/.test(value)))) {
    throw new AssignmentError('Gespeicherter Zeitpunkt ist ungültig.', 409);
  }
  const normalized = typeof value === 'string' && !/(?:Z|\+00:00)$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || (typeof value === 'string' &&
      date.toISOString().slice(0, 19) !== value.slice(0, 19).replace(' ', 'T'))) {
    throw new AssignmentError('Gespeicherter Zeitpunkt ist ungültig.', 409);
  }
  return date;
}
function validateSubmission(row: AssignmentSubmissionState | null) {
  if (!row) return;
  if (!validInteger(row.attemptNumber, 1) || !validInteger(row.passingScore, 1) || row.passingScore > 100 ||
      typeof row.revision !== 'string' || typeof row.responseDigest !== 'string') {
    throw new AssignmentError('Gespeicherte Abgabe ist ungültig.', 409);
  }
  assignmentDate(row.submittedAt);
}
function validateDecision(row: AssignmentDecisionState | null) {
  if (!row) return;
  if (!validInteger(row.sequence, 1) || !['GRADED', 'WITHDRAWN'].includes(row.action) ||
      (row.action === 'GRADED' && (!Number.isInteger(row.score) || Number(row.score) < 0 || Number(row.score) > 100)) ||
      (row.action === 'WITHDRAWN' && row.score !== null) ||
      (row.feedback !== null && (typeof row.feedback !== 'string' || row.feedback.length > 2000))) {
    throw new AssignmentError('Gespeicherte Bewertung ist ungültig.', 409);
  }
  assignmentDate(row.createdAt);
}

export async function readAssignmentTarget(db: Database, input: AssignmentTargetInput): Promise<AssignmentTargetState> {
  for (const value of targetValues(input)) assertAssignmentBind(value);
  const row = await db.prepare(targetSql).bind(...targetValues(input)).first<{ state: string }>();
  if (!row || Buffer.byteLength(row.state, 'utf8') > MAX_TARGET_BYTES) throw new AssignmentError('Aufgabendaten sind zu groß.', 413);
  const state = JSON.parse(row.state) as TargetData & { oversize?: number; error?: number };
  if (state.error) throw new AssignmentError(state.error === 401 ? 'Unauthorized' : state.error === 404 ? 'Course not found' : input.mode === 'submit' ? 'Enrollment required' : 'Unauthorized', state.error);
  if (state.oversize) throw new AssignmentError('Aufgabendaten sind zu groß.', 413);
  if (!validInteger(state.maxAttempt, 0)) throw new AssignmentError('Gespeicherte Versuchsnummer ist ungültig.', 409);
  for (const submission of [state.submission, state.current, state.submitReceipt]) validateSubmission(submission);
  for (const decision of [state.decision, state.gradeReceipt]) validateDecision(decision);
  if (state.passingAt !== null) assignmentDate(state.passingAt);
  return { ...state, raw: row.state, input };
}

/** This MUST precede every dependent mutation in the same native D1 batch.
 * A failed condition throws, so progress/rewards cannot run after a no-op CAS. */
export function assignmentTargetGuard(db: Database, state: AssignmentTargetState) {
  return db.prepare(`SELECT CASE WHEN (SELECT state FROM (${targetSql})) IS ?9
    THEN 1 ELSE json('D1_ASSIGNMENT_TARGET_CONFLICT') END AS guarded`)
    .bind(...targetValues(state.input), state.raw);
}

/** This is the exact private projection used by d1CourseSnapshotGuard in the
 * published source. Keeping its serialization unchanged lets the shared guard
 * fence this bounded read. It is wrapped below, never returned to a client. */
const privateCourseSnapshotSql = `WITH viewer AS (SELECT id, name, email, role, isTestAccount FROM User WHERE id = ?1),
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
    'assignmentPending', json((SELECT json_group_array(json_object('contentId', contentId)) FROM (
      SELECT x.id AS contentId FROM CourseContent x JOIN authorized c ON c.id = x.courseId
      JOIN Enrollment e ON e.userId = ?1 AND e.courseId = c.id
      JOIN json_each(?4) m ON json_extract(m.value, '$.id') = x.id
      WHERE c.activePublicationId IS NOT NULL AND x.archivedAt IS NULL AND x.type = 'ASSIGNMENT'
        AND NOT EXISTS (SELECT 1 FROM CourseContent child WHERE child.parentId = x.id AND child.archivedAt IS NULL)
        AND EXISTS (SELECT 1 FROM AssignmentSubmission s
          WHERE s.userId = ?1 AND s.courseId = c.id AND s.contentId = x.id
            AND s.revision = json_extract(m.value, '$.revision')
            AND s.attemptNumber = (SELECT MAX(newer.attemptNumber) FROM AssignmentSubmission newer
              WHERE newer.userId = s.userId AND newer.courseId = s.courseId
                AND newer.contentId = s.contentId AND newer.revision = s.revision)
            AND NOT EXISTS (SELECT 1 FROM AssignmentGradeDecision g WHERE g.submissionId = s.id))
      ORDER BY x.id))),
    'quizPasses', json((SELECT json_group_array(json_object('contentId', contentId, 'revision', revision)) FROM (
      SELECT DISTINCT a.contentId, a.revision FROM QuizAttempt a JOIN authorized c ON c.id = a.courseId
      JOIN json_each(?4) m ON json_extract(m.value, '$.id') = a.contentId AND json_extract(m.value, '$.revision') = a.revision
      WHERE a.userId = ?1 AND a.passed = 1 ORDER BY a.contentId, a.revision))),
    'latestQuizAttempts', json((SELECT json_group_array(json_object('contentId', contentId, 'publicationId', publicationId,
      'score', score, 'passed', passed, 'submittedAt', submittedAt)) FROM (SELECT * FROM (
      SELECT own.*, ROW_NUMBER() OVER (PARTITION BY own.contentId ORDER BY
        CASE WHEN typeof(own.submittedAt) IN ('integer', 'real') THEN own.submittedAt
          ELSE (julianday(own.submittedAt) - 2440587.5) * 86400000 END DESC, own.id DESC) AS position
      FROM QuizAttempt own JOIN authorized c ON c.id = own.courseId AND c.activePublicationId = own.publicationId
      JOIN Enrollment e ON e.userId = own.userId AND e.courseId = own.courseId
      JOIN json_each(?4) m ON json_extract(m.value, '$.id') = own.contentId AND json_extract(m.value, '$.revision') = own.revision
      WHERE own.userId = ?1) WHERE position = 1 ORDER BY contentId))),
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

/** Source budgets and the JSON row budget are part of the SAME read statement.
 * CASE prevents an oversized source from being projected; the outer CASE keeps
 * even unexpectedly expensive JSON escaping from reaching D1's row transport.
 * No separate size preflight can race a concurrent publication. */
const boundedCourseSnapshotSql = `WITH
  latest_quiz_rows AS MATERIALIZED (SELECT * FROM (SELECT own.*,
    ROW_NUMBER() OVER (PARTITION BY own.contentId ORDER BY
      CASE WHEN typeof(own.submittedAt) IN ('integer', 'real') THEN own.submittedAt
        ELSE (julianday(own.submittedAt) - 2440587.5) * 86400000 END DESC, own.id DESC) AS position
    FROM QuizAttempt own JOIN Course c ON c.id = own.courseId AND c.activePublicationId = own.publicationId
    JOIN Enrollment e ON e.userId = own.userId AND e.courseId = own.courseId
    JOIN json_each(?4) m ON json_extract(m.value, '$.id') = own.contentId AND json_extract(m.value, '$.revision') = own.revision
    WHERE own.userId = ?1 AND own.courseId = ?2) WHERE position = 1),
  target_quiz AS MATERIALIZED (SELECT a.* FROM QuizAttempt a WHERE a.userId = ?1 AND a.courseId = ?2
    AND a.contentId = ?5 AND a.submissionId = ?6),
  recent_failures AS MATERIALIZED (SELECT a.submittedAt FROM QuizAttempt a
    JOIN json_each(?4) m ON json_extract(m.value, '$.id') = a.contentId AND json_extract(m.value, '$.revision') = a.revision
    WHERE a.userId = ?1 AND a.courseId = ?2 AND a.contentId = ?5 AND a.passed = 0
    ORDER BY CASE WHEN typeof(a.submittedAt) IN ('integer', 'real') THEN a.submittedAt
      ELSE (julianday(a.submittedAt) - 2440587.5) * 86400000 END DESC, a.id DESC LIMIT 5),
  source_budget AS MATERIALIZED (SELECT
    (SELECT COUNT(*) FROM CourseContent WHERE courseId = ?2 AND archivedAt IS NULL) AS contentCount,
    (SELECT length(CAST(p.payload AS BLOB)) FROM Course c JOIN CoursePublication p ON p.id = c.activePublicationId WHERE c.id = ?2) AS publicationBytes,
    (SELECT ${bytes(['p.id', 'p.courseId'])} FROM Course c JOIN CoursePublication p ON p.id = c.activePublicationId WHERE c.id = ?2) AS publicationMetadataBytes,
    (SELECT COALESCE(SUM(${bytes(['x.id', 'x.courseId', 'x.parentId', 'x.title', 'x.type', 'x.content', 'x."order"', 'x.createdAt', 'x.updatedAt'])}), 0)
      FROM CourseContent x WHERE x.courseId = ?2 AND x.archivedAt IS NULL) AS contentBytes,
    (SELECT COALESCE(MAX(${bytes(['x.id', 'x.courseId', 'x.parentId', 'x.title', 'x.type', 'x.content', 'x."order"', 'x.createdAt', 'x.updatedAt'])}), 0)
      FROM CourseContent x WHERE x.courseId = ?2 AND x.archivedAt IS NULL) AS largestContentRow,
    EXISTS (SELECT 1 FROM CourseContent x WHERE x.courseId = ?2 AND x.archivedAt IS NULL AND
      (length(CAST(x.id AS BLOB)) > 100 OR COALESCE(length(CAST(x.parentId AS BLOB)), 0) > 100
        OR length(CAST(x.createdAt AS BLOB)) > 35 OR length(CAST(x.updatedAt AS BLOB)) > 35
        OR typeof(x.content) <> 'text' OR typeof(x.id) <> 'text')) AS invalidContentMetadata,
    (SELECT ${bytes(['u.id', 'u.name', 'u.email', 'u.role', 'u.isTestAccount'])} FROM User u WHERE u.id = ?1) AS accountBytes,
    (SELECT ${bytes(['c.id', 'c.title', 'c.description', 'c.instructorId', 'c.activePublicationId', 'c.createdAt', 'c.updatedAt', 'c.rewardEligible', 'c.rewardApprovalRevision'])}
      FROM Course c WHERE c.id = ?2) AS courseBytes,
    (SELECT COALESCE(SUM(${bytes(['p.contentId', 'p.revision'])}), 0) FROM CourseContentProgress p
      JOIN CourseContent x ON x.id = p.contentId AND x.courseId = p.courseId AND x.archivedAt IS NULL
      WHERE p.userId = ?1 AND p.courseId = ?2) AS progressBytes,
    (SELECT ${bytes(['e.id', 'e.completedAt'])} FROM Enrollment e WHERE e.userId = ?1 AND e.courseId = ?2) AS enrollmentBytes,
    (SELECT length(CAST(cert.id AS BLOB)) FROM Certificate cert WHERE cert.userId = ?1 AND cert.courseId = ?2
      ORDER BY cert.issuedAt DESC, cert.id DESC LIMIT 1) AS certificateBytes,
    (SELECT COALESCE(SUM(${bytes(['q.contentId', 'q.publicationId', 'q.score', 'q.passed', 'q.submittedAt'])}), 0)
      FROM latest_quiz_rows q) AS latestQuizBytes,
    (SELECT ${bytes(['a.id', 'a.courseId', 'a.publicationId', 'a.answerDigest', 'a.confidenceDigest', 'a.score', 'a.passed'])}
      FROM target_quiz a) AS targetQuizBytes,
    (SELECT COUNT(*) FROM QuizAttemptItemEvidence q JOIN target_quiz a ON a.id = q.attemptId) AS evidenceCount,
    (SELECT COALESCE(SUM(length(CAST(q.questionId AS BLOB))), 0) FROM QuizAttemptItemEvidence q JOIN target_quiz a ON a.id = q.attemptId) AS evidenceBytes,
    (SELECT COALESCE(SUM(length(CAST(submittedAt AS BLOB))), 0) FROM recent_failures) AS recentFailureBytes),
  budget AS MATERIALIZED (SELECT b.*, CASE WHEN b.contentCount <= 500 AND b.contentBytes <= ${MAX_PUBLICATION_BYTES + 256 * 1024}
      AND b.largestContentRow <= 307200 AND b.invalidContentMetadata = 0
      AND COALESCE(b.publicationBytes, 0) <= ${MAX_PUBLICATION_BYTES}
      AND NOT EXISTS (SELECT 1 FROM Course c JOIN CoursePublication p ON p.id = c.activePublicationId
        WHERE c.id = ?2 AND (typeof(p.payload) <> 'text' OR instr(CAST(p.payload AS BLOB), x'00') <> 0 OR NOT json_valid(p.payload)))
    THEN ${SNAPSHOT_JSON_OVERHEAD} + 6 * (COALESCE(b.accountBytes, 0) + COALESCE(b.courseBytes, 0) + b.progressBytes
      + COALESCE(b.enrollmentBytes, 0) + COALESCE(b.certificateBytes, 0) + b.latestQuizBytes
      + COALESCE(b.targetQuizBytes, 0) + b.evidenceBytes + b.recentFailureBytes)
      + COALESCE((SELECT length(CAST(json_quote(p.payload) AS BLOB)) FROM Course c
        JOIN CoursePublication p ON p.id = c.activePublicationId WHERE c.id = ?2), 0)
      + 3 * (SELECT COALESCE(SUM(length(CAST(json_quote(x.id) AS BLOB))), 0)
        FROM CourseContent x WHERE x.courseId = ?2 AND x.archivedAt IS NULL)
      + (SELECT COALESCE(SUM(length(CAST(json_object('id', x.id, 'courseId', x.courseId, 'parentId', x.parentId,
          'title', x.title, 'type', x.type, 'content', x.content, 'order', x."order", 'createdAt', x.createdAt, 'updatedAt', x.updatedAt) AS BLOB))), 0)
        FROM CourseContent x WHERE x.courseId = ?2 AND x.archivedAt IS NULL)
    ELSE ${MAX_SNAPSHOT_BYTES + 1} END AS encodedBytes FROM source_budget b),
  projected AS MATERIALIZED (SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM User WHERE id = ?1) THEN json_object('error', 401)
    WHEN NOT EXISTS (SELECT 1 FROM Course WHERE id = ?2) THEN json_object('error', 404)
    WHEN NOT EXISTS (SELECT 1 FROM Course c JOIN User u ON u.id = ?1 WHERE c.id = ?2
      AND (c.instructorId = u.id OR (?3 = 'ADMIN' AND u.role = 'ADMIN')
        OR EXISTS (SELECT 1 FROM Enrollment e WHERE e.userId = u.id AND e.courseId = c.id))) THEN json_object('error', 403)
    WHEN contentCount <= 500 AND encodedBytes <= ${MAX_SNAPSHOT_BYTES}
    AND COALESCE(publicationBytes, 0) <= ${MAX_PUBLICATION_BYTES} AND COALESCE(publicationMetadataBytes, 0) <= 2048
    AND contentBytes <= ${MAX_PUBLICATION_BYTES + 256 * 1024}
    AND COALESCE(accountBytes, 0) <= 8192 AND COALESCE(courseBytes, 0) <= 65536
    AND progressBytes <= 262144 AND COALESCE(enrollmentBytes, 0) <= 2048 AND COALESCE(certificateBytes, 0) <= 1024
    AND latestQuizBytes <= 262144 AND COALESCE(targetQuizBytes, 0) <= 8192
    AND evidenceCount <= 500 AND evidenceBytes <= 65536 AND recentFailureBytes <= 175
    THEN (SELECT snapshot FROM (${privateCourseSnapshotSql})) ELSE json_object('oversize', 1) END AS snapshot FROM budget)
  SELECT CASE WHEN length(CAST(snapshot AS BLOB)) <= ${MAX_SNAPSHOT_BYTES}
    THEN snapshot ELSE json_object('oversize', 1) END AS snapshot FROM projected`;

export async function readAssignmentCourseSnapshot(db: Database, actor: D1LearningActor, courseId: string): Promise<D1CourseSnapshot> {
  assertAssignmentBind(actor.id);
  assertAssignmentBind(courseId);
  let manifest = '[]';
  const target = { contentId: '', submissionId: '' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.prepare(boundedCourseSnapshotSql).bind(actor.id, courseId,
      actor.role === 'ADMIN' ? 'ADMIN' : '', manifest, target.contentId, target.submissionId).first<{ snapshot: string }>();
    if (!row || Buffer.byteLength(row.snapshot, 'utf8') > MAX_SNAPSHOT_BYTES) throw new AssignmentError('Kursdaten sind zu groß.', 413);
    const data = JSON.parse(row.snapshot) as Omit<D1CourseSnapshot, 'raw' | 'actor' | 'courseId' | 'manifest' | 'target'> & { oversize?: number; error?: number };
    if (data.error) throw new AssignmentError(data.error === 401 ? 'Unauthorized' : data.error === 404 ? 'Course not found' : 'Enrollment required', data.error);
    if (data.oversize) throw new AssignmentError('Kursdaten sind zu groß.', 413);
    const next = JSON.stringify(data.contents.map(content => ({ id: content.id, revision: courseContentRevision(content) }))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (Buffer.byteLength(next, 'utf8') > MAX_TARGET_BYTES) throw new AssignmentError('Kursdaten sind zu groß.', 413);
    if (next === manifest) return { ...data, raw: row.snapshot, actor: { id: actor.id, role: actor.role === 'ADMIN' ? 'ADMIN' : '' }, courseId, manifest, target };
    manifest = next;
  }
  throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
