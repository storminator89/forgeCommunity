import 'server-only';

import type { LearningGoal, Prisma } from '@prisma/client';
import { contentQuiz, courseContentRevision, courseLeaves, isQuizLikeContent } from '@/lib/server/course-progress';
import { pausedCalendarDays, shiftGoalDeadline } from '@/lib/learning-goal-clock';
import { activeCourseContentWhere, publishedCourseWhere } from '@/lib/server/published-course';

type GoalReadClient = Pick<Prisma.TransactionClient, 'enrollment' | 'courseContent' | 'courseContentProgress' | 'quizAttempt'>;

export function effectiveGoalDeadline(goal: LearningGoal, now: Date): Date {
  if (!goal.pausedAt) return goal.endsAt;
  return shiftGoalDeadline(goal.endsAt, goal.timezone, pausedCalendarDays(goal.pausedAt, now, goal.timezone));
}

/**
 * Count only current leaves in enrolled courses, completed after opt-in and
 * before the local-calendar deadline. A revision, deletion, unenrollment, or
 * revoked quiz pass can lower the count. There is deliberately no point ledger.
 */
export async function countVerifiedGoalLeaves(db: GoalReadClient, goal: LearningGoal, now: Date): Promise<number> {
  const end = effectiveGoalDeadline(goal, now);
  const enrollments = await db.enrollment.findMany({
    where: { userId: goal.userId },
    select: { courseId: true, course: { select: { instructorId: true, activePublicationId: true } } },
  });
  const courseIds = enrollments.filter(row => row.course.instructorId !== goal.userId && row.course.activePublicationId !== null).map(row => row.courseId);
  if (!courseIds.length) return 0;

  const progress = await db.courseContentProgress.findMany({
    where: { userId: goal.userId, courseId: { in: courseIds }, completedAt: { gte: goal.startedAt, lt: end, lte: now } },
    select: { courseId: true, contentId: true, revision: true },
  });
  if (!progress.length) return 0;
  const progressedCourseIds = [...new Set(progress.map(row => row.courseId))];
  const contents = await db.courseContent.findMany({
    where: { courseId: { in: progressedCourseIds }, ...activeCourseContentWhere, course: publishedCourseWhere },
    select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true },
  });

  const contentsByCourse = new Map<string, typeof contents>();
  for (const content of contents) {
    const grouped = contentsByCourse.get(content.courseId) ?? [];
    grouped.push(content);
    contentsByCourse.set(content.courseId, grouped);
  }
  const leaves = new Map<string, ReturnType<typeof courseLeaves>[number]>();
  for (const courseId of progressedCourseIds) {
    for (const leaf of courseLeaves(contentsByCourse.get(courseId) ?? [])) leaves.set(leaf.id, leaf);
  }
  const valid = progress.flatMap(row => {
    const leaf = leaves.get(row.contentId);
    return leaf && leaf.courseId === row.courseId && row.revision === courseContentRevision(leaf) ? [leaf] : [];
  });
  if (!valid.length) return 0;

  const quizLeaves = valid.filter(leaf => contentQuiz(leaf) || isQuizLikeContent(leaf));
  const passed = quizLeaves.length ? await db.quizAttempt.findMany({
    where: { userId: goal.userId, courseId: { in: progressedCourseIds }, contentId: { in: quizLeaves.map(leaf => leaf.id) }, passed: true },
    select: { courseId: true, contentId: true, revision: true },
  }) : [];
  const passedKeys = new Set(passed.map(row => `${row.courseId}:${row.contentId}:${row.revision}`));
  return valid.filter(leaf => {
    if (isQuizLikeContent(leaf)) {
      return Boolean(contentQuiz(leaf)) && passedKeys.has(`${leaf.courseId}:${leaf.id}:${courseContentRevision(leaf)}`);
    }
    return true;
  }).length;
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
