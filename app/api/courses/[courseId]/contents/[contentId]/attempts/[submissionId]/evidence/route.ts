import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { contentQuiz, courseContentRevision } from '@/lib/server/course-progress';
import { assertCurrentPrerequisites, CoursePathError } from '@/lib/server/course-prerequisites';
import { contentTransaction } from '../../../../content-mutations';

type Params = { params: Promise<{ courseId: string; contentId: string; submissionId: string }> };
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const reviewPrompt = 'Nutze die Kursmaterialien zur Wiederholung. Eine spätere Abrufübung hilft beim Festigen.';

/**
 * The question-level evidence is deliberately server-private: this endpoint
 * never exposes correctness, question IDs, cross-tabs, raw answers or keys.
 * Those would create a new answer oracle for credential-bearing retakes.
 */
export async function GET(_request: NextRequest, props: Params) {
  const { courseId, contentId, submissionId } = await props.params;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(submissionId)) {
    return NextResponse.json({ error: 'Attempt not found' }, { status: 404, headers: privateHeaders });
  }
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: privateHeaders });
    }
    const userId = session.user.id;
    const outcome = await contentTransaction(async tx => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { activePublicationId: true } });
      if (!course?.activePublicationId) return { status: 404 as const };
      const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } });
      if (!enrollment) return { status: 403 as const };
      const content = await tx.courseContent.findUnique({ where: { id: contentId },
        select: { id: true, courseId: true, type: true, content: true, archivedAt: true,
          children: { where: { archivedAt: null }, select: { id: true }, take: 1 } } });
      if (!content || content.courseId !== courseId || content.archivedAt || content.children.length || !contentQuiz(content)) {
        return { status: 404 as const };
      }
      await assertCurrentPrerequisites(tx, userId, courseId, contentId, course.activePublicationId);
      const attempt = await tx.quizAttempt.findUnique({
        where: { userId_contentId_submissionId: { userId, contentId, submissionId } },
        select: { courseId: true, publicationId: true, revision: true, confidenceDigest: true,
          _count: { select: { itemEvidence: true } } },
      });
      if (!attempt || attempt.courseId !== courseId || attempt.publicationId !== course.activePublicationId ||
          attempt.revision !== courseContentRevision(content)) return { status: 404 as const };
      return { status: 200 as const, evidenceRecorded: attempt._count.itemEvidence > 0,
        confidenceRecorded: attempt.confidenceDigest !== null };
    });
    if (outcome.status !== 200) return NextResponse.json({ error: outcome.status === 403 ? 'Enrollment required' : 'Attempt not found' },
      { status: outcome.status, headers: privateHeaders });
    return NextResponse.json({ evidenceRecorded: outcome.evidenceRecorded, confidenceRecorded: outcome.confidenceRecorded,
      reviewPrompt }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message },
      { status: error.status, headers: privateHeaders });
    console.error('Failed to read quiz evidence:', error);
    return NextResponse.json({ error: 'Failed to read quiz evidence' }, { status: 500, headers: privateHeaders });
  }
}
