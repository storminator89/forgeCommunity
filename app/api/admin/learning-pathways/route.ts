import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { Prisma } from '@/generated/prisma/client';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { createD1LearningPathwayDefinition } from '@/lib/server/d1-learning-pathway-create';
import { contentTransaction } from '@/app/api/courses/[courseId]/contents/content-mutations';
import { courseApprovalFingerprint, courseHasRewardableQuiz } from '@/lib/server/rewards';
import { LearningPathwayError, lockPathwayCourses } from '@/lib/server/learning-pathways';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

function plainText(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length >= min && text.length <= max && !/[<>\u0000-\u001f]/.test(text) ? text : null;
}

function definitionView(pathway: {
  id: string; title: string; description: string; badgeLabel: string; createdAt: Date;
  courses: { courseId: string; title: string; position: number }[];
}, unavailable: boolean) {
  return {
    id: pathway.id, title: pathway.title, description: pathway.description,
    badgeLabel: pathway.badgeLabel, createdAt: pathway.createdAt, unavailable,
    courses: pathway.courses.map(course => ({ courseId: course.courseId, title: course.title, order: course.position })),
  };
}

async function existingReceipt(tx: Prisma.TransactionClient, actorId: string, requestId: string,
  definition: { title: string; description: string; badgeLabel: string; courseIds: string[] }) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== 'ADMIN') throw new LearningPathwayError('Forbidden', 403);
  const existing = await tx.learningPathway.findUnique({ where: { id: requestId },
    include: { courses: { orderBy: { position: 'asc' } } } });
  if (existing && (!existing.sealedAt || existing.createdById !== actorId ||
      existing.title !== definition.title || existing.description !== definition.description ||
      existing.badgeLabel !== definition.badgeLabel ||
      existing.courses.length !== definition.courseIds.length ||
      existing.courses.some((course, index) => course.courseId !== definition.courseIds[index]))) {
    throw new LearningPathwayError('Request ID already used for another pathway', 409);
  }
  return existing;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return reply({ error: 'Unauthorized' }, 401);
  try {
    const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
    if (actor?.role !== 'ADMIN') return reply({ error: 'Forbidden' }, 403);
    const pathways = await prisma.learningPathway.findMany({
      where: { sealedAt: { not: null } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { courses: { orderBy: { position: 'asc' } } },
    });
    const courseIds = [...new Set(pathways.flatMap(pathway => pathway.courses.map(course => course.courseId)))];
    const live = courseIds.length ? await prisma.course.findMany({ where: { id: { in: courseIds }, activePublicationId: { not: null } },
      select: { id: true } }) : [];
    const available = new Set(live.map(course => course.id));
    return reply({ pathways: pathways.map(pathway => definitionView(pathway,
      pathway.courses.some(course => !available.has(course.courseId)))) });
  } catch (error) {
    console.error('Failed to list learning pathways:', error);
    return reply({ error: 'Failed to list learning pathways' }, 500);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return reply({ error: 'Invalid request origin' }, 403);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return reply({ error: 'Unauthorized' }, 401);
  try {
    const body = await readJsonObject(request, 4096);
    const title = plainText(body.title, 3, 120);
    const description = plainText(body.description, 0, 500);
    const badgeLabel = plainText(body.badgeLabel, 3, 80);
    const courseIds = body.courseIds;
    const requestId = body.requestId;
    if (Object.keys(body).some(key => !['title', 'description', 'badgeLabel', 'courseIds', 'requestId'].includes(key)) ||
      title === null || description === null || badgeLabel === null || !Array.isArray(courseIds) ||
      typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId) ||
      courseIds.length < 2 || courseIds.length > 4 ||
      courseIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      new Set(courseIds).size !== courseIds.length) return reply({ error: 'Invalid pathway definition' }, 400);

    const definition = { title, description, badgeLabel, courseIds: courseIds as string[] };
    const result = await createD1LearningPathwayDefinition(session.user.id, requestId, definition);
    const live = await prisma.course.findMany({ where: { id: { in: result.pathway.courses.map(course => course.courseId) },
      activePublicationId: { not: null } }, select: { id: true } });
    const available = new Set(live.map(course => course.id));
    return reply({ pathway: definitionView(result.pathway,
      result.pathway.courses.some(course => !available.has(course.courseId))) }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof LearningPathwayError) return reply({ error: error.message }, error.status);
    const inputError = requestErrorResponse(error);
    if (inputError) return reply(await inputError.json(), inputError.status);
    console.error('Failed to create learning pathway:', error);
    return reply({ error: 'Failed to create learning pathway' }, 500);
  }
}
