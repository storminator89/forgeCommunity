import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { contentQuiz, courseContentRevision, isQuizLikeContent } from '@/lib/server/course-progress';
import { matchesD1CourseContentVersionToken } from '@/lib/server/d1-course-version';
import { CoursePathError } from '@/lib/server/course-path';
import { assertD1ContentAccess, assertD1LearnerSnapshot, courseLearningDatabase, d1CompletionState, d1CourseSnapshotGuard,
  d1LearningDate, d1LatestQuizAttempts, d1AwaitingGradeContentIds, isD1CourseSnapshotConflict, readD1CourseSnapshot } from '@/lib/server/d1-course-learning';
import { d1CourseRewardStatements, d1RewardNodes } from '@/lib/server/d1-course-rewards';
import { randomUUID } from 'node:crypto';

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: NextRequest, props: Params) {
  const { courseId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const snapshot = await readD1CourseSnapshot(courseLearningDatabase(), session.user, courseId);
    assertD1LearnerSnapshot(snapshot);
    const progress = snapshot.enrollment && snapshot.course!.activePublicationId ? d1CompletionState(snapshot)
      : { completedContentIds: [], complete: false, canIssueCertificate: false };
    return NextResponse.json({ ...progress, canTrack: Boolean(snapshot.enrollment && snapshot.course!.activePublicationId),
      hasCertificate: Boolean(snapshot.certificate), completedAt: snapshot.enrollment?.completedAt == null ? null : d1LearningDate(snapshot.enrollment.completedAt),
      publicationId: snapshot.course!.activePublicationId, latestQuizAttempts: d1LatestQuizAttempts(snapshot),
      awaitingGradeContentIds: d1AwaitingGradeContentIds(snapshot) },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Failed to read course progress:', error);
    return NextResponse.json({ error: 'Failed to read course progress' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, props: Params) {
  const { courseId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await readJsonObject(request, 16 * 1024);
    if (typeof body.contentId !== 'string' || !body.contentId || typeof body.completed !== 'boolean' ||
        typeof body.publicationId !== 'string' || typeof body.contentVersionToken !== 'string') {
      return NextResponse.json({ error: 'Invalid progress request' }, { status: 400 });
    }
    const db = courseLearningDatabase();
    const now = new Date().toISOString();
    const operationId = `progress_${randomUUID()}`;
    for (let retry = 0; retry < 4; retry++) {
      const snapshot = await readD1CourseSnapshot(db, session.user, courseId);
      assertD1LearnerSnapshot(snapshot, { requireEnrollment: true, requirePublication: true });
      // Full publication parity and current authoritative prerequisite proof.
      d1CompletionState(snapshot);
      const content = snapshot.contents.find(row => row.id === body.contentId);
      if (!content) throw new CoursePathError('Content not found', 404);
      if (snapshot.contents.some(row => row.parentId === content.id) || content.type === 'ASSIGNMENT' || contentQuiz(content) || isQuizLikeContent(content)) {
        throw new CoursePathError('Only non-quiz, non-assignment leaf content can be marked complete', 409);
      }
      if (snapshot.course!.activePublicationId !== body.publicationId || !matchesD1CourseContentVersionToken(body.contentVersionToken, body.publicationId, content.id)) {
        throw new CoursePathError('Course publication changed; reload before updating progress', 412);
      }
      assertD1ContentAccess(snapshot, content.id, body.completed);
      const revision = courseContentRevision(content);
      const nextProgress = snapshot.progress.filter(row => row.contentId !== content.id);
      if (body.completed) nextProgress.push({ contentId: content.id, revision });
      const state = d1CompletionState({ ...snapshot, progress: nextProgress });
      const mutation = body.completed ? db.prepare(`INSERT INTO CourseContentProgress (userId, courseId, contentId, revision, completedAt)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(userId, contentId) DO UPDATE SET revision = excluded.revision, completedAt = excluded.completedAt
        WHERE CourseContentProgress.revision <> excluded.revision`).bind(session.user.id, courseId, content.id, revision, now)
        : db.prepare('DELETE FROM CourseContentProgress WHERE userId = ? AND courseId = ? AND contentId = ?').bind(session.user.id, courseId, content.id);
      try {
        await db.batch([d1CourseSnapshotGuard(db, snapshot), mutation,
          ...d1CourseRewardStatements(db, { courseId, operationId, now, nodes: d1RewardNodes(snapshot.contents),
            gate: { sql: 'SELECT 1', values: [] }, mode: { kind: 'learner', userId: session.user.id } })]);
        return NextResponse.json(state);
      } catch (error) {
        if (!isD1CourseSnapshotConflict(error)) throw error;
        if (retry === 3) throw new CoursePathError('Course changed concurrently; retry', 409);
      }
    }
    throw new CoursePathError('Course changed concurrently; retry', 409);
  } catch (error) {
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to update course progress:', error);
    return NextResponse.json({ error: 'Failed to update course progress' }, { status: 500 });
  }
}
