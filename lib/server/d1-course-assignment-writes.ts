import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { MAX_ASSIGNMENT_FEEDBACK, MAX_ASSIGNMENT_RESPONSE, parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { AssignmentError } from '@/lib/server/assignment-errors';
import { courseContentRevision } from '@/lib/server/course-progress';
import { CoursePathError } from '@/lib/server/course-path';
import { courseLearningDatabase, assertD1ContentAccess, d1PublicationNodes, d1CourseSnapshotGuard,
  isD1CourseSnapshotConflict, type D1LearningActor, type D1CourseSnapshot } from '@/lib/server/d1-course-learning';
import { matchesD1CourseContentVersionToken } from '@/lib/server/d1-course-version';
import { d1CourseRewardStatements, d1RewardNodes } from '@/lib/server/d1-course-rewards';
import { assertAssignmentBind, assignmentDate, readAssignmentTarget, assignmentTargetGuard, readAssignmentCourseSnapshot,
  type AssignmentTargetState, type AssignmentDecisionState, type AssignmentSubmissionState } from '@/lib/server/d1-course-assignment-state';

type Database = ReturnType<typeof courseLearningDatabase>;
const idPattern = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_RETRIES = 5;

function assertLearner(state: AssignmentTargetState) {
  if (!state.account) throw new AssignmentError('Unauthorized', 401);
  if (!state.enrolled) throw new AssignmentError('Enrollment required', 403);
}
function assertStaff(state: AssignmentTargetState) {
  if (!state.account) throw new AssignmentError('Unauthorized', 401);
  if (!state.course) throw new AssignmentError('Course not found', 404);
  // Course ownership works with every current account role. The fallback
  // requires BOTH the authenticated session and the current account be ADMIN.
  if (!state.canGrade) throw new AssignmentError('Unauthorized', 403);
}
function currentAssignment(snapshot: D1CourseSnapshot, contentId: string, grading: boolean) {
  if (!snapshot.user) throw new AssignmentError('Unauthorized', 401);
  if (!snapshot.course) throw new AssignmentError('Course not found', 404);
  if (!snapshot.course.activePublicationId) throw new AssignmentError(grading ? 'Aufgabe nicht veröffentlicht.' : 'Course not found', grading ? 412 : 404);
  d1PublicationNodes(snapshot);
  const content = snapshot.contents.find(row => row.id === contentId);
  if (!content || content.courseId !== snapshot.courseId || content.type !== 'ASSIGNMENT' ||
      snapshot.contents.some(row => row.parentId === content.id)) {
    throw new AssignmentError(grading ? 'Aufgabe wurde geändert. Bitte neu laden.' : 'Assignment not found', grading ? 412 : 404);
  }
  const assignment = parseAssignmentContent(content.content);
  if (!assignment?.prompt.trim()) throw new AssignmentError(grading ? 'Aufgabe wurde geändert. Bitte neu laden.' : 'Assignment is not ready', grading ? 412 : 409);
  return { content, assignment, revision: courseContentRevision(content), publicationId: snapshot.course.activePublicationId };
}
function decisionDto(decision: AssignmentDecisionState, threshold: number) {
  // All fallible date validation happens before the mutation batch is sent.
  return { id: decision.id, action: decision.action, score: decision.score, feedback: decision.feedback,
    passed: decision.action === 'GRADED' && decision.score !== null && decision.score >= threshold,
    createdAt: assignmentDate(decision.createdAt), sequence: decision.sequence };
}
function submissionDto(submission: AssignmentSubmissionState, unchanged: boolean) {
  return { id: submission.id, attemptNumber: submission.attemptNumber,
    submittedAt: assignmentDate(submission.submittedAt), unchanged };
}
function isAssignmentInvariantFailure(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (/D1_ASSIGNMENT_(?:WRITE|PROGRESS)_INVARIANT/.test(current instanceof Error ? current.message : String(current))) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}
function knownReadinessFailure(error: unknown) {
  return (error instanceof AssignmentError || error instanceof CoursePathError) && [404, 409, 412, 413, 423].includes(error.status);
}
function rethrowPathError(error: unknown): never {
  if (error instanceof CoursePathError) throw new AssignmentError(error.message, error.status);
  throw error;
}

/** SQL computes the current passing interval by sequence, never MIN(date).
 * The expected timestamp was validated before the batch; the assertion proves
 * the same value will be written before any mutation can commit. */
function progressStatements(db: Database, input: {
  userId: string; courseId: string; contentId: string; revision: string; threshold: number;
  expectedPassingAt: string | number | null;
}) {
  const ctes = `WITH input(userId, courseId, contentId, revision, threshold) AS (VALUES (?, ?, ?, ?, ?)),
    latest AS (SELECT s.id FROM AssignmentSubmission s, input i
      WHERE s.userId = i.userId AND s.courseId = i.courseId AND s.contentId = i.contentId AND s.revision = i.revision
      ORDER BY s.attemptNumber DESC LIMIT 1),
    decision AS (SELECT g.* FROM AssignmentGradeDecision g JOIN latest s ON s.id = g.submissionId
      ORDER BY g.sequence DESC LIMIT 1),
    first_pass AS (SELECT g.createdAt FROM AssignmentGradeDecision g JOIN latest s ON s.id = g.submissionId CROSS JOIN input i
      WHERE g.action = 'GRADED' AND g.score >= i.threshold
        AND EXISTS (SELECT 1 FROM decision d WHERE d.action = 'GRADED' AND d.score >= i.threshold)
        AND g.sequence > COALESCE((SELECT MAX(b.sequence) FROM AssignmentGradeDecision b
          WHERE b.submissionId = s.id AND (b.action = 'WITHDRAWN' OR b.score < i.threshold)), 0)
      ORDER BY g.sequence ASC LIMIT 1)`;
  const values = [input.userId, input.courseId, input.contentId, input.revision, input.threshold];
  return [
    db.prepare(`${ctes} SELECT CASE WHEN (SELECT createdAt FROM first_pass) IS ?6
      AND ((EXISTS (SELECT 1 FROM decision d, input i WHERE d.action = 'GRADED' AND d.score >= i.threshold)) = (?6 IS NOT NULL))
      THEN 1 ELSE json_extract('[]', 'D1_ASSIGNMENT_PROGRESS_INVARIANT') END AS guarded`).bind(...values, input.expectedPassingAt),
    db.prepare(`${ctes} INSERT INTO CourseContentProgress (userId, courseId, contentId, revision, completedAt)
      SELECT i.userId, i.courseId, i.contentId, i.revision, p.createdAt FROM input i CROSS JOIN first_pass p WHERE 1
      ON CONFLICT(userId, contentId) DO UPDATE SET revision = excluded.revision, completedAt = excluded.completedAt`).bind(...values),
    db.prepare(`${ctes} DELETE FROM CourseContentProgress
      WHERE userId = (SELECT userId FROM input) AND courseId = (SELECT courseId FROM input)
        AND contentId = (SELECT contentId FROM input) AND NOT EXISTS (SELECT 1 FROM first_pass)`).bind(...values),
  ];
}

/** Native D1.batch is the only atomic boundary. No interactive-transaction
 * callback, conditional no-op evidence insert, or post-commit reconciliation. */
export async function d1SubmitAssignment(courseId: string, contentId: string, userId: string, body: Record<string, unknown>) {
  const { requestId, response, publicationId, contentVersionToken: token } = body;
  if (typeof requestId !== 'string' || !idPattern.test(requestId) || typeof response !== 'string' || !response.trim() ||
      response.length > MAX_ASSIGNMENT_RESPONSE || typeof publicationId !== 'string' || typeof token !== 'string') {
    throw new AssignmentError('Ungültige Abgabe.', 400);
  }
  for (const value of [courseId, contentId, userId, publicationId]) assertAssignmentBind(value);
  const digest = createHash('sha256').update(JSON.stringify([publicationId, response])).digest('hex');
  const actor = { id: userId };
  const db = courseLearningDatabase();
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Historical receipt lookup deliberately precedes current publication,
      // assignment readiness, token, release and prerequisite checks.
      const initial = await readAssignmentTarget(db, { mode: 'submit', actor, courseId, contentId, revision: '', requestId, submissionId: '' });
      assertLearner(initial);
      if (initial.submitReceipt) {
        const receipt = initial.submitReceipt;
        if (receipt.courseId !== courseId || receipt.responseDigest !== digest || receipt.publicationId !== publicationId) {
          throw new AssignmentError('Anforderungs-ID wurde anders verwendet.', 409);
        }
        return submissionDto(receipt, true);
      }
      const snapshot = await readAssignmentCourseSnapshot(db, actor, courseId);
      if (!snapshot.user) throw new AssignmentError('Unauthorized', 401);
      if (!snapshot.enrollment) throw new AssignmentError('Enrollment required', 403);
      const context = currentAssignment(snapshot, contentId, false);
      if (context.publicationId !== publicationId || !matchesD1CourseContentVersionToken(token, context.publicationId, contentId)) {
        throw new AssignmentError('Die veröffentlichte Aufgabe wurde geändert. Bitte neu laden.', 412);
      }
      assertD1ContentAccess(snapshot, contentId);
      const target = await readAssignmentTarget(db, { mode: 'submit', actor, courseId, contentId, revision: context.revision, requestId, submissionId: '' });
      assertLearner(target);
      // A different request may have committed during context loading.
      if (target.submitReceipt) continue;
      if (target.current && !target.decision) throw new AssignmentError('Diese Abgabe wartet noch auf eine Bewertung.', 409);
      if (target.decision?.action === 'GRADED' && target.decision.score !== null && target.decision.score >= context.assignment.passingScore) {
        throw new AssignmentError('Diese Aufgabe ist bereits bestanden.', 409);
      }
      if (target.maxAttempt >= Number.MAX_SAFE_INTEGER - 1) throw new AssignmentError('Versuchsnummer ist zu groß.', 409);
      const now = new Date().toISOString().replace(/Z$/, '+00:00');
      const created: AssignmentSubmissionState = { id: randomUUID(), userId, courseId, contentId, publicationId,
        revision: context.revision, passingScore: context.assignment.passingScore, requestId, responseDigest: digest,
        attemptNumber: target.maxAttempt + 1, submittedAt: now };
      const result = submissionDto(created, false);
      const statements = [assignmentTargetGuard(db, target), d1CourseSnapshotGuard(db, snapshot),
        db.prepare(`INSERT INTO AssignmentSubmission
          (id, userId, courseId, contentId, publicationId, revision, passingScore, requestId, response, responseDigest, attemptNumber, submittedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(created.id, userId, courseId, contentId, publicationId,
          context.revision, context.assignment.passingScore, requestId, response, digest, created.attemptNumber, now),
        db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM AssignmentSubmission WHERE id = ?1 AND userId = ?2
          AND courseId = ?3 AND contentId = ?4 AND publicationId = ?5 AND revision = ?6 AND passingScore = ?7
          AND requestId = ?8 AND response = ?9 AND responseDigest = ?10 AND attemptNumber = ?11 AND submittedAt IS ?12)
          THEN 1 ELSE json_extract('[]', 'D1_ASSIGNMENT_WRITE_INVARIANT') END AS guarded`).bind(created.id, userId, courseId, contentId,
          publicationId, context.revision, context.assignment.passingScore, requestId, response, digest, created.attemptNumber, now),
        ...progressStatements(db, { userId, courseId, contentId, revision: context.revision,
          threshold: context.assignment.passingScore, expectedPassingAt: null }),
        ...d1CourseRewardStatements(db, { courseId, operationId: `assignment_${created.id}`, now,
          gate: { sql: 'SELECT 1', values: [] }, nodes: d1RewardNodes(snapshot.contents), mode: { kind: 'learner', userId } }),
      ];
      try {
        await db.batch(statements);
        return result;
      } catch (error) {
        // D1 rejects/rolls back an entire failed batch. Only our throwing JSON
        // assertions use malformed JSON; no arbitrary SQL error is retried.
        if (isAssignmentInvariantFailure(error)) throw new AssignmentError('Aufgabendaten wurden gleichzeitig geändert. Bitte neu laden.', 409);
        if (!isD1CourseSnapshotConflict(error)) throw error;
        if (attempt === MAX_RETRIES - 1) throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
      }
    }
    throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
  } catch (error) {
    // A same-request operation may have committed between the initial receipt
    // lookup and a concurrent republish/readiness failure. Recover only an
    // exact historical receipt from a fresh, currently authorized snapshot.
    if (knownReadinessFailure(error)) {
      const state = await readAssignmentTarget(db, { mode: 'submit', actor, courseId, contentId, revision: '', requestId, submissionId: '' });
      assertLearner(state);
      if (state.submitReceipt) {
        const receipt = state.submitReceipt;
        if (receipt.courseId !== courseId || receipt.responseDigest !== digest || receipt.publicationId !== publicationId) {
          throw new AssignmentError('Anforderungs-ID wurde anders verwendet.', 409);
        }
        return submissionDto(receipt, true);
      }
    }
    rethrowPathError(error);
  }
}

export async function d1DecideAssignmentGrade(courseId: string, submissionId: string, actor: D1LearningActor, body: Record<string, unknown>) {
  const { requestId, action, score, feedback, expectedDecisionId } = body;
  if (!Object.hasOwn(body, 'expectedDecisionId')) throw new AssignmentError('Erwartete Bewertung fehlt.', 428);
  if (typeof requestId !== 'string' || !idPattern.test(requestId) ||
      (expectedDecisionId !== null && (typeof expectedDecisionId !== 'string' || !idPattern.test(expectedDecisionId))) ||
      (action !== 'GRADED' && action !== 'WITHDRAWN') ||
      (action === 'GRADED' && (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100)) ||
      (action === 'WITHDRAWN' && score !== undefined && score !== null) ||
      (feedback !== undefined && (typeof feedback !== 'string' || feedback.length > MAX_ASSIGNMENT_FEEDBACK))) {
    throw new AssignmentError('Ungültige Bewertung.', 400);
  }
  for (const value of [courseId, submissionId, actor.id]) assertAssignmentBind(value);
  const normalizedScore = action === 'GRADED' ? score as number : null;
  const normalizedFeedback = typeof feedback === 'string' && feedback.trim() ? feedback : null;
  const db = courseLearningDatabase();
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const initial = await readAssignmentTarget(db, { mode: 'grade', actor, courseId, contentId: '', revision: '', requestId, submissionId });
      assertStaff(initial);
      const submission = initial.submission;
      if (!submission || submission.courseId !== courseId) throw new AssignmentError('Abgabe nicht gefunden.', 404);
      if (submission.userId === actor.id) throw new AssignmentError('Eigene Abgaben können nicht bewertet werden.', 403);
      if (initial.gradeReceipt) {
        const receipt = initial.gradeReceipt;
        if (receipt.graderId !== actor.id || receipt.action !== action || receipt.score !== normalizedScore || receipt.feedback !== normalizedFeedback) {
          throw new AssignmentError('Anforderungs-ID wurde anders verwendet.', 409);
        }
        return { decision: decisionDto(receipt, submission.passingScore), unchanged: true };
      }
      // Grade authority is the staff account. The learner's enrollment/release/
      // prerequisites are intentionally irrelevant to grading an existing answer.
      const snapshot = await readAssignmentCourseSnapshot(db, actor, courseId);
      if (!snapshot.user) throw new AssignmentError('Unauthorized', 401);
      if (!snapshot.course) throw new AssignmentError('Course not found', 404);
      if (!snapshot.course.canEdit) throw new AssignmentError('Unauthorized', 403);
      const context = currentAssignment(snapshot, submission.contentId, true);
      // A prior-publication answer stays gradable if its exact raw type/body
      // revision is unchanged. Never compare submission.publicationId here.
      if (submission.revision !== context.revision) throw new AssignmentError('Aufgabe wurde geändert. Bitte neu laden.', 412);
      const target = await readAssignmentTarget(db, { mode: 'grade', actor, courseId, contentId: submission.contentId,
        revision: context.revision, requestId, submissionId });
      assertStaff(target);
      if (!target.submission || target.submission.courseId !== courseId) throw new AssignmentError('Abgabe nicht gefunden.', 404);
      if (target.submission.userId === actor.id) throw new AssignmentError('Eigene Abgaben können nicht bewertet werden.', 403);
      if (target.gradeReceipt) continue;
      if (target.submission.contentId !== context.content.id || target.submission.userId !== submission.userId) {
        throw new AssignmentError('Die Abgabe wurde zwischenzeitlich geändert. Bitte neu laden.', 409);
      }
      if (target.submission.revision !== context.revision) throw new AssignmentError('Aufgabe wurde geändert. Bitte neu laden.', 412);
      if (target.current?.id !== target.submission.id) throw new AssignmentError('Nur die neueste Abgabe dieser Aufgabe kann bewertet werden.', 409);
      if ((target.decision?.id ?? null) !== expectedDecisionId) {
        throw new AssignmentError('Die Bewertung wurde zwischenzeitlich geändert. Bitte neu laden.', 409);
      }
      if ((target.decision?.sequence ?? 0) >= Number.MAX_SAFE_INTEGER - 1) throw new AssignmentError('Bewertungsnummer ist zu groß.', 409);
      const now = new Date().toISOString().replace(/Z$/, '+00:00');
      const created: AssignmentDecisionState = { id: randomUUID(), submissionId, requestId, graderId: actor.id,
        action, score: normalizedScore, feedback: normalizedFeedback, sequence: (target.decision?.sequence ?? 0) + 1, createdAt: now };
      const result = { decision: decisionDto(created, context.assignment.passingScore), unchanged: false };
      const passing = action === 'GRADED' && normalizedScore !== null && normalizedScore >= context.assignment.passingScore;
      const wasPassing = target.decision?.action === 'GRADED' && target.decision.score !== null && target.decision.score >= context.assignment.passingScore;
      const expectedPassingAt = passing ? wasPassing ? target.passingAt : now : null;
      if (passing && expectedPassingAt === null) throw new AssignmentError('Passing grade history is unavailable.', 409);
      if (expectedPassingAt !== null) assignmentDate(expectedPassingAt);
      const learnerId = target.submission.userId;
      const statements = [assignmentTargetGuard(db, target), d1CourseSnapshotGuard(db, snapshot),
        db.prepare(`INSERT INTO AssignmentGradeDecision (id, submissionId, requestId, graderId, action, score, feedback, sequence, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(created.id, submissionId, requestId, actor.id, action,
          normalizedScore, normalizedFeedback, created.sequence, now),
        db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM AssignmentGradeDecision WHERE id = ?1 AND submissionId = ?2
          AND requestId = ?3 AND graderId = ?4 AND action = ?5 AND score IS ?6 AND feedback IS ?7 AND sequence = ?8 AND createdAt IS ?9)
          THEN 1 ELSE json_extract('[]', 'D1_ASSIGNMENT_WRITE_INVARIANT') END AS guarded`).bind(created.id, submissionId, requestId,
          actor.id, action, normalizedScore, normalizedFeedback, created.sequence, now),
        ...progressStatements(db, { userId: learnerId, courseId, contentId: target.submission.contentId,
          revision: context.revision, threshold: context.assignment.passingScore, expectedPassingAt }),
        ...d1CourseRewardStatements(db, { courseId, operationId: `assignment_${created.id}`, now,
          gate: { sql: 'SELECT 1', values: [] }, nodes: d1RewardNodes(snapshot.contents), mode: { kind: 'learner', userId: learnerId } }),
      ];
      try {
        await db.batch(statements);
        return result;
      } catch (error) {
        if (isAssignmentInvariantFailure(error)) throw new AssignmentError('Aufgabendaten wurden gleichzeitig geändert. Bitte neu laden.', 409);
        if (!isD1CourseSnapshotConflict(error)) throw error;
        if (attempt === MAX_RETRIES - 1) throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
      }
    }
    throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
  } catch (error) {
    if (knownReadinessFailure(error)) {
      const state = await readAssignmentTarget(db, { mode: 'grade', actor, courseId, contentId: '', revision: '', requestId, submissionId });
      assertStaff(state);
      const submission = state.submission;
      if (!submission || submission.courseId !== courseId) throw new AssignmentError('Abgabe nicht gefunden.', 404);
      if (submission.userId === actor.id) throw new AssignmentError('Eigene Abgaben können nicht bewertet werden.', 403);
      if (state.gradeReceipt) {
        const receipt = state.gradeReceipt;
        if (receipt.graderId !== actor.id || receipt.action !== action || receipt.score !== normalizedScore || receipt.feedback !== normalizedFeedback) {
          throw new AssignmentError('Anforderungs-ID wurde anders verwendet.', 409);
        }
        return { decision: decisionDto(receipt, submission.passingScore), unchanged: true };
      }
    }
    rethrowPathError(error);
  }
}
