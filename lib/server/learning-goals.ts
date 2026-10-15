import 'server-only';

import type { LearningGoal, Prisma } from '@prisma/client';
import { pausedCalendarDays, shiftGoalDeadline } from '@/lib/learning-goal-clock';
import { projectEffectiveCourseLeaves } from '@/lib/server/course-profile-completion';

type GoalReadClient = Pick<Prisma.TransactionClient, 'enrollment' | 'coursePublication' | 'courseContent' | 'courseContentProgress' | 'quizAttempt' | '$queryRaw'>;

export function effectiveGoalDeadline(goal: LearningGoal, now: Date): Date {
  if (!goal.pausedAt) return goal.endsAt;
  return shiftGoalDeadline(goal.endsAt, goal.timezone, pausedCalendarDays(goal.pausedAt, now, goal.timezone));
}

/**
 * Count only current, path-effective leaves in enrolled courses, completed
 * after opt-in and before the local-calendar deadline. There is deliberately
 * no point ledger: a revision, unenrollment, lock or withdrawn grade may lower
 * the count. Prerequisites completed before opt-in can still unlock a new leaf.
 */
export async function countVerifiedGoalLeaves(db: GoalReadClient, goal: LearningGoal, now: Date): Promise<number> {
  const end = effectiveGoalDeadline(goal, now);
  const enrollments = await db.enrollment.findMany({
    where: { userId: goal.userId },
    select: { courseId: true, course: { select: { instructorId: true, activePublicationId: true } } },
  });
  const courses = enrollments.filter(row => row.course.instructorId !== goal.userId && row.course.activePublicationId !== null)
    .map(row => ({ id: row.courseId, activePublicationId: row.course.activePublicationId, userIds: [goal.userId] }));
  if (!courses.length) return 0;
  const projected = await projectEffectiveCourseLeaves(db, courses, {
    window: { startedAt: goal.startedAt, endsAt: end, now }, verifyQuizPass: true,
  });
  return courses.reduce((count, course) => count + (projected.get(course.id)?.completedByUser.get(goal.userId)?.size ?? 0), 0);
}

export async function privateGoalView(db: GoalReadClient, goal: LearningGoal, now = new Date()) {
  const endsAt = effectiveGoalDeadline(goal, now);
  const completedLeaves = await countVerifiedGoalLeaves(db, goal, now);
  const status = completedLeaves >= goal.targetLeaves ? 'achieved'
    : goal.pausedAt ? 'paused'
      : now >= endsAt ? 'ended' : 'active';
  return {
    targetLeaves: goal.targetLeaves,
    durationDays: goal.durationDays,
    timezone: goal.timezone,
    startedAt: goal.startedAt,
    endsAt,
    pausedAt: goal.pausedAt,
    completedLeaves,
    status,
  };
}
