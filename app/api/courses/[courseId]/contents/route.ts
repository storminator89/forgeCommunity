// app/api/courses/[courseId]/contents/route.ts

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { groupCourseContents } from '@/lib/server/group-course-contents';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { assertCanAttachH5P } from '@/lib/server/h5p-access';
import { H5PValidationError } from '@/lib/server/h5p-archive';
import { completionState, contentVersionToken, publicCourseContent } from '@/lib/server/course-progress';
import { CoursePathError, coursePathAccess, publicationPathNodes } from '@/lib/server/course-path';
import { reconcileCourseRewards } from '@/lib/server/rewards';
import { hasCurrentAdminReadAccess } from '@/lib/server/read-access';
import { assertParent, canEdit, contentTransaction, ContentMutationError, normalizeOrder, presentContent, prepareContent, siblings, validateContentFields } from './content-mutations';

// GET-Methode zum Abrufen der Kursinhalte
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> }
) {
  const params = await props.params;
  const courseId = params.courseId;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contents = await contentTransaction(async tx => {
      const course = await tx.course.findUnique({
        where: { id: courseId }, select: { instructorId: true, activePublicationId: true },
      });
      if (!course) throw new ContentMutationError('Course not found', 404);
      // Keep the editor decision, enrollment and returned scoring material in
      // one snapshot. Demoted enrolled admins receive the learner allowlist.
      const isEditor = course.instructorId === session.user.id || await hasCurrentAdminReadAccess(tx, session.user);
      if (!isEditor) {
        if (!course.activePublicationId) throw new ContentMutationError('Course not found', 404);
        const enrollment = await tx.enrollment.findUnique({
          where: { userId_courseId: { userId: session.user.id, courseId } }, select: { id: true },
        });
        if (!enrollment) throw new ContentMutationError('Unauthorized', 403);
      }
      const rows = await tx.courseContent.findMany({
        where: { courseId, archivedAt: null }, orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
      const publication = course.activePublicationId ? await tx.coursePublication.findUnique({
        where: { id: course.activePublicationId }, select: { courseId: true, payload: true },
      }) : null;
      if (course.activePublicationId && (!publication || publication.courseId !== courseId)) {
        throw new CoursePathError('Course publication is unavailable', 409);
      }
      const pathNodes = publication ? publicationPathNodes(publication.payload) : [];
      const access = publication && !isEditor ? coursePathAccess(pathNodes,
        (await completionState(tx, session.user.id, courseId)).completedContentIds) : null;
      const pathById = new Map(pathNodes.map(node => [node.id, node]));
      // Only current editors receive persisted quiz keys.
      return groupCourseContents(rows.map(content => {
        const presented = { ...presentContent(content), publicationId: course.activePublicationId,
          contentVersionToken: course.activePublicationId ? contentVersionToken(course.activePublicationId, content) : null };
        const path = pathById.get(content.id);
        const gate = access?.get(content.id);
        if (!isEditor && !path) throw new CoursePathError('Published course contents do not match the active publication', 409);
        if (isEditor) return { ...presented, prerequisiteIds: path?.prerequisiteIds ?? [] };
        if (gate?.locked) return { ...presented, content: '', contentVersionToken: null,
          locked: true, prerequisiteIds: gate.prerequisiteIds, missingPrerequisites: gate.missingPrerequisites };
        return { ...publicCourseContent(presented), locked: false,
          prerequisiteIds: gate?.prerequisiteIds ?? [], missingPrerequisites: [] };
      }));
    });
    return NextResponse.json(contents, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ContentMutationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Failed to fetch course contents:', error);
    return NextResponse.json({ error: 'Failed to fetch course contents' }, { status: 500 });
  }
}

// POST-Methode zum Hinzufügen eines neuen Inhalts
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> }
) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  const courseId = params.courseId;

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { instructorId: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (course.instructorId !== session.user.id && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await readJsonObject(request);
    validateContentFields(body, true);
    const { title, type, content, order } = body;
    const parentId = typeof body.parentId === 'string' ? body.parentId : null;
    const effectiveType = typeof type === 'string' ? type : 'TEXT';
    const sanitizedContent = prepareContent(typeof content === 'string' ? content : '', effectiveType);
    const newContent = await contentTransaction(async (tx) => {
      const currentCourse = await tx.course.findUnique({ where: { id: courseId }, select: { instructorId: true } });
      if (!currentCourse) throw new ContentMutationError('Course not found', 404);
      await canEdit(tx, currentCourse.instructorId, session.user);
      if (effectiveType === 'H5P' && sanitizedContent) await assertCanAttachH5P(session.user.id, session.user.role, sanitizedContent, request.nextUrl.origin, tx);
      await assertParent(tx, courseId, parentId);
      const currentSiblings = await siblings(tx, courseId, parentId);
      const insertionIndex = typeof order === 'number' ? Math.max(0, Math.min(order - 1, currentSiblings.length)) : currentSiblings.length;
      const created = await tx.courseContent.create({ data: {
        title: sanitizeTextServer(title as string), type: effectiveType === 'QUIZ' ? 'TEXT' : effectiveType as 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P',
        content: sanitizedContent, order: insertionIndex + 1, parentId, courseId,
      } });
      const ids = currentSiblings.map(item => item.id);
      ids.splice(insertionIndex, 0, created.id);
      await normalizeOrder(tx, ids);
      await reconcileCourseRewards(tx, courseId);
      return presentContent({ ...created, order: insertionIndex + 1 });
    });

    return NextResponse.json(newContent, { status: 201 });
  } catch (error) {
    if (error instanceof H5PValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ContentMutationError) return NextResponse.json({ error: error.message }, { status: error.status });
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to create course content:', error);
    return NextResponse.json({ error: 'Failed to create course content' }, { status: 500 });
  }
}
