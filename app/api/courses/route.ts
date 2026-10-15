import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/options';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';
import { assignmentPassedContentIds, courseContentRevision, courseLeaves } from '@/lib/server/course-progress';
import { CoursePathError, prepareCoursePath, publicationPathNodes } from '@/lib/server/course-path';
import { publishedCourseWhere, activeCourseContentWhere } from '@/lib/server/published-course';
import { publicationDigest, type CoursePayload } from '@/lib/server/course-authoring';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { contentTransaction } from './[courseId]/contents/content-mutations';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;

function optionalDate(value: FormDataEntryValue | null): Date | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) throw new Error('Invalid date');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
  if (value.length === 10 && date.toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return date;
}

function optionalNumber(value: FormDataEntryValue | null, integer = false): number | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid number');
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && (!Number.isSafeInteger(number) || number < 1))) throw new Error('Invalid number');
  return number;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    const formattedCourses = await contentTransaction(async tx => {
    const courses = await tx.course.findMany({
      where: publishedCourseWhere,
      select: {
        id: true,
        title: true,
        description: true,
        instructorId: true,
        instructor: { select: { name: true } },
        startDate: true,
        endDate: true,
        price: true,
        currency: true,
        maxStudents: true,
        rewardEligible: true,
        activePublicationId: true,
        imageUrl: true,
        _count: { select: { enrollments: true } },
        enrollments: {
          where: { userId: userId ?? '' },
          select: { completedAt: true },
        },
      },
    });

    // completedAt is the first historical completion, not proof that the
    // current leaf revisions are complete. Batch only this viewer's enrolled
    // courses; quiz answer keys never leave the server.
    const enrolledCourseIds = userId ? courses.filter(course => course.enrollments.length > 0).map(course => course.id) : [];
    const [contents, progress, publications] = enrolledCourseIds.length ? await Promise.all([
      tx.courseContent.findMany({
        where: { courseId: { in: enrolledCourseIds }, ...activeCourseContentWhere },
        select: { id: true, courseId: true, parentId: true, type: true, content: true, order: true },
      }),
      tx.courseContentProgress.findMany({
        where: { userId: userId!, courseId: { in: enrolledCourseIds } },
        select: { courseId: true, contentId: true, revision: true },
      }),
      tx.coursePublication.findMany({ where: { id: { in: courses.filter(course => course.enrollments.length > 0)
        .map(course => course.activePublicationId).filter((id): id is string => id !== null) } },
        select: { id: true, courseId: true, payload: true } }),
    ]) : [[], [], []];
    const contentsByCourse = new Map<string, typeof contents>();
    for (const content of contents) {
      const group = contentsByCourse.get(content.courseId) ?? [];
      group.push(content);
      contentsByCourse.set(content.courseId, group);
    }
    const revisionsByCourse = new Map<string, Map<string, string>>();
    for (const row of progress) {
      const revisions = revisionsByCourse.get(row.courseId) ?? new Map<string, string>();
      revisions.set(row.contentId, row.revision);
      revisionsByCourse.set(row.courseId, revisions);
    }
    const publicationById = new Map(publications.map(publication => [publication.id, publication]));
    const completedNow = new Map<string, boolean>();
    for (const course of courses.filter(row => row.enrollments.length > 0)) {
      const courseId = course.id;
      const publication = course.activePublicationId ? publicationById.get(course.activePublicationId) : null;
      if (!publication || publication.courseId !== courseId) throw new CoursePathError('Course publication is unavailable', 409);
      const nodes = publicationPathNodes(publication.payload);
      const courseContents = contentsByCourse.get(courseId) ?? [];
      const projected = new Map(courseContents.map(row => [row.id, row]));
      if (projected.size !== nodes.length || nodes.some(node => {
        const row = projected.get(node.id);
        return !row || row.parentId !== node.parentId || row.order !== node.order;
      })) throw new CoursePathError('Published course contents do not match the active publication', 409);
      const leaves = courseLeaves(courseContents);
      const revisions = revisionsByCourse.get(courseId);
      const assignmentPasses = new Set((await assignmentPassedContentIds(tx, courseId,
        leaves.filter(leaf => leaf.type === 'ASSIGNMENT'), [userId!])).map(row => row.contentId));
      const rawCompleted = leaves.filter(leaf => leaf.type === 'ASSIGNMENT' ? assignmentPasses.has(leaf.id)
        : revisions?.get(leaf.id) === courseContentRevision(leaf)).map(leaf => leaf.id);
      const access = prepareCoursePath(nodes)(rawCompleted);
      completedNow.set(courseId, leaves.length > 0 && leaves.every(leaf => access.get(leaf.id)?.completed));
    }

    return courses.map(course => ({
      id: course.id,
      title: course.title,
      instructor: course.instructor.name,
      duration: course.startDate && course.endDate
        ? `${Math.ceil((course.endDate.getTime() - course.startDate.getTime()) / (1000 * 60 * 60 * 24 * 7))} Wochen`
        : 'Flexibel',
      startDate: course.startDate ? course.startDate.toISOString().split('T')[0] : null,
      endDate: course.endDate ? course.endDate.toISOString().split('T')[0] : null,
      category: course.description,
      participants: course._count.enrollments,
      maxStudents: course.maxStudents,
      rewardEligible: course.rewardEligible,
      canApproveRewards: session?.user?.role === 'ADMIN',
      price: course.price,
      currency: course.currency,
      isEnrolled: course.enrollments.length > 0,
      completed: completedNow.get(course.id) ?? false,
      everCompleted: Boolean(course.enrollments[0]?.completedAt),
      canDelete: !!userId && (course.instructorId === userId || session?.user?.role === 'ADMIN'),
      imageUrl: course.imageUrl,
    }));
    });

    return NextResponse.json(formattedCourses, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Failed to fetch courses:', error);
    return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }


  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_REQUEST_BYTES) {
      return NextResponse.json({ error: 'File is too large' }, { status: 413 });
    }
    const limitedRequest = await requestWithBodyLimit(request, MAX_MULTIPART_REQUEST_BYTES);
    const formData = await limitedRequest.formData();
    const title = formData.get('title');
    const description = formData.get('description');
    const currency = formData.get('currency');
    const image = formData.get('image');
    if (typeof title !== 'string' || !title.trim() || title.length > 300 ||
        typeof description !== 'string' || !description.trim() || description.length > 10_000 ||
        (currency !== null && typeof currency !== 'string') || (image !== null && !(image instanceof File))) {
      return NextResponse.json({ error: 'Invalid course fields' }, { status: 400 });
    }
    // A newly created course is a private draft. The legacy upload writes to
    // public/, so require subsequent use of the authenticated course asset API.
    if (image) return NextResponse.json({ error: 'Bitte den Kurs zuerst anlegen und das Bild anschließend privat hochladen.' }, { status: 400 });
    let startDate: Date | null;
    let endDate: Date | null;
    let price: number | null;
    let maxStudents: number | null;
    try {
      startDate = optionalDate(formData.get('startDate'));
      endDate = optionalDate(formData.get('endDate'));
      price = optionalNumber(formData.get('price'));
      maxStudents = optionalNumber(formData.get('maxStudents'), true);
    } catch {
      return NextResponse.json({ error: 'Invalid course dates or numbers' }, { status: 400 });
    }
    if (startDate && endDate && endDate < startDate) {
      return NextResponse.json({ error: 'End date precedes start date' }, { status: 400 });
    }

    const staged: CoursePayload = { schemaVersion: 1, title: sanitizeTextServer(title),
      description: sanitizeTextServer(description), startDate: startDate?.toISOString() ?? null,
      endDate: endDate?.toISOString() ?? null, imageUrl: null, contents: [] };
    if (!staged.title || !staged.description) {
      return NextResponse.json({ error: 'Invalid course fields' }, { status: 400 });
    }
    const newCourse = await prisma.$transaction(async tx => {
      const course = await tx.course.create({
        data: {
          title: 'Unveröffentlichter Kurs', description: '', price,
          currency: currency || null, maxStudents,
          instructor: { connect: { id: session.user.id } },
        },
        include: { instructor: { select: { name: true } } },
      });
      await tx.courseDraft.create({ data: { courseId: course.id, revision: 0,
        payload: JSON.stringify(staged), digest: publicationDigest(staged), lastEditorId: session.user.id } });
      return course;
    });

    return NextResponse.json(newCourse, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Failed to create course:', error);
    return NextResponse.json(
      { error: 'Failed to create course' },
      { status: error instanceof RequestBodyLimitError ? 413 : 500 }
    );
  }
}
