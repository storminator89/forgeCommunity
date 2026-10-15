import 'server-only';

import { createHash } from 'node:crypto';
import { Prisma, type RewardChangeReason } from '@prisma/client';
import { getQuizValidationError } from '@/app/courses/[courseId]/contents/types';
import { completionState, contentQuiz, courseContentRevision, courseLeaves, isQuizLikeContent } from '@/lib/server/course-progress';
import { VERIFIED_COURSE_BADGE } from '@/lib/course-achievement-badge';
import { activeCourseContentWhere, publishedCourseWhere } from '@/lib/server/published-course';
import { reconcileUserPathways } from '@/lib/server/learning-pathways';

export const COURSE_COMPLETION_POINTS = 50;
const EVENT = 'COURSE_COMPLETED' as const;

type RewardContent = { id: string; courseId: string; parentId: string | null; type: string | null; content: string; order: number };

function validQuizLeaves(contents: RewardContent[]) {
  return courseLeaves(contents).filter(content => {
    const quiz = contentQuiz(content);
    return quiz !== null && getQuizValidationError(quiz) === null;
  });
}

function assignmentApprovalMaterials(contents: RewardContent[]) {
  const leaves = new Set(courseLeaves(contents).map(content => content.id));
  return contents.filter(content => content.type === 'ASSIGNMENT').map(content => [
    content.id, courseContentRevision(content), leaves.has(content.id),
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/** Keep quiz-only approval fingerprints stable; assignment scoring material also requires review. */
export function courseQuizApprovalRevision(contents: RewardContent[]) {
  const leaves = new Set(courseLeaves(contents).map(content => content.id));
  const quizMaterials = contents.filter(isQuizLikeContent).map(content => [
    content.id, courseContentRevision(content), leaves.has(content.id),
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const assignmentMaterials = assignmentApprovalMaterials(contents);
  const material = assignmentMaterials.length ? { quizMaterials, assignmentMaterials } : quizMaterials;
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

export function courseAssignmentApprovalRevision(contents: RewardContent[]) {
  return createHash('sha256').update(JSON.stringify(assignmentApprovalMaterials(contents))).digest('hex');
}

export async function courseApprovalFingerprint(tx: Prisma.TransactionClient, courseId: string) {
  const contents = await tx.courseContent.findMany({
    where: { courseId, ...activeCourseContentWhere, course: publishedCourseWhere }, select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true },
  });
  return courseQuizApprovalRevision(contents);
}

/** Admin approval requires a persisted, valid quiz that can actually be passed. */
export async function courseHasRewardableQuiz(tx: Prisma.TransactionClient, courseId: string) {
  const contents = await tx.courseContent.findMany({
    where: { courseId, ...activeCourseContentWhere, course: publishedCourseWhere }, select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true },
  });
  return validQuizLeaves(contents).length > 0;
}

async function learnerPassedCurrentQuiz(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  const contents = await tx.courseContent.findMany({
    where: { courseId, ...activeCourseContentWhere, course: publishedCourseWhere }, select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true },
  });
  const quizzes = validQuizLeaves(contents);
  if (!quizzes.length) return false;
  const attempt = await tx.quizAttempt.findFirst({
    where: {
      userId, courseId, passed: true,
      OR: quizzes.map(content => ({ contentId: content.id, revision: courseContentRevision(content) })),
    },
    select: { id: true },
  });
  return attempt !== null;
}

async function recordChange(tx: Prisma.TransactionClient, ledgerId: string, version: number,
  type: 'AWARDED' | 'REVOKED' | 'REINSTATED', reason: RewardChangeReason | null, pointsDelta: number) {
  await tx.rewardLedgerChange.upsert({
    where: { ledgerId_version: { ledgerId, version } },
    create: { ledgerId, version, type, reason, pointsDelta },
    update: { pointsDelta },
  });
}

async function revokeReward(tx: Prisma.TransactionClient, userId: string, courseId: string, reason: RewardChangeReason) {
  const key = { userId, eventType: EVENT, sourceId: courseId };
  const existing = await tx.rewardLedger.findUnique({ where: { userId_eventType_sourceId: key }, select: { id: true, revokedAt: true, stateVersion: true } });
  if (!existing || existing.revokedAt) return;
  const updated = await tx.rewardLedger.updateMany({
    where: { id: existing.id, revokedAt: null, stateVersion: existing.stateVersion },
    data: { revokedAt: new Date(), stateVersion: { increment: 1 } },
  });
  if (updated.count === 1) await recordChange(tx, existing.id, existing.stateVersion + 1, 'REVOKED', reason, -COURSE_COMPLETION_POINTS);
}

/** Mirror current verified learning, never historical completion snapshots. */
export async function reconcileVerifiedCourseBadge(tx: Prisma.TransactionClient, userId: string) {
  const [user, activeRewards] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { role: true, isTestAccount: true } }),
    tx.rewardLedger.count({ where: { userId, eventType: EVENT, revokedAt: null } }),
  ]);
  const key = { userId, badgeId: VERIFIED_COURSE_BADGE.id };
  if (!user || user.role !== 'USER' || user.isTestAccount || activeRewards === 0) {
    await tx.userBadge.deleteMany({ where: key });
    return;
  }
  await tx.badge.upsert({
    where: { id: VERIFIED_COURSE_BADGE.id },
    create: VERIFIED_COURSE_BADGE,
    update: {},
  });
  await tx.userBadge.upsert({
    where: { userId_badgeId: key },
    create: key,
    update: {},
  });
}

export async function revokeCourseRewards(tx: Prisma.TransactionClient, courseIds: string[], reason: RewardChangeReason) {
  if (!courseIds.length) return;
  const active = await tx.rewardLedger.findMany({
    where: { eventType: EVENT, sourceId: { in: courseIds }, revokedAt: null }, select: { userId: true, sourceId: true },
  });
  for (const item of active) await revokeReward(tx, item.userId, item.sourceId, reason);
  for (const userId of new Set(active.map(item => item.userId))) {
    await reconcileVerifiedCourseBadge(tx, userId);
    await reconcileUserPathways(tx, userId);
  }
}

/**
 * One durable event key; each state transition has an append-only explanation.
 * The shared completion evaluator preserves earned, current-revision credit
 * across date-only reschedules, so midnight requires no ledger transition.
 */
export async function reconcileLearnerCourseReward(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  const [user, course, enrollment] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { role: true, isTestAccount: true } }),
    tx.course.findUnique({ where: { id: courseId }, select: { title: true, rewardEligible: true, rewardApprovalRevision: true, instructorId: true } }),
    tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } }),
  ]);
  let reason: RewardChangeReason = 'LEARNING_CHANGED';
  let qualifies = false;
  if (!course) reason = 'COURSE_REMOVED';
  else if (!course.rewardEligible) reason = 'APPROVAL_WITHDRAWN';
  else if (!course.rewardApprovalRevision || course.rewardApprovalRevision !== await courseApprovalFingerprint(tx, courseId)) reason = 'QUIZ_REVISED';
  else if (!user || user.role !== 'USER' || user.isTestAccount || course.instructorId === userId) reason = 'ACCOUNT_INELIGIBLE';
  else if (enrollment && (await completionState(tx, userId, courseId)).complete && await learnerPassedCurrentQuiz(tx, userId, courseId)) qualifies = true;

  if (!qualifies) {
    await revokeReward(tx, userId, courseId, reason);
    await reconcileVerifiedCourseBadge(tx, userId);
    await reconcileUserPathways(tx, userId, courseId);
    return false;
  }

  const row = await tx.rewardLedger.upsert({
    where: { userId_eventType_sourceId: { userId, eventType: EVENT, sourceId: courseId } },
    create: { userId, eventType: EVENT, sourceId: courseId, courseTitle: course!.title, points: COURSE_COMPLETION_POINTS },
    update: { points: COURSE_COMPLETION_POINTS },
  });
  if (row.revokedAt) {
    const updated = await tx.rewardLedger.updateMany({
      where: { id: row.id, revokedAt: { not: null }, stateVersion: row.stateVersion },
      data: { revokedAt: null, stateVersion: { increment: 1 } },
    });
    if (updated.count === 1) await recordChange(tx, row.id, row.stateVersion + 1, 'REINSTATED', null, COURSE_COMPLETION_POINTS);
  } else if (row.stateVersion === 1) {
    await recordChange(tx, row.id, 1, 'AWARDED', null, COURSE_COMPLETION_POINTS);
  }
  await reconcileVerifiedCourseBadge(tx, userId);
  await reconcileUserPathways(tx, userId, courseId);
  return true;
}

export async function reconcileCourseRewards(tx: Prisma.TransactionClient, courseId: string,
  scoringChangeReason: 'QUIZ_REVISED' | 'LEARNING_CHANGED' = 'QUIZ_REVISED') {
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { rewardEligible: true, rewardApprovalRevision: true } });
  const approvalChanged = Boolean(course?.rewardEligible && course.rewardApprovalRevision !== await courseApprovalFingerprint(tx, courseId));
  if (approvalChanged) {
    // Teacher edits cannot carry an administrator's review to different scoring material.
    await tx.course.update({ where: { id: courseId }, data: { rewardEligible: false, rewardApprovalRevision: null } });
  }
  if (!course?.rewardEligible || approvalChanged) {
    await revokeCourseRewards(tx, [courseId], approvalChanged ? scoringChangeReason : 'APPROVAL_WITHDRAWN');
    return;
  }
  const [enrollments, ledger] = await Promise.all([
    tx.enrollment.findMany({ where: { courseId, completedAt: { not: null } }, select: { userId: true } }),
    tx.rewardLedger.findMany({ where: { eventType: EVENT, sourceId: courseId }, select: { userId: true } }),
  ]);
  for (const userId of new Set([...enrollments.map(row => row.userId), ...ledger.map(row => row.userId)])) {
    await reconcileLearnerCourseReward(tx, userId, courseId);
  }
}

export async function reconcileUserRewards(tx: Prisma.TransactionClient, userId: string) {
  const [enrollments, ledger] = await Promise.all([
    tx.enrollment.findMany({ where: { userId, completedAt: { not: null } }, select: { courseId: true } }),
    tx.rewardLedger.findMany({ where: { userId, eventType: EVENT }, select: { sourceId: true } }),
  ]);
  for (const courseId of new Set([...enrollments.map(row => row.courseId), ...ledger.map(row => row.sourceId)])) {
    await reconcileLearnerCourseReward(tx, userId, courseId);
  }
  await reconcileVerifiedCourseBadge(tx, userId);
  await reconcileUserPathways(tx, userId);
}
