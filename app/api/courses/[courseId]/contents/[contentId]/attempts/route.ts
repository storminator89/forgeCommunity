import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { contentQuiz, courseContentRevision, gradeQuizWithItemEvidence, InvalidQuizAnswersError, matchesContentVersionToken, recordCourseCompletion } from '@/lib/server/course-progress';
import { assertConfidenceQuestionIds, InvalidQuizConfidenceError, parseQuizConfidence } from '@/lib/server/quiz-confidence';
import { getQuizValidationError } from '@/app/courses/[courseId]/contents/types';
import { contentTransaction } from '../../content-mutations';
import { assertCurrentPrerequisites, CoursePathError } from '@/lib/server/course-prerequisites';

type Params = { params: Promise<{ courseId: string; contentId: string }> };
type AttemptOutcome = { status: number; score?: number; passed?: boolean; retryAfterSeconds?: number; error?: string };

export async function POST(request: NextRequest, props: Params) {
  const { courseId, contentId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await readJsonObject(request, 64 * 1024);
    if (typeof body.submissionId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.submissionId) ||
        typeof body.publicationId !== 'string' || typeof body.contentVersionToken !== 'string' ||
        !body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
      return NextResponse.json({ error: 'Invalid quiz submission' }, { status: 400 });
    }
    const userId = session.user.id;
    const submissionId = body.submissionId;
    const answers = body.answers;
    const confidence = parseQuizConfidence(body.confidenceByQuestion);
    // A digest is stored only in the database for safe idempotent retries; it
    // must never be returned to learners because answer-space is often small.
    const answerDigest = createHash('sha256').update(JSON.stringify(answers)).digest('hex');

    const attempt = async (): Promise<AttemptOutcome> => contentTransaction(async tx => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { activePublicationId: true } });
      if (!course?.activePublicationId) return { status: 404, error: 'Course not found' };
      const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } });
      if (!enrollment) return { status: 403, error: 'Enrollment required' };
      const previous = await tx.quizAttempt.findUnique({ where: { userId_contentId_submissionId: { userId, contentId, submissionId } },
        include: { itemEvidence: { select: { questionId: true } } } });
      if (previous) {
        // Evidence rows retain the original published question IDs even after
        // republishing, so a lost-response retry can validate its null keys.
        if (previous.itemEvidence.length) {
          assertConfidenceQuestionIds(confidence, previous.itemEvidence.map(item => ({ id: item.questionId })));
        }
        if (previous.courseId !== courseId || previous.publicationId !== body.publicationId ||
            previous.answerDigest !== answerDigest || (previous.confidenceDigest ?? null) !== confidence.digest) {
          return { status: 409, error: 'Submission ID was already used for different answers, confidence or a different publication' };
        }
        // A lost-response retry may return its original outcome after a later
        // publication. It must never create fresh progress on that later version.
        return { status: 200, score: previous.score, passed: previous.passed };
      }
      if (course.activePublicationId !== body.publicationId) return { status: 409, error: 'Quiz changed; reload before submitting' };
      const content = await tx.courseContent.findUnique({ where: { id: contentId }, select: { id: true, courseId: true, parentId: true, type: true, content: true, archivedAt: true, children: { where: { archivedAt: null }, select: { id: true }, take: 1 } } });
      if (!content || content.courseId !== courseId || content.archivedAt) return { status: 404, error: 'Content not found' };
      if (content.children.length) return { status: 409, error: 'Only leaf quizzes can be submitted' };
      const quiz = contentQuiz(content);
      if (!quiz || getQuizValidationError(quiz)) return { status: 409, error: 'Quiz is not ready' };
      if (!matchesContentVersionToken(body.contentVersionToken, course.activePublicationId, content)) return { status: 409, error: 'Quiz changed; reload before submitting' };
      await assertCurrentPrerequisites(tx, userId, courseId, contentId, course.activePublicationId);
      const revision = courseContentRevision(content);
      const now = new Date();
      const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
      const recentFailures = await tx.quizAttempt.findMany({
        where: { userId, contentId, revision, passed: false, submittedAt: { gte: windowStart } },
        orderBy: { submittedAt: 'desc' }, take: 5, select: { submittedAt: true },
      });
      if (recentFailures.length >= 5) {
        const oldest = recentFailures[recentFailures.length - 1].submittedAt;
        return { status: 429, error: 'Please review the course and try again later', retryAfterSeconds: Math.max(1, Math.ceil((oldest.getTime() + 60 * 60 * 1000 - now.getTime()) / 1000)) };
      }
      assertConfidenceQuestionIds(confidence, quiz.questions);
      const graded = gradeQuizWithItemEvidence(quiz, answers);
      await tx.quizAttempt.create({ data: { userId, courseId, contentId, submissionId, answerDigest, revision,
        publicationId: course.activePublicationId, confidenceDigest: confidence.digest, score: graded.score, passed: graded.passed,
        itemEvidence: { create: graded.items.map(item => ({
          questionId: item.questionId, correct: item.correct, confidence: confidence.values.get(item.questionId) ?? null,
        })) } } });
      if (graded.passed) {
        const existing = await tx.courseContentProgress.findUnique({ where: { userId_contentId: { userId, contentId } }, select: { revision: true } });
        if (existing?.revision !== revision) {
          await tx.courseContentProgress.upsert({ where: { userId_contentId: { userId, contentId } }, create: { userId, courseId, contentId, revision }, update: { revision, completedAt: now } });
        }
        await recordCourseCompletion(tx, userId, courseId);
      }
      return { status: 200, score: graded.score, passed: graded.passed };
    });

    let outcome: AttemptOutcome;
    try { outcome = await attempt(); }
    catch (error) {
      // Two identical submissions can race at the unique key. Reading the
      // committed attempt yields the same result without double-counting it.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      outcome = await contentTransaction(async tx => {
        const course = await tx.course.findUnique({ where: { id: courseId }, select: { activePublicationId: true } });
        if (!course?.activePublicationId) return { status: 404, error: 'Course not found' };
        const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } });
        if (!enrollment) return { status: 403, error: 'Enrollment required' };
        const saved = await tx.quizAttempt.findUnique({ where: { userId_contentId_submissionId: { userId, contentId, submissionId } },
          include: { itemEvidence: { select: { questionId: true } } } });
        if (!saved) throw error;
        if (saved.itemEvidence.length) {
          assertConfidenceQuestionIds(confidence, saved.itemEvidence.map(item => ({ id: item.questionId })));
        }
        if (saved.answerDigest !== answerDigest || saved.courseId !== courseId ||
            saved.publicationId !== body.publicationId || (saved.confidenceDigest ?? null) !== confidence.digest) {
          return { status: 409, error: 'Submission ID was already used for different answers, confidence or a different publication' };
        }
        return { status: 200, score: saved.score, passed: saved.passed };
      });
    }
    if (outcome.status === 200) return NextResponse.json({ score: outcome.score, passed: outcome.passed });
    if (outcome.status === 429) return NextResponse.json({ error: outcome.error, retryAfterSeconds: outcome.retryAfterSeconds }, { status: 429, headers: { 'Retry-After': String(outcome.retryAfterSeconds) } });
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  } catch (error) {
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof InvalidQuizAnswersError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof InvalidQuizConfidenceError) return NextResponse.json({ error: error.message }, { status: 400 });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to grade course quiz:', error);
    return NextResponse.json({ error: 'Failed to grade quiz' }, { status: 500 });
  }
}
