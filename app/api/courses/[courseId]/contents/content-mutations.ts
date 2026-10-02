import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { sanitizeCourseTextContentServer, sanitizeTextServer } from '@/lib/server/sanitize-html';
import { parseQuizContent } from '@/app/courses/[courseId]/contents/types';
import { getH5PEmbedUrl } from '@/app/courses/[courseId]/contents/content-form-utils';
import { getSafeEmbedUrl, getYouTubeEmbedUrl } from '@/lib/security';

export class ContentMutationError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export async function contentTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      if (attempt >= 3) throw new ContentMutationError('Die Kursstruktur wurde gleichzeitig geändert. Bitte laden Sie sie neu und versuchen Sie es erneut.', 409);
    }
  }
}

export function canEdit(instructorId: string, user: { id: string; role?: string | null }) {
  if (instructorId !== user.id && user.role !== 'ADMIN') throw new ContentMutationError('Unauthorized', 403);
}

export function validateContentFields(body: Record<string, unknown>, creating: boolean) {
  const { title, content, type, order, parentId } = body;
  if ((creating && typeof title !== 'string') || (title !== undefined && (typeof title !== 'string' || title.length > 300 || !sanitizeTextServer(title))) ||
    (content !== undefined && (typeof content !== 'string' || content.length > 100_000)) ||
    (type !== undefined && type !== null && (typeof type !== 'string' || !['TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ'].includes(type))) ||
    (order !== undefined && (!Number.isInteger(order) || Number(order) < 0 || Number(order) > 2_147_483_647)) ||
    (parentId !== undefined && parentId !== null && (typeof parentId !== 'string' || !parentId.trim()))) {
    throw new ContentMutationError('Invalid content fields');
  }
}

export function prepareContent(content: string, type: string | null) {
  if (type === 'QUIZ') {
    // An empty newly selected quiz is a draft, never persisted as malformed JSON.
    const quiz = content === '' ? { questions: [] } : parseQuizContent(content);
    if (!quiz) throw new ContentMutationError('Invalid quiz content');
    return JSON.stringify(quiz);
  }
  if (type === 'TEXT' || !type) return sanitizeCourseTextContentServer(content);
  const source = content.trim();
  if (!source) return '';
  // Media are URLs, not HTML text. HTML escaping corrupts query strings and
  // stripping an H5P iframe discards its source entirely. Persist only safe sources.
  if (type === 'H5P') {
    const url = getH5PEmbedUrl(source);
    if (!url) throw new ContentMutationError('Invalid H5P source');
    return url;
  }
  const safe = type === 'VIDEO' ? getYouTubeEmbedUrl(source) || getSafeEmbedUrl(source, 'video') : getSafeEmbedUrl(source, 'audio');
  if (!safe) throw new ContentMutationError('Unsupported media source');
  return source;
}

export function presentContent<T extends { type: string | null; content: string }>(content: T) {
  return { ...content, type: (!content.type || content.type === 'TEXT') && parseQuizContent(content.content) ? 'QUIZ' : content.type ?? 'TEXT' };
}

export async function assertParent(tx: Prisma.TransactionClient, courseId: string, parentId: string | null, movedId?: string) {
  const visited = new Set<string>();
  let ancestorId = parentId;
  while (ancestorId) {
    if (ancestorId === movedId || visited.has(ancestorId)) throw new ContentMutationError('Invalid parent content');
    visited.add(ancestorId);
    const ancestor = await tx.courseContent.findUnique({ where: { id: ancestorId }, select: { courseId: true, parentId: true } });
    if (!ancestor || ancestor.courseId !== courseId) throw new ContentMutationError('Invalid parent content');
    ancestorId = ancestor.parentId;
  }
}

export async function siblings(tx: Prisma.TransactionClient, courseId: string, parentId: string | null) {
  return tx.courseContent.findMany({ where: { courseId, parentId }, select: { id: true, order: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
}

export async function normalizeOrder(tx: Prisma.TransactionClient, ids: string[]) {
  for (const [index, id] of ids.entries()) {
    await tx.courseContent.update({ where: { id }, data: { order: index + 1 } });
  }
}
