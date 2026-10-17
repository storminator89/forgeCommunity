import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { contentQuiz, courseContentRevision, courseLeaves, isQuizLikeContent, type ProgressContent } from '@/lib/server/course-progress';
import { CoursePathError, prepareCoursePath, publicationPathNodes } from '@/lib/server/course-path';
import { activeCourseContentWhere, publishedCourseWhere } from '@/lib/server/published-course';
import { courseSqlTable } from '@/lib/server/course-sql-tables';

type ProjectionDb = Pick<Prisma.TransactionClient, 'coursePublication' | 'courseContent' | 'courseContentProgress' | 'quizAttempt' | '$queryRaw'>;
type ProjectionCourse = { id: string; activePublicationId: string | null; userIds: string[] };
type CompletionWindow = { startedAt: Date; endsAt: Date; now: Date };
type ProjectedCourse = { totalLeaves: number; completedByUser: Map<string, Map<string, Date>> };
const COURSE_BATCH_SIZE = 50;
const ASSIGNMENT_BATCH_SIZE = 200;
const USER_BATCH_SIZE = 500;
const MAX_EVIDENCE_ROWS = 100_000;

function inWindow(at: Date, window: CompletionWindow) {
  return at >= window.startedAt && at < window.endsAt && at <= window.now;
}

/**
 * Project the same current-revision, prerequisite-effective leaves as completionState.
 * The only returned learner evidence is a completion date. Published quiz JSON and
 * private assignment responses/feedback never leave this server-side projection.
 */
export async function projectEffectiveCourseLeaves(db: ProjectionDb, courses: ProjectionCourse[],
  options: { window?: CompletionWindow; verifyQuizPass?: boolean } = {}): Promise<Map<string, ProjectedCourse>> {
  const result = new Map<string, ProjectedCourse>();
  for (let offset = 0; offset < courses.length; offset += COURSE_BATCH_SIZE) {
    const batch = courses.slice(offset, offset + COURSE_BATCH_SIZE).filter(course => course.activePublicationId);
    if (!batch.length) continue;
    const courseIds = batch.map(course => course.id);
    const publications = await db.coursePublication.findMany({
      where: { id: { in: batch.map(course => course.activePublicationId!) } },
      select: { id: true, courseId: true, payload: true },
    });
    const publicationById = new Map(publications.map(row => [row.id, row]));
    const contents = await db.courseContent.findMany({
      where: { courseId: { in: courseIds }, ...activeCourseContentWhere, course: publishedCourseWhere },
      select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true },
    });
    const contentsByCourse = new Map<string, typeof contents>();
    for (const content of contents) {
      const grouped = contentsByCourse.get(content.courseId) ?? [];
      grouped.push(content);
      contentsByCourse.set(content.courseId, grouped);
    }

    const plans = new Map<string, { leaves: ProgressContent[]; access: ReturnType<typeof prepareCoursePath> }>();
    const leafById = new Map<string, ProgressContent>();
    const revisionByLeaf = new Map<string, string>();
    const quizByLeaf = new Map<string, { quiz: boolean; quizLike: boolean }>();
    const assignmentLeaves: ProgressContent[] = [];
    const quizLeaves: ProgressContent[] = [];
    for (const course of batch) {
      const publication = publicationById.get(course.activePublicationId!);
      if (!publication || publication.courseId !== course.id) throw new CoursePathError('Course publication is unavailable', 409);
      const nodes = publicationPathNodes(publication.payload);
      const rows = contentsByCourse.get(course.id) ?? [];
      const projected = new Map(rows.map(row => [row.id, row]));
      if (projected.size !== nodes.length || nodes.some(node => {
        const row = projected.get(node.id);
        return !row || row.parentId !== node.parentId || row.order !== node.order;
      })) throw new CoursePathError('Published course contents do not match the active publication', 409);
      const leaves = courseLeaves(rows);
      plans.set(course.id, { leaves, access: prepareCoursePath(nodes) });
      result.set(course.id, { totalLeaves: leaves.length, completedByUser: new Map() });
      for (const leaf of leaves) {
        leafById.set(leaf.id, leaf);
        revisionByLeaf.set(leaf.id, courseContentRevision(leaf));
        if (leaf.type === 'ASSIGNMENT' && parseAssignmentContent(leaf.content)?.prompt.trim()) assignmentLeaves.push(leaf);
        else if (options.verifyQuizPass) {
          const quiz = Boolean(contentQuiz(leaf));
          const quizLike = isQuizLikeContent(leaf);
          quizByLeaf.set(leaf.id, { quiz, quizLike });
          if (quiz || quizLike) quizLeaves.push(leaf);
        }
      }
    }
    if (!leafById.size) continue;
    const eligibleUsers = new Map(batch.map(course => [course.id, new Set(course.userIds)]));
    const allUsers = [...new Set(batch.flatMap(course => course.userIds))];
    if (!allUsers.length) continue;
    const userBatches: string[][] = [];
    for (let index = 0; index < allUsers.length; index += USER_BATCH_SIZE) {
      userBatches.push(allUsers.slice(index, index + USER_BATCH_SIZE));
    }
    let evidenceRows = 0;
    const progress: Array<{ courseId: string; userId: string; contentId: string; revision: string; completedAt: Date }> = [];
    for (const userIds of userBatches) {
      const rows = await db.courseContentProgress.findMany({
        where: { courseId: { in: courseIds }, contentId: { in: [...leafById.keys()] }, userId: { in: userIds } },
        select: { courseId: true, userId: true, contentId: true, revision: true, completedAt: true },
        take: MAX_EVIDENCE_ROWS - evidenceRows + 1,
      });
      evidenceRows += rows.length;
      if (evidenceRows > MAX_EVIDENCE_ROWS) throw new CoursePathError('Too many completion records for a reliable projection', 413);
      for (const row of rows) progress.push(row);
    }
    const passedQuiz = new Set<string>();
    if (options.verifyQuizPass && quizLeaves.length) {
      const progressedQuizIds = new Set(progress.filter(row => quizByLeaf.get(row.contentId) &&
        row.revision === revisionByLeaf.get(row.contentId)).map(row => row.contentId));
      if (progressedQuizIds.size) {
        for (const userIds of userBatches) {
          const attempts = await db.quizAttempt.findMany({
            where: { courseId: { in: courseIds }, contentId: { in: [...progressedQuizIds] }, passed: true, userId: { in: userIds } },
            select: { courseId: true, userId: true, contentId: true, revision: true }, take: MAX_EVIDENCE_ROWS - evidenceRows + 1,
          });
          evidenceRows += attempts.length;
          if (evidenceRows > MAX_EVIDENCE_ROWS) throw new CoursePathError('Too many quiz records for a reliable projection', 413);
          for (const attempt of attempts) {
            const leaf = leafById.get(attempt.contentId);
            if (leaf?.courseId === attempt.courseId && attempt.revision === revisionByLeaf.get(leaf.id)) {
              passedQuiz.add(JSON.stringify([attempt.courseId, attempt.userId, attempt.contentId]));
            }
          }
        }
      }
    }

    const raw = new Map<string, Map<string, Map<string, Date>>>();
    const add = (courseId: string, userId: string, contentId: string, at: Date) => {
      if (!eligibleUsers.get(courseId)?.has(userId)) return;
      const users = raw.get(courseId) ?? new Map<string, Map<string, Date>>();
      const leaves = users.get(userId) ?? new Map<string, Date>();
      leaves.set(contentId, at);
      users.set(userId, leaves);
      raw.set(courseId, users);
    };
    for (const row of progress) {
      const leaf = leafById.get(row.contentId);
      if (!leaf || leaf.courseId !== row.courseId || leaf.type === 'ASSIGNMENT' || row.revision !== revisionByLeaf.get(leaf.id)) continue;
      const quiz = quizByLeaf.get(leaf.id);
      if (quiz && (quiz.quiz || quiz.quizLike) &&
          (!quiz.quiz || !passedQuiz.has(JSON.stringify([row.courseId, row.userId, row.contentId])))) continue;
      add(row.courseId, row.userId, row.contentId, row.completedAt);
    }

    // Latest current-revision submission and its latest decision are proof;
    // an assignment progress row is only a UI mirror and may be stale. Date
    // the current passing interval from its first pass, not a later correction.
    for (let index = 0; index < assignmentLeaves.length; index += ASSIGNMENT_BATCH_SIZE) {
      const assignments = assignmentLeaves.slice(index, index + ASSIGNMENT_BATCH_SIZE);
      const values = assignments.map(leaf => Prisma.sql`(${leaf.courseId}, ${leaf.id}, ${revisionByLeaf.get(leaf.id)!})`);
      const submissions = courseSqlTable('AssignmentSubmission');
      const decisions = courseSqlTable('AssignmentGradeDecision');
      const enrollments = courseSqlTable('Enrollment');
      for (const userIds of userBatches) {
        const grades = await db.$queryRaw<Array<{ courseId: string; userId: string; contentId: string; completedAt: Date }>>(Prisma.sql`
          WITH active_assignments("courseId", "contentId", "revision") AS (VALUES ${Prisma.join(values)}),
          ranked_submissions AS (
            SELECT s."courseId", s."userId", s."contentId", s."id", s."passingScore",
              ROW_NUMBER() OVER (PARTITION BY s."userId", s."contentId" ORDER BY s."attemptNumber" DESC) AS attempt_rank
            FROM ${submissions} s
            JOIN active_assignments a ON a."courseId" = s."courseId" AND a."contentId" = s."contentId" AND a."revision" = s."revision"
            JOIN ${enrollments} e ON e."courseId" = s."courseId" AND e."userId" = s."userId"
            WHERE s."userId" IN (${Prisma.join(userIds)})
          )
          SELECT s."courseId", s."userId", s."contentId", (
            SELECT first_pass."createdAt" FROM ${decisions} first_pass
            WHERE first_pass."submissionId" = s."id"
              AND first_pass."sequence" > COALESCE((
                SELECT MAX(invalidated."sequence") FROM ${decisions} invalidated
                WHERE invalidated."submissionId" = s."id"
                  AND (invalidated."action" <> 'GRADED' OR invalidated."score" IS NULL OR invalidated."score" < s."passingScore")
              ), 0)
              AND first_pass."action" = 'GRADED' AND first_pass."score" >= s."passingScore"
            ORDER BY first_pass."sequence" ASC LIMIT 1
          ) AS "completedAt"
          FROM ranked_submissions s
          JOIN ${decisions} g ON g."id" = (
            SELECT newest."id" FROM ${decisions} newest
            WHERE newest."submissionId" = s."id" ORDER BY newest."sequence" DESC LIMIT 1
          )
          WHERE s.attempt_rank = 1 AND g."action" = 'GRADED' AND g."score" >= s."passingScore"
          LIMIT ${MAX_EVIDENCE_ROWS - evidenceRows + 1}
        `);
        evidenceRows += grades.length;
        if (evidenceRows > MAX_EVIDENCE_ROWS) throw new CoursePathError('Too many assignment records for a reliable projection', 413);
        for (const grade of grades) add(grade.courseId, grade.userId, grade.contentId, grade.completedAt);
      }
    }

    for (const course of batch) {
      const plan = plans.get(course.id)!;
      const projection = result.get(course.id)!;
      const byUser = raw.get(course.id);
      for (const userId of course.userIds) {
        const evidence = byUser?.get(userId) ?? new Map<string, Date>();
        const access = plan.access(evidence.keys());
        const effective = new Map<string, Date>();
        for (const leaf of plan.leaves) {
          const at = evidence.get(leaf.id);
          if (at && access.get(leaf.id)?.completed && (!options.window || inWindow(at, options.window))) effective.set(leaf.id, at);
        }
        projection.completedByUser.set(userId, effective);
      }
    }
  }
  return result;
}

type ProfileCourse = { id: string; activePublicationId: string | null; enrollments: { userId: string; completedAt: Date | null }[] };

/** Keep effective current completion separate from the first historical completion. */
export async function profileCourseCompletionStats(db: ProjectionDb, courses: ProfileCourse[]) {
  const stats = new Map<string, { completionRate: number; everCompletionRate: number }>();
  const projected = await projectEffectiveCourseLeaves(db, courses.map(course => ({
    id: course.id, activePublicationId: course.activePublicationId, userIds: course.enrollments.map(row => row.userId),
  })));
  for (const course of courses) {
    const enrolled = course.enrollments.length;
    const current = projected.get(course.id);
    const currentCount = current?.totalLeaves ? course.enrollments.filter(row =>
      current.completedByUser.get(row.userId)?.size === current.totalLeaves).length : 0;
    const everCount = course.enrollments.filter(row => row.completedAt !== null).length;
    stats.set(course.id, {
      completionRate: enrolled ? currentCount / enrolled * 100 : 0,
      everCompletionRate: enrolled ? everCount / enrolled * 100 : 0,
    });
  }
  return stats;
}
