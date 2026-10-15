import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { privatePathwayViews } from '@/lib/server/learning-pathways';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return reply({ error: 'Unauthorized' }, 401);
  try {
    const pathways = await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: session.user.id }, select: { role: true, isTestAccount: true } });
      if (user?.role !== 'USER' || user.isTestAccount) return null;
      return privatePathwayViews(tx, session.user.id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!pathways) return reply({ error: 'Forbidden' }, 403);
    return reply({ pathways });
  } catch (error) {
    console.error('Failed to read private learning pathways:', error);
    return reply({ error: 'Failed to read learning pathways' }, 500);
  }
}
