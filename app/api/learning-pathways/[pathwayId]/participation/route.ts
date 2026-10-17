import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { Prisma } from '@/generated/prisma/client';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { LearningPathwayConflictError, LearningPathwayError, lockPathwayCourses, privatePathwayViews, reconcileUserPathways } from '@/lib/server/learning-pathways';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
type Context = { params: Promise<{ pathwayId: string }> };

async function pathwayTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
      if (code !== 'P2034' && code !== 'P2002' && !(error instanceof LearningPathwayConflictError)) throw error;
      if (attempt === 3) throw new LearningPathwayConflictError();
    }
  }
  throw new LearningPathwayConflictError();
}

async function changeParticipation(request: Request, pathwayId: string, join: boolean) {
  if (!isSameOriginRequest(request)) return reply({ error: 'Invalid request origin' }, 403);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return reply({ error: 'Unauthorized' }, 401);
  try {
    const { pathway, created } = await pathwayTransaction(async tx => {
      const userId = session.user.id;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isTestAccount: true } });
      if (user?.role !== 'USER' || user.isTestAccount) throw new LearningPathwayError('Forbidden', 403);
      const definition = await tx.learningPathway.findUnique({ where: { id: pathwayId },
        select: { sealedAt: true, courses: { select: { courseId: true } } } });
      if (!definition?.sealedAt) throw new LearningPathwayError('Pathway not found', 404);
      const key = { userId, pathwayId };
      const existing = await tx.learningPathwayParticipation.findUnique({ where: { userId_pathwayId: key } });
      if (join && (!existing || existing.optedOutAt)) {
        const courseIds = definition.courses.map(course => course.courseId);
        await lockPathwayCourses(tx, courseIds);
        const count = await tx.course.count({ where: { id: { in: courseIds }, activePublicationId: { not: null } } });
        if (count !== courseIds.length) throw new LearningPathwayError('Pathway is no longer available', 409);
      }
      if (join) {
        if (!existing) {
          try {
            await tx.learningPathwayParticipation.create({ data: key });
          } catch (error) {
            // SQLite's anti-REPLACE trigger can report a concurrent duplicate
            // as a check failure instead of the usual unique-key error.
            const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
            if (code === 'P2002' || code === 'P2004') throw new LearningPathwayConflictError();
            throw error;
          }
        }
        else if (existing.optedOutAt) {
          const changed = await tx.learningPathwayParticipation.updateMany({
            where: { ...key, optedOutAt: existing.optedOutAt, stateVersion: existing.stateVersion },
            data: { optedOutAt: null, joinedAt: new Date() },
          });
          if (changed.count !== 1) throw new LearningPathwayConflictError();
        }
      } else if (existing && !existing.optedOutAt) {
        const changed = await tx.learningPathwayParticipation.updateMany({
          where: { ...key, optedOutAt: null, stateVersion: existing.stateVersion },
          data: { optedOutAt: new Date(),
            ...(existing.badgeActive ? { badgeActive: false, stateVersion: { increment: 1 } } : {}),
          },
        });
        if (changed.count !== 1) throw new LearningPathwayConflictError();
        if (existing.badgeActive) await tx.learningPathwayChange.create({ data: {
          userId, pathwayId, version: existing.stateVersion + 1, type: 'REVOKED', reason: 'OPTED_OUT',
        } });
      }
      await reconcileUserPathways(tx, userId);
      const views = await privatePathwayViews(tx, userId, pathwayId);
      if (!views[0]) throw new LearningPathwayError('Pathway not found', 404);
      return { pathway: views[0], created: join && !existing };
    });
    return reply({ pathway }, created ? 201 : 200);
  } catch (error) {
    if (error instanceof LearningPathwayError) return reply({ error: error.message }, error.status);
    console.error('Failed to change learning pathway participation:', error);
    return reply({ error: 'Failed to change learning pathway participation' }, 500);
  }
}

export async function POST(request: Request, { params }: Context) {
  return changeParticipation(request, (await params).pathwayId, true);
}

export async function DELETE(request: Request, { params }: Context) {
  return changeParticipation(request, (await params).pathwayId, false);
}
