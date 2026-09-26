import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/options';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { certificatePdfResponse } from '@/lib/server/certificate-pdf';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

    // Serializable isolation prevents concurrent read-then-create issuances
    // without invalidating existing historical certificate IDs.
    let certificate;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        certificate = await prisma.$transaction(async (tx) => {
          const course = await tx.course.findUnique({ where: { id: courseId }, select: { title: true } });
          if (!course) return null;
          const user = await tx.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true } });
          if (!user) return null;
          const enrollment = await tx.enrollment.findUnique({
            where: { userId_courseId: { userId: session.user.id, courseId } },
            select: { completedAt: true },
          });
          if (!enrollment?.completedAt) return false;
          const existing = await tx.certificate.findFirst({
            where: { userId: session.user.id, courseId },
            orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
          });
          return existing ?? tx.certificate.create({
            data: {
              id: uuidv4(), userId: session.user.id, courseId,
              issuedAt: new Date(), courseName: course.title, userName: user.name || user.email,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if (attempt === 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    if (certificate === null) return new NextResponse('Course or user not found', { status: 404 });
    if (certificate === false) return new NextResponse('Course has not been completed', { status: 403 });
    if (!certificate || typeof certificate !== 'object') throw new Error('Certificate issuance failed');
    return certificatePdfResponse(certificate);
  } catch (error) {
    console.error('Error generating certificate:', error);
    return new NextResponse('Error generating certificate', { status: 500 });
  }
}
