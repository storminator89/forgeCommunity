import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/options";
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { hasCurrentAdminReadAccess } from '@/lib/server/read-access';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const h5pContents = await prisma.$transaction(async tx => {
      const isAdmin = await hasCurrentAdminReadAccess(tx, session.user);
      return tx.h5PContent.findMany({
        where: isAdmin ? undefined : { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, contentType: true, createdAt: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json(h5pContents.map(content => ({ ...content, embedUrl: `/h5p/embed/${content.id}` })), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to fetch H5P contents:', error);
    return NextResponse.json({ error: 'Failed to fetch H5P contents' }, { status: 500 });
  }
}
