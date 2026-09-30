import 'server-only';

import { Prisma, type Enrollment } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import prisma from '@/lib/prisma';

export type CourseActor = { id: string; role?: string | null };
export class CourseLifecycleError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'CourseLifecycleError';
  }
}

// Both providers can abort a competing serializable transaction. A unique-key
// race is also safe to retry: the entire interactive transaction was rolled back.
function retryable(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return ['P2034', 'P2002', 'SQLITE_BUSY', 'SQLITE_LOCKED'].includes(candidate.code ?? '') ||
    /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(candidate.message ?? '');
}

export async function courseTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if (attempt >= 5 || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}

export function canManageCourse(actor: CourseActor, course: { instructorId: string }) {
  return actor.role === 'ADMIN' || course.instructorId === actor.id;
}

export type LearningContent = { id: string; type: string | null; content: string; isRequired: boolean };
export function isLearningContent(content: Pick<LearningContent, 'type' | 'content'>) {
  const type = content.type ?? 'TEXT'; // Legacy null types use the existing text sanitizer.
  if (!['TEXT', 'VIDEO', 'AUDIO', 'H5P'].includes(type)) return false;
  if (type !== 'TEXT') return content.content.trim().length > 0;
  // Chapter shells and empty rich-text paragraphs are navigation, not learning
  // requirements. Embedded media still count as actual text-lesson material.
  if (/<(?:img|video|audio|iframe)\b/i.test(content.content)) return true;
  return content.content.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160|#xa0);/gi, ' ').replace(/[\s\u200B-\u200D\uFEFF]/g, '').length > 0;
}

export function progressSummary(contents: LearningContent[], progress: { contentId: string }[]) {
  const learning = contents.filter(isLearningContent);
  const learningIds = new Set(learning.map((content) => content.id));
  const requiredContentIds = learning.filter((content) => content.isRequired).map((content) => content.id);
  const completedContentIds = [...new Set(progress.map((mark) => mark.contentId))].filter((id) => learningIds.has(id));
  const completedIds = new Set(completedContentIds);
  const completedCount = requiredContentIds.filter((id) => completedIds.has(id)).length;
  const requiredCount = requiredContentIds.length;
  return {
    learningContentIds: [...learningIds], requiredContentIds, completedContentIds, completedCount, requiredCount,
    percentage: requiredCount > 0 ? Math.floor(completedCount / requiredCount * 100) : 0,
  };
}

export function enrollmentSnapshot(enrollment: Pick<Enrollment, 'id' | 'enrolledAt' | 'completedAt'>) {
  return { id: enrollment.id, enrolledAt: enrollment.enrolledAt, completedAt: enrollment.completedAt };
}

export async function enrollInCourse(courseId: string, actor: CourseActor, target?: { userId?: string; email?: string }) {
  return courseTransaction(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: courseId } });
    if (!course) throw new CourseLifecycleError(404, 'COURSE_NOT_FOUND', 'Course not found');
    if (target && !canManageCourse(actor, course)) {
      throw new CourseLifecycleError(403, 'COURSE_FORBIDDEN', 'Only the course owner or an admin may grant access');
    }
    const user = await tx.user.findUnique({
      where: target?.email ? { email: target.email } : { id: target?.userId ?? actor.id }, select: { id: true },
    });
    if (!user) throw new CourseLifecycleError(404, 'USER_NOT_FOUND', 'User not found');
    const existing = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } });
    if (existing) return { enrollment: enrollmentSnapshot(existing) };
    if (!target && (course.price ?? 0) > 0) {
      throw new CourseLifecycleError(403, 'PAID_COURSE_REQUIRES_ACCESS', 'The course owner or an admin must unlock this paid course');
    }
    // A real course-row write serializes capacity checks on PostgreSQL and
    // SQLite, including concurrent grants to different users. Preserve metadata.
    await tx.course.update({ where: { id: courseId }, data: { updatedAt: course.updatedAt } });
    if (course.maxStudents !== null && await tx.enrollment.count({ where: { courseId } }) >= course.maxStudents) {
      throw new CourseLifecycleError(409, 'COURSE_FULL', 'This course has reached its participant limit');
    }
    const enrollment = await tx.enrollment.create({ data: { userId: user.id, courseId } });
    return { enrollment: enrollmentSnapshot(enrollment) };
  });
}

const contentSelection = { id: true, type: true, content: true, isRequired: true } as const;
async function readProgress(tx: Prisma.TransactionClient, courseId: string, enrollment: Enrollment) {
  const contents = await tx.courseContent.findMany({ where: { courseId }, select: contentSelection, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
  const marks = await tx.contentProgress.findMany({ where: { enrollmentId: enrollment.id }, select: { contentId: true } });
  return progressSummary(contents, marks);
}

export async function existingCourseCertificate(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  // Historical duplicate IDs remain valid. All new flows consistently reuse the
  // latest snapshot rather than rewriting or removing any issued certificate.
  return tx.certificate.findFirst({ where: { userId, courseId }, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }] });
}

export async function ensureCourseCertificate(
  tx: Prisma.TransactionClient,
  enrollment: Pick<Enrollment, 'id' | 'userId' | 'courseId' | 'completedAt'>,
  snapshot: { courseName: string; userName: string },
) {
  if (!enrollment.completedAt) throw new CourseLifecycleError(403, 'COURSE_INCOMPLETE', 'Course has not been completed');
  const existing = await existingCourseCertificate(tx, enrollment.userId, enrollment.courseId);
  if (existing) return existing;
  // Lock the unique enrollment even for legacy completions. The certificate
  // table deliberately has no user/course unique index so history is preserved.
  await tx.enrollment.update({ where: { id: enrollment.id }, data: { completedAt: enrollment.completedAt } });
  return tx.certificate.create({ data: {
    id: uuidv4(), userId: enrollment.userId, courseId: enrollment.courseId,
    issuedAt: new Date(), ...snapshot,
  } });
}

export async function getCourseProgress(courseId: string, userId: string) {
  return courseTransaction(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw new CourseLifecycleError(404, 'COURSE_NOT_FOUND', 'Course not found');
    const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (!enrollment) throw new CourseLifecycleError(403, 'ENROLLMENT_REQUIRED', 'Enroll in this course before tracking progress');
    const summary = await readProgress(tx, courseId, enrollment);
    const certificate = await existingCourseCertificate(tx, userId, courseId);
    return { enrollment: enrollmentSnapshot(enrollment), ...summary,
      certificate: certificate ? { id: certificate.id, issuedAt: certificate.issuedAt } : null };
  });
}

export async function markCourseContent(courseId: string, contentId: string, userId: string, completed: boolean) {
  return courseTransaction(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: courseId }, select: { title: true } });
    if (!course) throw new CourseLifecycleError(404, 'COURSE_NOT_FOUND', 'Course not found');
    const content = await tx.courseContent.findUnique({ where: { id: contentId }, select: { ...contentSelection, courseId: true } });
    if (!content || content.courseId !== courseId) throw new CourseLifecycleError(404, 'CONTENT_NOT_FOUND', 'Content not found');
    if (!isLearningContent(content)) throw new CourseLifecycleError(400, 'CONTENT_NOT_MARKABLE', 'Empty chapters cannot be marked as learning content');
    let enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
    if (!enrollment) throw new CourseLifecycleError(403, 'ENROLLMENT_REQUIRED', 'Enroll in this course before tracking progress');
    if (enrollment.completedAt && !completed) {
      throw new CourseLifecycleError(409, 'COURSE_ALREADY_COMPLETED', 'A completed course cannot be reopened by removing progress');
    }
    // Always serialize writes for this learner/course before counting progress.
    // Completed enrollments are immutable, including after later syllabus edits.
    if (!enrollment.completedAt) {
      await tx.enrollment.update({ where: { id: enrollment.id }, data: { completedAt: null } });
      if (completed) {
        await tx.contentProgress.upsert({
          where: { enrollmentId_contentId: { enrollmentId: enrollment.id, contentId } },
          create: { enrollmentId: enrollment.id, contentId }, update: {},
        });
      } else {
        await tx.contentProgress.deleteMany({ where: { enrollmentId: enrollment.id, contentId } });
      }
    }
    const summary = await readProgress(tx, courseId, enrollment);
    if (!enrollment.completedAt && summary.requiredCount > 0 && summary.completedCount === summary.requiredCount) {
      enrollment = await tx.enrollment.update({ where: { id: enrollment.id }, data: { completedAt: new Date() } });
    }
    let certificate = await existingCourseCertificate(tx, userId, courseId);
    if (enrollment.completedAt && !certificate) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
      if (!user) throw new CourseLifecycleError(404, 'USER_NOT_FOUND', 'User not found');
      certificate = await ensureCourseCertificate(tx, enrollment, { courseName: course.title, userName: user.name || user.email });
    }
    return { enrollment: enrollmentSnapshot(enrollment), ...summary,
      certificate: certificate ? { id: certificate.id, issuedAt: certificate.issuedAt } : null };
  });
}
