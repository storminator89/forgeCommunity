import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getQuizValidationError, parseQuizContent, type QuizContent, type QuizQuestion } from '@/app/courses/[courseId]/contents/types';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { groupCourseContents } from '@/lib/server/group-course-contents';
import { reconcileLearnerCourseReward } from '@/lib/server/rewards';
import { activeCourseContentWhere, publishedCourseWhere } from '@/lib/server/published-course';
import { CoursePathError, coursePathAccess, publicationPathNodes } from '@/lib/server/course-path';

export type ProgressContent = { id: string; courseId: string; parentId: string | null; type: string | null; content: string; order?: number };

export function courseContentRevision(content: Pick<ProgressContent, 'type' | 'content'>): string {
  return createHash('sha256').update(JSON.stringify([content.type ?? 'TEXT', content.content])).digest('hex');
}

function versionSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for course version tokens');
  return secret;
}

/** Opaque client precondition; never expose the stored digest of quiz answers. */
export function contentVersionToken(publicationId: string, content: Pick<ProgressContent, 'id' | 'type' | 'content'>) {
  return createHmac('sha256', versionSecret()).update(JSON.stringify(['course-content-v1', publicationId, content.id,
    courseContentRevision(content)])).digest('base64url');
}

export function matchesContentVersionToken(token: unknown, publicationId: string,
  content: Pick<ProgressContent, 'id' | 'type' | 'content'>) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expected = Buffer.from(contentVersionToken(publicationId, content));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function contentQuiz(content: Pick<ProgressContent, 'type' | 'content'>): QuizContent | null {
  return (!content.type || content.type === 'TEXT' || content.type === 'QUIZ') ? parseQuizContent(content.content) : null;
}

/** Malformed legacy quiz JSON must fail closed, not become ordinary self-attested text. */
export function isQuizLikeContent(content: Pick<ProgressContent, 'type' | 'content'>): boolean {
  if (content.type === 'QUIZ') return true;
  if (content.type && content.type !== 'TEXT') return false;
  try {
    const value = JSON.parse(content.content) as unknown;
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'questions'));
  } catch {
    return content.content.trimStart().startsWith('{') && /["']questions["']\s*:/.test(content.content);
  }
}

export function courseLeaves(contents: ProgressContent[]): ProgressContent[] {
  const tree = groupCourseContents(contents);
  const leaves: ProgressContent[] = [];
  const pending = [...tree];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.subContents.length) pending.push(...current.subContents);
    else leaves.push(current);
  }
  return leaves;
}

/** Learners receive a strict allowlist, never the persisted quiz JSON. */
export function publicQuiz(quiz: QuizContent) {
  return {
    shuffleQuestions: quiz.shuffleQuestions ?? false,
    passingScore: quiz.passingScore ?? 70,
    questions: quiz.questions.map(question => {
      const base = { id: question.id, type: question.type, question: question.question };
      switch (question.type) {
        case 'SINGLE_CHOICE':
        case 'MULTIPLE_CHOICE':
        case 'TRUE_FALSE': return { ...base, options: [...question.options] };
        case 'MATCHING': return { ...base, pairs: question.pairs.map(pair => ({ left: pair.left })) };
        case 'FILL_BLANKS': return { ...base, text: question.text, blankCount: question.answers.length };
        case 'TEXT_INPUT': return base;
      }
    }),
  };
}

export function publicCourseContent<T extends ProgressContent>(content: T): T {
  const quiz = contentQuiz(content);
  if (quiz) return { ...content, type: 'QUIZ', content: JSON.stringify(publicQuiz(quiz)) };
  if (isQuizLikeContent(content)) return { ...content, type: 'QUIZ', content: JSON.stringify({ questions: [], shuffleQuestions: false, passingScore: 70 }) };
  return content;
}

function normalize(value: string) { return value.trim().toLocaleLowerCase('de'); }

export class InvalidQuizAnswersError extends Error {}

function correct(question: QuizQuestion, answer: unknown): boolean {
  switch (question.type) {
    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE':
    case 'TRUE_FALSE': {
      if (!Array.isArray(answer) || answer.length < 1 || answer.length > question.options.length ||
          answer.some(value => !Number.isInteger(value) || value < 0 || value >= question.options.length) ||
          new Set(answer).size !== answer.length ||
          (question.type !== 'MULTIPLE_CHOICE' && answer.length !== 1)) throw new InvalidQuizAnswersError('Invalid quiz answers');
      return answer.length === question.correctAnswers.length && question.correctAnswers.every(value => answer.includes(value));
    }
    case 'TEXT_INPUT': {
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 1000) throw new InvalidQuizAnswersError('Invalid quiz answers');
      return question.caseSensitive ? answer.trim() === question.correctAnswer.trim() : normalize(answer) === normalize(question.correctAnswer);
    }
    case 'MATCHING': {
      if (!Array.isArray(answer) || answer.length !== question.pairs.length || answer.some(value => typeof value !== 'string' || !value.trim() || value.length > 1000)) {
        throw new InvalidQuizAnswersError('Invalid quiz answers');
      }
      return question.pairs.every((pair, index) => normalize(answer[index]) === normalize(pair.right));
    }
    case 'FILL_BLANKS': {
      if (!Array.isArray(answer) || answer.length !== question.answers.length || answer.some(value => typeof value !== 'string' || !value.trim() || value.length > 1000)) {
        throw new InvalidQuizAnswersError('Invalid quiz answers');
      }
      return question.answers.every((value, index) => normalize(answer[index]) === normalize(value));
    }
  }
}

export function gradeQuiz(quiz: QuizContent, submitted: unknown): { score: number; passed: boolean } {
  if (getQuizValidationError(quiz)) throw new InvalidQuizAnswersError('Quiz is not ready');
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new InvalidQuizAnswersError('Invalid quiz answers');
  const answers = submitted as Record<string, unknown>;
  if (Object.keys(answers).length !== quiz.questions.length || quiz.questions.some(question => !Object.hasOwn(answers, question.id))) {
    throw new InvalidQuizAnswersError('Invalid quiz answers');
  }
  const correctCount = quiz.questions.filter(question => correct(question, answers[question.id])).length;
  const score = correctCount * 100 / quiz.questions.length;
  return { score, passed: score >= (quiz.passingScore ?? 70) };
}

/** One bounded result set for analytics and progress, regardless of retry/history volume. */
export async function assignmentPassedContentIds(tx: Prisma.TransactionClient, courseId: string,
  activeAssignmentLeaves: ProgressContent[], userIds: string[]): Promise<Array<{ userId: string; contentId: string }>> {
  const assignments = activeAssignmentLeaves.filter(content => content.type === 'ASSIGNMENT' && parseAssignmentContent(content.content)?.prompt.trim());
  if (!assignments.length || !userIds.length) return [];
  const currentRevisions = assignments.map(content => Prisma.sql`(s."contentId" = ${content.id} AND s."revision" = ${courseContentRevision(content)})`);
  return tx.$queryRaw<Array<{ userId: string; contentId: string }>>(Prisma.sql`
    WITH ranked_submissions AS (
      SELECT s."id", s."userId", s."contentId", s."passingScore",
        ROW_NUMBER() OVER (PARTITION BY s."userId", s."contentId" ORDER BY s."attemptNumber" DESC) AS attempt_rank
      FROM "AssignmentSubmission" s
      WHERE s."courseId" = ${courseId} AND s."userId" IN (${Prisma.join(userIds)})
        AND (${Prisma.join(currentRevisions, ' OR ')})
    )
    SELECT s."userId", s."contentId" FROM ranked_submissions s
    JOIN "AssignmentGradeDecision" g ON g."id" = (
      SELECT newest."id" FROM "AssignmentGradeDecision" newest
      WHERE newest."submissionId" = s."id" ORDER BY newest."sequence" DESC LIMIT 1
    )
    WHERE s.attempt_rank = 1 AND g."action" = 'GRADED' AND g."score" >= s."passingScore"
  `);
}

/** Batch activity projection for analytics; never loads private answer text or grade history. */
export async function assignmentSubmittedUserIds(tx: Prisma.TransactionClient, courseId: string,
  activeAssignmentLeaves: ProgressContent[], userIds: string[]): Promise<string[]> {
  const assignments = activeAssignmentLeaves.filter(content => content.type === 'ASSIGNMENT' && parseAssignmentContent(content.content)?.prompt.trim());
  if (!assignments.length || !userIds.length) return [];
  const currentRevisions = assignments.map(content => Prisma.sql`(s."contentId" = ${content.id} AND s."revision" = ${courseContentRevision(content)})`);
  const rows = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT DISTINCT s."userId" FROM "AssignmentSubmission" s
    WHERE s."courseId" = ${courseId} AND s."userId" IN (${Prisma.join(userIds)})
      AND (${Prisma.join(currentRevisions, ' OR ')})
  `);
  return rows.map(row => row.userId);
}

export async function completionState(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  const [course, contents, progress] = await Promise.all([
    tx.course.findUnique({ where: { id: courseId }, select: { activePublicationId: true } }),
    tx.courseContent.findMany({ where: { courseId, ...activeCourseContentWhere, course: publishedCourseWhere }, select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true } }),
    tx.courseContentProgress.findMany({ where: { userId, courseId }, select: { contentId: true, revision: true } }),
  ]);
  if (!course?.activePublicationId) return { completedContentIds: [], complete: false };
  const publication = await tx.coursePublication.findUnique({ where: { id: course.activePublicationId }, select: { courseId: true, payload: true } });
  if (!publication || publication.courseId !== courseId) throw new CoursePathError('Course publication is unavailable', 409);
  const nodes = publicationPathNodes(publication.payload);
  const projected = new Map(contents.map(row => [row.id, row]));
  if (projected.size !== nodes.length || nodes.some(node => {
    const row = projected.get(node.id);
    return !row || row.parentId !== node.parentId || row.order !== node.order;
  })) throw new CoursePathError('Published course contents do not match the active publication', 409);
  const revisions = new Map(progress.map(item => [item.contentId, item.revision]));
  const leaves = courseLeaves(contents);
  // Assignment completion is grade-derived; progress mirror rows are not proof.
  const assignmentPasses = new Set((await assignmentPassedContentIds(tx, courseId, leaves.filter(content => content.type === 'ASSIGNMENT'), [userId])).map(row => row.contentId));
  const rawCompleted = leaves.filter(content => content.type === 'ASSIGNMENT'
    ? assignmentPasses.has(content.id)
    : revisions.get(content.id) === courseContentRevision(content)).map(content => content.id);
  const access = coursePathAccess(nodes, rawCompleted);
  const completedContentIds = leaves.filter(content => access.get(content.id)?.completed).map(content => content.id);
  return { completedContentIds, complete: leaves.length > 0 && completedContentIds.length === leaves.length };
}

export async function recordCourseCompletion(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  const state = await completionState(tx, userId, courseId);
  if (state.complete) {
    await tx.enrollment.updateMany({ where: { userId, courseId, completedAt: null }, data: { completedAt: new Date() } });
    const enrollment = await tx.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } }, select: { completedAt: true },
    });
    if (enrollment?.completedAt) {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { title: true } });
      if (course) await tx.courseCompletionRecord.upsert({
        where: { userId_courseId: { userId, courseId } },
        create: { userId, courseId, courseTitle: course.title, completedAt: enrollment.completedAt },
        update: { completedAt: enrollment.completedAt },
      });
    }
  }
  await reconcileLearnerCourseReward(tx, userId, courseId);
  return state;
}
