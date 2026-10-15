import 'server-only';

import type { Prisma } from '@prisma/client';
import { courseContentRevision, courseLeaves } from '@/lib/server/course-progress';
import { activeCourseContentWhere, publishedCourseWhere } from '@/lib/server/published-course';

type ProfileCourse = {
  id: string;
  enrollments: { userId: string; completedAt: Date | null }[];
};

type ProfileCompletionDb = Pick<Prisma.TransactionClient, 'courseContent' | 'courseContentProgress'>;

/** Keep current-revision completion separate from the first historical completion. */
export async function profileCourseCompletionStats(db: ProfileCompletionDb, courses: ProfileCourse[]) {
  const stats = new Map<string, { completionRate: number; everCompletionRate: number }>();
  if (!courses.length) return stats;

  const courseIds = courses.map(course => course.id);
  const contents = await db.courseContent.findMany({
    where: { courseId: { in: courseIds }, ...activeCourseContentWhere, course: publishedCourseWhere },
    select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true },
  });
  const byCourse = new Map<string, typeof contents>();
  for (const content of contents) {
    const rows = byCourse.get(content.courseId) ?? [];
    rows.push(content);
    byCourse.set(content.courseId, rows);
  }

  const required = new Map<string, { courseId: string; revision: string }>();
  const leafCount = new Map<string, number>();
  for (const course of courses) {
    const leaves = courseLeaves(byCourse.get(course.id) ?? []);
    leafCount.set(course.id, leaves.length);
    for (const leaf of leaves) required.set(leaf.id, { courseId: course.id, revision: courseContentRevision(leaf) });
  }

  const progress = required.size ? await db.courseContentProgress.findMany({
    where: { courseId: { in: courseIds }, contentId: { in: [...required.keys()] } },
    select: { courseId: true, userId: true, contentId: true, revision: true },
  }) : [];
  const currentMarks = new Map<string, Map<string, number>>();
  for (const row of progress) {
    const expected = required.get(row.contentId);
    if (!expected || expected.courseId !== row.courseId || expected.revision !== row.revision) continue;
    const users = currentMarks.get(row.courseId) ?? new Map<string, number>();
    users.set(row.userId, (users.get(row.userId) ?? 0) + 1);
    currentMarks.set(row.courseId, users);
  }

  for (const course of courses) {
    const enrolled = course.enrollments.length;
    const needed = leafCount.get(course.id) ?? 0;
    const marks = currentMarks.get(course.id);
    const currentCount = needed > 0 ? course.enrollments.filter(row => marks?.get(row.userId) === needed).length : 0;
    const everCount = course.enrollments.filter(row => row.completedAt !== null).length;
    stats.set(course.id, {
      completionRate: enrolled ? currentCount / enrolled * 100 : 0,
      everCompletionRate: enrolled ? everCount / enrolled * 100 : 0,
    });
  }
  return stats;
}
