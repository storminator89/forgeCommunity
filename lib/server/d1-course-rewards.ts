import 'server-only';

import { getQuizValidationError } from '@/app/courses/[courseId]/contents/types';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { VERIFIED_COURSE_BADGE } from '@/lib/course-achievement-badge';
import { contentQuiz, courseContentRevision, type ProgressContent } from './course-progress';
import { courseQuizApprovalRevision } from './rewards';
import { d1CourseDatabase } from './d1-course-drafts';

export type D1RewardNode = {
  id: string; type: string | null; revision: string; leaf: boolean; validQuiz: boolean; validAssignment: boolean;
};
export type D1RewardMaterial = { nodes: D1RewardNode[]; fingerprint: string };
export type D1AtomicGate = { sql: string; values: unknown[] };
export type D1RewardInput = {
  courseId: string; operationId: string; now: string; gate: D1AtomicGate; nodes: D1RewardMaterial;
  mode: { kind: 'learner'; userId: string } |
    { kind: 'publication'; approvalInvalidated: boolean; scoringChangeReason: 'QUIZ_REVISED' | 'LEARNING_CHANGED' };
};

/** The caller validates the immutable publication and its complete live projection first. */
export function d1RewardNodes(contents: ProgressContent[]): D1RewardMaterial {
  if (contents.length > 500) throw new Error('Too many course contents');
  const normalized = contents.map(node => ({ ...node, order: node.order ?? 0, type: node.type === 'QUIZ' ? 'TEXT' : node.type }));
  const parents = new Set(normalized.map(node => node.parentId));
  return { fingerprint: courseQuizApprovalRevision(normalized), nodes: normalized.map(node => {
    const quiz = contentQuiz(node);
    return { id: node.id, type: node.type, revision: courseContentRevision(node), leaf: !parents.has(node.id),
      validQuiz: Boolean(quiz && !getQuizValidationError(quiz)),
      validAssignment: node.type === 'ASSIGNMENT' && Boolean(parseAssignmentContent(node.content)?.prompt.trim()) };
  }) };
}

/**
 * Prepared statements only. The caller MUST use these in its mutation's ONE
 * atomic D1.batch, after a throwing snapshot assertion or a durable first-write
 * gate. A gate must remain true after the caller's mutation. No callback shim.
 *
 * All mutable learning evidence and eligibility are evaluated inside that batch.
 * With a validated earlier-leaf prerequisite DAG, full raw leaf completion is
 * equivalent to full prerequisite-filtered completion. Dates preserve earned
 * credit; callers separately gate new work and new certificate issuance.
 */
export function d1CourseRewardStatements(db: ReturnType<typeof d1CourseDatabase>, input: D1RewardInput) {
  const publication = input.mode.kind === 'publication';
  const revocationReason = input.mode.kind === 'publication' && input.mode.approvalInvalidated ? input.mode.scoringChangeReason : null;
  const userId = input.mode.kind === 'learner' ? input.mode.userId : null;
  const cohort = publication ? `
    SELECT e.userId FROM Enrollment e, input i JOIN Course c ON c.id = i.courseId
      WHERE e.courseId = i.courseId AND e.completedAt IS NOT NULL AND c.rewardEligible = 1
    UNION
    SELECT r.userId FROM RewardLedger r, input i JOIN Course c ON c.id = i.courseId
      WHERE r.eventType = 'COURSE_COMPLETED' AND r.sourceId = i.courseId
        AND (c.rewardEligible = 1 OR r.revokedAt IS NULL OR EXISTS
          (SELECT 1 FROM RewardLedgerChange h WHERE h.ledgerId = r.id
            AND h.id = i.operationId || ':reward-change:' || r.id || ':' || h.version))`
    : 'SELECT userId FROM input';
  const ctes = `WITH input(courseId, operationId, now, material, userId, revocationReason) AS (VALUES (?, ?, ?, ?, ?, ?)),
    gate AS (${input.gate.sql}),
    nodes AS (SELECT json_extract(j.value, '$.id') AS id, json_extract(j.value, '$.type') AS type,
      json_extract(j.value, '$.revision') AS revision, json_extract(j.value, '$.leaf') AS leaf,
      json_extract(j.value, '$.validQuiz') AS validQuiz, json_extract(j.value, '$.validAssignment') AS validAssignment
      FROM input i, json_each(i.material, '$.nodes') j),
    candidates AS (${cohort}),
    cohort AS (SELECT userId FROM candidates WHERE EXISTS (SELECT 1 FROM gate)),
    proof AS (SELECT co.userId,
      (EXISTS (SELECT 1 FROM nodes WHERE leaf = 1) AND NOT EXISTS
        (SELECT 1 FROM nodes n WHERE n.leaf = 1 AND NOT
          (CASE WHEN n.type = 'ASSIGNMENT' THEN n.validAssignment = 1 AND EXISTS
            (SELECT 1 FROM AssignmentSubmission s JOIN AssignmentGradeDecision g ON g.id =
              (SELECT g2.id FROM AssignmentGradeDecision g2 WHERE g2.submissionId = s.id ORDER BY g2.sequence DESC LIMIT 1)
             WHERE s.id = (SELECT s2.id FROM AssignmentSubmission s2, input i
               WHERE s2.userId = co.userId AND s2.courseId = i.courseId AND s2.contentId = n.id AND s2.revision = n.revision
               ORDER BY s2.attemptNumber DESC LIMIT 1)
             AND g.action = 'GRADED' AND g.score >= s.passingScore)
           ELSE EXISTS (SELECT 1 FROM CourseContentProgress p, input i
             WHERE p.userId = co.userId AND p.courseId = i.courseId AND p.contentId = n.id AND p.revision = n.revision) END))) AS complete
      FROM cohort co),
    desired AS (SELECT p.userId, p.complete,
      (c.rewardEligible = 1 AND c.rewardApprovalRevision = json_extract(i.material, '$.fingerprint')
        AND u.role = 'USER' AND u.isTestAccount = 0 AND c.instructorId <> p.userId AND p.complete = 1
        AND EXISTS (SELECT 1 FROM Enrollment e WHERE e.userId = p.userId AND e.courseId = i.courseId)
        AND EXISTS (SELECT 1 FROM QuizAttempt q JOIN nodes n ON n.id = q.contentId
          WHERE q.userId = p.userId AND q.courseId = i.courseId AND q.passed = 1
            AND n.leaf = 1 AND n.validQuiz = 1 AND q.revision = n.revision)) AS qualifies,
      CASE WHEN c.rewardEligible = 0 THEN COALESCE(i.revocationReason, 'APPROVAL_WITHDRAWN')
        WHEN c.rewardApprovalRevision IS NULL OR c.rewardApprovalRevision <> json_extract(i.material, '$.fingerprint') THEN 'QUIZ_REVISED'
        WHEN u.id IS NULL OR u.role <> 'USER' OR u.isTestAccount <> 0 OR c.instructorId = p.userId THEN 'ACCOUNT_INELIGIBLE'
        ELSE 'LEARNING_CHANGED' END AS reason
      FROM proof p CROSS JOIN input i JOIN Course c ON c.id = i.courseId LEFT JOIN User u ON u.id = p.userId),
    badgeUsers AS (SELECT co.userId FROM cohort co JOIN User u ON u.id = co.userId
      WHERE u.role = 'USER' AND u.isTestAccount = 0 AND EXISTS
        (SELECT 1 FROM RewardLedger r WHERE r.userId = co.userId AND r.eventType = 'COURSE_COMPLETED' AND r.revokedAt IS NULL)),
    pathwayDesired AS (SELECT p.*,
      (u.role = 'USER' AND u.isTestAccount = 0 AND p.optedOutAt IS NULL
        AND (SELECT COUNT(*) FROM LearningPathwayCourse pc WHERE pc.pathwayId = p.pathwayId) >= 2
        AND NOT EXISTS (SELECT 1 FROM LearningPathwayCourse pc WHERE pc.pathwayId = p.pathwayId AND NOT EXISTS
          (SELECT 1 FROM RewardLedger r WHERE r.userId = p.userId AND r.eventType = 'COURSE_COMPLETED'
            AND r.sourceId = pc.courseId AND r.revokedAt IS NULL))) AS qualifies,
      CASE WHEN u.role <> 'USER' OR u.isTestAccount <> 0 THEN 'ACCOUNT_INELIGIBLE'
        WHEN p.optedOutAt IS NOT NULL THEN 'OPTED_OUT' ELSE 'REWARD_INVALIDATED' END AS reason
      FROM LearningPathwayParticipation p JOIN cohort co ON co.userId = p.userId
      JOIN User u ON u.id = p.userId CROSS JOIN input i
      WHERE ${publication ? `(EXISTS (SELECT 1 FROM Course c WHERE c.id = i.courseId AND c.rewardEligible = 0) OR
        EXISTS (SELECT 1 FROM LearningPathwayCourse pc WHERE pc.pathwayId = p.pathwayId AND pc.courseId = i.courseId))`
    : 'EXISTS (SELECT 1 FROM LearningPathwayCourse pc WHERE pc.pathwayId = p.pathwayId AND pc.courseId = i.courseId)'})`;
  const values = [input.courseId, input.operationId, input.now, JSON.stringify(input.nodes), userId, revocationReason, ...input.gate.values];
  const statement = (sql: string, extra: unknown[] = []) => db.prepare(`${ctes} ${sql}`).bind(...values, ...extra);
  const statements = [];
  if (!publication) {
    statements.push(statement(`UPDATE Enrollment SET completedAt = (SELECT now FROM input)
      WHERE userId = (SELECT userId FROM input) AND courseId = (SELECT courseId FROM input) AND completedAt IS NULL
        AND EXISTS (SELECT 1 FROM desired d WHERE d.userId = Enrollment.userId AND d.complete = 1)`));
    statements.push(statement(`INSERT INTO CourseCompletionRecord (userId, courseId, courseTitle, completedAt)
      SELECT e.userId, e.courseId, c.title, e.completedAt FROM Enrollment e
      JOIN desired d ON d.userId = e.userId CROSS JOIN input i JOIN Course c ON c.id = i.courseId
      WHERE e.courseId = i.courseId AND d.complete = 1 AND e.completedAt IS NOT NULL
      ON CONFLICT(userId, courseId) DO UPDATE SET completedAt = excluded.completedAt`));
  }
  statements.push(statement(`INSERT INTO RewardLedger
    (id, userId, eventType, sourceId, courseTitle, points, stateVersion, awardedAt, revokedAt)
    SELECT i.operationId || ':reward:' || hex(d.userId), d.userId, 'COURSE_COMPLETED', c.id, c.title, 50, 1, i.now, NULL
    FROM desired d CROSS JOIN input i JOIN Course c ON c.id = i.courseId WHERE d.qualifies = 1
    ON CONFLICT(userId, eventType, sourceId) DO UPDATE SET points = 50`));
  statements.push(statement(`INSERT INTO RewardLedgerChange (id, ledgerId, version, type, reason, pointsDelta, createdAt)
    SELECT i.operationId || ':reward-change:' || r.id || ':' || r.stateVersion, r.id, r.stateVersion, 'AWARDED', NULL, 50, i.now
    FROM RewardLedger r JOIN desired d ON d.userId = r.userId CROSS JOIN input i
    WHERE r.eventType = 'COURSE_COMPLETED' AND r.sourceId = i.courseId AND d.qualifies = 1
      AND r.revokedAt IS NULL AND r.stateVersion = 1
      AND NOT EXISTS (SELECT 1 FROM RewardLedgerChange h WHERE h.ledgerId = r.id AND h.version = 1)`));
  statements.push(statement(`INSERT INTO RewardLedgerChange (id, ledgerId, version, type, reason, pointsDelta, createdAt)
    SELECT i.operationId || ':reward-change:' || r.id || ':' || (r.stateVersion + 1), r.id, r.stateVersion + 1,
      CASE WHEN d.qualifies = 1 THEN 'REINSTATED' ELSE 'REVOKED' END,
      CASE WHEN d.qualifies = 1 THEN NULL ELSE d.reason END, CASE WHEN d.qualifies = 1 THEN 50 ELSE -50 END, i.now
    FROM RewardLedger r JOIN desired d ON d.userId = r.userId CROSS JOIN input i
    WHERE r.eventType = 'COURSE_COMPLETED' AND r.sourceId = i.courseId
      AND ((d.qualifies = 1 AND r.revokedAt IS NOT NULL) OR (COALESCE(d.qualifies, 0) = 0 AND r.revokedAt IS NULL))`));
  statements.push(statement(`UPDATE RewardLedger SET stateVersion = stateVersion + 1,
      revokedAt = CASE WHEN revokedAt IS NULL THEN (SELECT now FROM input) ELSE NULL END
    WHERE EXISTS (SELECT 1 FROM input i JOIN RewardLedgerChange h ON h.ledgerId = RewardLedger.id
      WHERE h.id = i.operationId || ':reward-change:' || RewardLedger.id || ':' || (RewardLedger.stateVersion + 1)
        AND h.version = RewardLedger.stateVersion + 1 AND h.type IN ('REVOKED', 'REINSTATED')
        AND EXISTS (SELECT 1 FROM gate))`));
  statements.push(statement(`DELETE FROM UserBadge WHERE badgeId = ? AND userId IN (SELECT userId FROM cohort)
    AND userId NOT IN (SELECT userId FROM badgeUsers)`, [VERIFIED_COURSE_BADGE.id]));
  statements.push(statement(`INSERT INTO Badge (id, name, description, image)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM badgeUsers) ON CONFLICT(id) DO NOTHING`,
  [VERIFIED_COURSE_BADGE.id, VERIFIED_COURSE_BADGE.name, VERIFIED_COURSE_BADGE.description, VERIFIED_COURSE_BADGE.image]));
  statements.push(statement(`INSERT INTO UserBadge (id, userId, badgeId, awardedAt)
    SELECT i.operationId || ':badge:' || hex(b.userId), b.userId, ?, i.now FROM badgeUsers b CROSS JOIN input i WHERE 1
    ON CONFLICT(userId, badgeId) DO NOTHING`, [VERIFIED_COURSE_BADGE.id]));
  statements.push(statement(`INSERT INTO LearningPathwayChange (id, userId, pathwayId, version, type, reason, createdAt)
    SELECT i.operationId || ':path:' || hex(p.userId) || ':' || hex(p.pathwayId) || ':' || (p.stateVersion + 1),
      p.userId, p.pathwayId, p.stateVersion + 1,
      CASE WHEN p.qualifies = 1 THEN CASE WHEN p.badgeFirstAwardedAt IS NULL THEN 'AWARDED' ELSE 'REINSTATED' END ELSE 'REVOKED' END,
      CASE WHEN p.qualifies = 1 THEN NULL ELSE p.reason END, i.now
    FROM pathwayDesired p CROSS JOIN input i WHERE p.qualifies <> p.badgeActive`));
  statements.push(statement(`UPDATE LearningPathwayParticipation SET badgeActive = NOT badgeActive, stateVersion = stateVersion + 1,
      badgeFirstAwardedAt = CASE WHEN badgeActive = 0 THEN COALESCE(badgeFirstAwardedAt, (SELECT now FROM input)) ELSE badgeFirstAwardedAt END
    WHERE EXISTS (SELECT 1 FROM input i JOIN LearningPathwayChange h ON h.userId = LearningPathwayParticipation.userId
      AND h.pathwayId = LearningPathwayParticipation.pathwayId
      WHERE h.id = i.operationId || ':path:' || hex(LearningPathwayParticipation.userId) || ':' || hex(LearningPathwayParticipation.pathwayId) || ':' || (LearningPathwayParticipation.stateVersion + 1)
        AND h.version = LearningPathwayParticipation.stateVersion + 1 AND EXISTS (SELECT 1 FROM gate))`));
  return statements;
}
