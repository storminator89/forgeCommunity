import 'server-only';

import { randomUUID } from 'node:crypto';
import { CoursePathError } from './course-path';
import { courseLearningDatabase, d1CourseSnapshotGuard, d1PublicationNodes, isD1CourseSnapshotConflict,
  readD1CourseSnapshot, type D1CourseSnapshot, type D1LearningActor } from './d1-course-learning';
import { d1CourseRewardStatements, d1RewardNodes } from './d1-course-rewards';

function adminCourse(snapshot: D1CourseSnapshot) {
  if (snapshot.user?.role !== 'ADMIN') throw new CoursePathError('Forbidden', 403);
  if (!snapshot.course) throw new CoursePathError('Course not found', 404);
  return snapshot.course;
}

/** Approval and every resulting ledger/badge/pathway change share ONE D1.batch.
 * The exact snapshot assertion also fences stored ADMIN authority, publication
 * bytes, the full live content projection and the previous approval decision.
 */
export async function updateD1CourseRewardEligibility(actor: D1LearningActor, courseId: string, eligible: boolean) {
  if (actor.role !== 'ADMIN') throw new CoursePathError('Forbidden', 403);
  const db = courseLearningDatabase();
  let snapshot = await readD1CourseSnapshot(db, actor, courseId);

  for (let attempt = 0; attempt < 5; attempt++) {
    const course = adminCourse(snapshot);
    // Withdrawal remains available without an active or valid publication.
    let material = d1RewardNodes([]);
    if (eligible) {
      if (!course.activePublicationId) {
        throw new CoursePathError('A published course is required for reward approval', 409);
      }
      d1PublicationNodes(snapshot);
      material = d1RewardNodes(snapshot.contents);
      if (!material.nodes.some(node => node.leaf && node.validQuiz)) {
        throw new CoursePathError('A published valid quiz leaf is required for reward approval', 409);
      }
    }
    const revision = eligible ? material.fingerprint : null;
    const now = new Date().toISOString().replace(/Z$/, '+00:00');
    const statements = [
      d1CourseSnapshotGuard(db, snapshot),
      db.prepare(`UPDATE Course SET rewardEligible = ?, rewardApprovalRevision = ?, updatedAt = ? WHERE id = ?`)
        .bind(eligible ? 1 : 0, revision, now, courseId),
      db.prepare(`SELECT CASE WHEN changes() = 1 THEN 1
        ELSE json_extract('[]', 'D1_REWARD_APPROVAL_WRITE_INVARIANT') END AS guarded`),
      ...d1CourseRewardStatements(db, { courseId, operationId: randomUUID(), now,
        // Only used AFTER the throwing snapshot/write guards in this batch.
        gate: { sql: 'SELECT 1', values: [] }, nodes: material,
        mode: { kind: 'publication', approvalInvalidated: false, scoringChangeReason: 'QUIZ_REVISED' } }),
      db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM Course WHERE id = ?1
        AND rewardEligible IS ?2 AND rewardApprovalRevision IS ?3) THEN ?2
        ELSE json_extract('[]', 'D1_REWARD_APPROVAL_WRITE_INVARIANT') END AS rewardEligible`)
        .bind(courseId, eligible ? 1 : 0, revision),
    ];
    try {
      const results = await db.batch(statements);
      const result = results[results.length - 1].results[0] as { rewardEligible: number };
      return { rewardEligible: result.rewardEligible === 1 };
    } catch (error) {
      if (!isD1CourseSnapshotConflict(error)) throw error;
      const current = await readD1CourseSnapshot(db, actor, courseId);
      adminCourse(current);
      // D1 can omit an assertion's sentinel. A generic malformed-JSON failure
      // with an unchanged readset is NOT evidence of a snapshot race.
      if (current.raw === snapshot.raw) throw error;
      snapshot = current;
    }
  }
  throw new CoursePathError('Course changed concurrently; retry', 409);
}
