import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { Prisma } from '@/generated/prisma/client';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { setD1LearningPathwayParticipation } from '@/lib/server/d1-learning-pathway-participation';
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
    const { pathway, created } = await setD1LearningPathwayParticipation(pathwayId, session.user.id, join);
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
