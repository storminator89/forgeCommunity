import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/options";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return new NextResponse('User not found', { status: 404 });
    }

    // Prisma's distinct keeps the first row for each course after ordering,
    // avoiding PostgreSQL-only DISTINCT ON and preserving the latest issue.
    const certificates = await prisma.certificate.findMany({
      where: { userId: user.id },
      orderBy: [{ courseId: 'asc' }, { issuedAt: 'desc' }, { id: 'desc' }],
      distinct: ['courseId'],
      select: {
        id: true,
        courseId: true,
        courseName: true,
        issuedAt: true,
        userId: true,
        userName: true,
      },
    });

    return NextResponse.json(certificates);
  } catch (error) {
    console.error('Error fetching certificates:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
