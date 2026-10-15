import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { completionState, contentQuiz, courseContentRevision, isQuizLikeContent, matchesContentVersionToken, recordCourseCompletion } from '@/lib/server/course-progress';
import { contentTransaction } from '../contents/content-mutations';
import { hasCurrentAdminReadAccess } from '@/lib/server/read-access';

type Params = { params: Promise<{ courseId: string }> };

export async function GET(_request: NextRequest, props: Params) {
  const { courseId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const result = await contentTransaction(async tx => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { instructorId: true, activePublicationId: true } });
      if (!course) return { status: 404 as const };
      const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: session.user.id, courseId } }, select: { id: true, completedAt: true } });
      const isEditor = course.instructorId === session.user.id || await hasCurrentAdminReadAccess(tx, session.user);
      if (!course.activePublicationId && !isEditor) return { status: 404 as const };
      if (!enrollment && !isEditor) return { status: 403 as const };
      const certificate = await tx.certificate.findFirst({ where: { userId: session.user.id, courseId }, select: { id: true } });
      const progress = enrollment && course.activePublicationId ? await completionState(tx, session.user.id, courseId) : { completedContentIds: [], complete: false };
      return { status: 200 as const, payload: { ...progress, canTrack: Boolean(enrollment && course.activePublicationId),
        hasCertificate: Boolean(certificate), completedAt: enrollment?.completedAt ?? null, publicationId: course.activePublicationId } };
    });
    if (result.status !== 200) return NextResponse.json({ error: result.status === 404 ? 'Course not found' : 'Unauthorized' }, { status: result.status });
    return NextResponse.json(result.payload, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
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
    const state = await contentTransaction(async tx => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { activePublicationId: true } });
      if (!course?.activePublicationId) return { status: 404 as const };
      const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: session.user.id, courseId } }, select: { id: true } });
      if (!enrollment) return { status: 403 as const };
      const content = await tx.courseContent.findUnique({ where: { id: body.contentId as string }, select: { id: true, courseId: true, parentId: true, type: true, content: true, archivedAt: true, children: { where: { archivedAt: null }, select: { id: true }, take: 1 } } });
      if (!content || content.courseId !== courseId || content.archivedAt) return { status: 404 as const };
      if (content.children.length || contentQuiz(content) || isQuizLikeContent(content)) return { status: 409 as const };
      if (course.activePublicationId !== body.publicationId || !matchesContentVersionToken(body.contentVersionToken, course.activePublicationId, content)) return { status: 412 as const };
      if (body.completed) {
        const revision = courseContentRevision(content);
        const existing = await tx.courseContentProgress.findUnique({ where: { userId_contentId: { userId: session.user.id, contentId: content.id } }, select: { revision: true } });
        if (existing?.revision !== revision) {
          await tx.courseContentProgress.upsert({
            where: { userId_contentId: { userId: session.user.id, contentId: content.id } },
            create: { userId: session.user.id, courseId, contentId: content.id, revision },
            update: { revision, completedAt: new Date() },
          });
        }
      } else {
        await tx.courseContentProgress.deleteMany({ where: { userId: session.user.id, courseId, contentId: content.id } });
      }
      return { status: 200 as const, progress: await recordCourseCompletion(tx, session.user.id, courseId) };
    });
    if (state.status === 403) return NextResponse.json({ error: 'Enrollment required' }, { status: 403 });
    if (state.status === 404) return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    if (state.status === 409) return NextResponse.json({ error: 'Only non-quiz leaf content can be marked complete' }, { status: 409 });
    if (state.status === 412) return NextResponse.json({ error: 'Course publication changed; reload before updating progress' }, { status: 412 });
    return NextResponse.json(state.progress);
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to update course progress:', error);
    return NextResponse.json({ error: 'Failed to update course progress' }, { status: 500 });
  }
}
