import { checkQuizMediaNewLearnerAttempt, QUIZ_MEDIA_CAPABILITY_HEADER } from '@/lib/quiz-media-compatibility';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { contentQuiz, courseContentRevision, gradeQuizWithItemEvidence, InvalidQuizAnswersError } from '@/lib/server/course-progress';
import { matchesD1CourseContentVersionToken } from '@/lib/server/d1-course-version';
import { assertConfidenceQuestionIds, InvalidQuizConfidenceError, parseQuizConfidence } from '@/lib/server/quiz-confidence';
import { getQuizValidationError } from '@/app/courses/[courseId]/contents/types';
import { CoursePathError } from '@/lib/server/course-path';
import { assertD1ContentAccess, assertD1LearnerSnapshot, courseLearningDatabase, d1CourseSnapshotGuard,
  d1LearningDate, isD1CourseSnapshotConflict, readD1CourseSnapshot } from '@/lib/server/d1-course-learning';
import { d1CourseRewardStatements, d1RewardNodes } from '@/lib/server/d1-course-rewards';

type Params = { params: Promise<{ courseId: string; contentId: string }> };

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
    const confidence = parseQuizConfidence(body.confidenceByQuestion);
    // Store only a private digest for retry identity. Never expose answer keys,
    // answer-space hashes or private item evidence to the learner response.
    const answerDigest = createHash('sha256').update(JSON.stringify(body.answers)).digest('hex');
    const db = courseLearningDatabase();
    const operationId = `attempt_${randomUUID()}`;
    for (let retry = 0; retry < 4; retry++) {
      const snapshot = await readD1CourseSnapshot(db, session.user, courseId, { contentId, submissionId });
      assertD1LearnerSnapshot(snapshot, { requireEnrollment: true, requirePublication: true });
      const previous = snapshot.attempt;
      if (previous) {
        if (previous.questionIds.length) assertConfidenceQuestionIds(confidence, previous.questionIds.map(id => ({ id })));
        if (previous.courseId !== courseId || previous.publicationId !== body.publicationId || previous.answerDigest !== answerDigest ||
            (previous.confidenceDigest ?? null) !== confidence.digest) {
          throw new CoursePathError('Submission ID was already used for different answers, confidence or a different publication', 409);
        }
        // Historical retries may outlive publication changes without issuing
        // fresh credit for the newer publication.
        return NextResponse.json({ score: previous.score, passed: Boolean(previous.passed) });
      }
      if (snapshot.course!.activePublicationId !== body.publicationId) throw new CoursePathError('Quiz changed; reload before submitting', 409);
      const content = snapshot.contents.find(row => row.id === contentId);
      if (!content) throw new CoursePathError('Content not found', 404);
      if (snapshot.contents.some(row => row.parentId === contentId)) throw new CoursePathError('Only leaf quizzes can be submitted', 409);
      const quiz = contentQuiz(content);
      if (!quiz || getQuizValidationError(quiz)) throw new CoursePathError('Quiz is not ready', 409);
      if (!matchesD1CourseContentVersionToken(body.contentVersionToken, body.publicationId, content.id)) throw new CoursePathError('Quiz changed; reload before submitting', 409);
      const now = new Date();
      assertD1ContentAccess(snapshot, contentId, true, now.getTime());
      const mediaGate = checkQuizMediaNewLearnerAttempt(courseId, request.headers.get(QUIZ_MEDIA_CAPABILITY_HEADER), content.content);
      if (!mediaGate.ok) return NextResponse.json({ error: mediaGate.error.message, code: mediaGate.error.code },
        { status: mediaGate.error.status, headers: { 'Cache-Control': 'private, no-store' } });
      const recentFailures = snapshot.recentFailures.map(row => d1LearningDate(row.submittedAt).getTime())
        .filter(time => time >= now.getTime() - 60 * 60 * 1000);
      if (recentFailures.length >= 5) {
        const retryAfterSeconds = Math.max(1, Math.ceil((Math.min(...recentFailures) + 60 * 60 * 1000 - now.getTime()) / 1000));
        return NextResponse.json({ error: 'Please review the course and try again later', retryAfterSeconds },
          { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
      }
      assertConfidenceQuestionIds(confidence, quiz.questions);
      const graded = gradeQuizWithItemEvidence(quiz, body.answers);
      const revision = courseContentRevision(content);
      const timestamp = now.toISOString();
      const evidence = graded.items.map(item => ({ ...item, confidence: confidence.values.get(item.questionId) ?? null }));
      const statements = [d1CourseSnapshotGuard(db, snapshot),
        db.prepare(`INSERT INTO QuizAttempt (id, userId, courseId, contentId, submissionId, answerDigest, revision,
          publicationId, confidenceDigest, score, passed, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(operationId, userId, courseId, contentId, submissionId, answerDigest, revision, body.publicationId,
            confidence.digest, graded.score, graded.passed ? 1 : 0, timestamp),
        db.prepare(`INSERT INTO QuizAttemptItemEvidence (attemptId, questionId, correct, confidence)
          SELECT ?, json_extract(value, '$.questionId'), json_extract(value, '$.correct'), json_extract(value, '$.confidence') FROM json_each(?)`)
          .bind(operationId, JSON.stringify(evidence)),
      ];
      if (graded.passed) {
        statements.push(db.prepare(`INSERT INTO CourseContentProgress (userId, courseId, contentId, revision, completedAt)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(userId, contentId) DO UPDATE SET revision = excluded.revision, completedAt = excluded.completedAt
          WHERE CourseContentProgress.revision <> excluded.revision`).bind(userId, courseId, contentId, revision, timestamp),
        ...d1CourseRewardStatements(db, { courseId, operationId, now: timestamp, nodes: d1RewardNodes(snapshot.contents),
          gate: { sql: 'SELECT 1', values: [] }, mode: { kind: 'learner', userId } }));
      }
      try {
        await db.batch(statements);
        return NextResponse.json({ score: graded.score, passed: graded.passed });
      } catch (error) {
        if (!isD1CourseSnapshotConflict(error)) throw error;
        if (retry === 3) throw new CoursePathError('Course changed concurrently; retry', 409);
      }
    }
    throw new CoursePathError('Course changed concurrently; retry', 409);
  } catch (error) {
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof InvalidQuizAnswersError || error instanceof InvalidQuizConfidenceError) return NextResponse.json({ error: error.message }, { status: 400 });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to grade course quiz:', error);
    return NextResponse.json({ error: 'Failed to grade quiz' }, { status: 500 });
  }
}
