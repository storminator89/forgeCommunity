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

    // Get all certificates for the user, grouped by courseId and taking only the latest one
    const certificates = await prisma.$queryRaw`
      SELECT DISTINCT ON (c."courseId") 
        c.id,
        c."courseId",
        c."courseName",
        c."issuedAt",
        c."userId",
        c."userName"
      FROM "Certificate" c
      WHERE c."userId" = ${user.id}
      ORDER BY c."courseId", c."issuedAt" DESC
    `;

    return NextResponse.json(certificates);
  } catch (error) {
    console.error('Error fetching certificates:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
