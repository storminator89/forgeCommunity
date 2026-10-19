import 'server-only';

import type { LearningGoal, Prisma } from '@prisma/client';
import { pausedCalendarDays, shiftGoalDeadline } from '@/lib/learning-goal-clock';
import { projectEffectiveCourseLeaves } from '@/lib/server/course-profile-completion';

type GoalReadClient = Pick<Prisma.TransactionClient, 'enrollment' | 'coursePublication' | 'courseContent' | 'courseContentProgress' | 'quizAttempt' | '$queryRaw'>;
type CreditedCompletion = { courseId: string; courseTitle: string; completedAt: Date };
type GoalProjection = { completedLeaves: number; creditedCompletions: CreditedCompletion[] };
type TrailCandidate = CreditedCompletion & { contentId: string };

export function effectiveGoalDeadline(goal: LearningGoal, now: Date): Date {
  if (!goal.pausedAt) return goal.endsAt;
  return shiftGoalDeadline(goal.endsAt, goal.timezone, pausedCalendarDays(goal.pausedAt, now, goal.timezone));
}

function courseLabel(title: string): string {
  const label = title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() || 'Kurs';
  return label.length <= 120 ? label : `${label.slice(0, 119).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`;
}

function compareCompletions(a: TrailCandidate, b: TrailCandidate): number {
  return a.completedAt.getTime() - b.completedAt.getTime() ||
    (a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0) ||
    (a.contentId < b.contentId ? -1 : a.contentId > b.contentId ? 1 : 0);
}

/** One existing projection supplies both the full count and a bounded current trail. */
async function projectVerifiedGoalLeaves(db: GoalReadClient, goal: LearningGoal, now: Date): Promise<GoalProjection> {
  const end = effectiveGoalDeadline(goal, now);
  const enrollments = await db.enrollment.findMany({
    where: { userId: goal.userId },
    select: { courseId: true, course: { select: { instructorId: true, activePublicationId: true, title: true } } },
  });
  const courses = enrollments.filter(row => row.course.instructorId !== goal.userId && row.course.activePublicationId !== null)
    .map(row => ({ id: row.courseId, activePublicationId: row.course.activePublicationId, userIds: [goal.userId], title: row.course.title }));
  if (!courses.length) return { completedLeaves: 0, creditedCompletions: [] };
  const projected = await projectEffectiveCourseLeaves(db, courses, {
    window: { startedAt: goal.startedAt, endsAt: end, now }, verifyQuizPass: true,
  });
  const limit = Math.min(goal.targetLeaves, 5);
  let completedLeaves = 0;
  const credited: TrailCandidate[] = [];
  for (const course of courses) {
    const leaves = projected.get(course.id)?.completedByUser.get(goal.userId);
    completedLeaves += leaves?.size ?? 0;
    if (!leaves) continue;
    const courseTitle = courseLabel(course.title);
    for (const [contentId, completedAt] of leaves) {
      credited.push({ courseId: course.id, courseTitle, contentId, completedAt });
      credited.sort(compareCompletions);
      if (credited.length > limit) credited.pop();
    }
  }
  // Content IDs are only a deterministic server-side tie-breaker, never a DTO field.
  return { completedLeaves, creditedCompletions: credited.map(({ courseId, courseTitle, completedAt }) => ({ courseId, courseTitle, completedAt })) };
}

/**
 * Count only current, path-effective leaves in enrolled courses, completed
 * after opt-in and before the local-calendar deadline. There is deliberately
 * no point ledger: a revision, unenrollment, lock or withdrawn grade may lower
 * the count. Prerequisites completed before opt-in can still unlock a new leaf.
 */
export async function countVerifiedGoalLeaves(db: GoalReadClient, goal: LearningGoal, now: Date): Promise<number> {
  return (await projectVerifiedGoalLeaves(db, goal, now)).completedLeaves;
}

export async function privateGoalView(db: GoalReadClient, goal: LearningGoal, now = new Date()) {
  const endsAt = effectiveGoalDeadline(goal, now);
  const { completedLeaves, creditedCompletions } = await projectVerifiedGoalLeaves(db, goal, now);
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
    creditedCompletions,
  };
}
