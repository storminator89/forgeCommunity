import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const h5pContents = await prisma.h5PContent.findMany({
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        title: true,
        contentType: true,
        createdAt: true,
      }
    });

    return NextResponse.json(h5pContents);
  } catch (error) {
    console.error('Failed to fetch H5P contents:', error);
    return NextResponse.json({ error: 'Failed to fetch H5P contents' }, { status: 500 });
  }
}
