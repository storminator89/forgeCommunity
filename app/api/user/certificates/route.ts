import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "@/lib/sites-auth/server";
import { authOptions } from '@/lib/auth';

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

    // Prisma's distinct keeps the first row for each course after ordering.
    // Sort newest-first before deduplication so that row is the latest issue,
    // regardless of the course ID or database provider.
    const certificates = await prisma.certificate.findMany({
      where: { userId: user.id },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
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

    // Make the response contract explicit even if a provider changes the order
    // in which Prisma returns distinct rows with the same issuedAt.
    certificates.sort((a, b) =>
      b.issuedAt.getTime() - a.issuedAt.getTime() ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );

    return NextResponse.json(certificates);
  } catch (error) {
    console.error('Error fetching certificates:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
