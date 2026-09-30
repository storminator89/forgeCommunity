import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/options';
import { certificatePdfResponse } from '@/lib/server/certificate-pdf';
import { courseTransaction, ensureCourseCertificate } from '@/lib/server/course-lifecycle';

export async function POST(
  _request: NextRequest,
  props: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });
    const certificate = await courseTransaction(async (tx) => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { title: true } });
      if (!course) return null;
      const user = await tx.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true } });
      if (!user) return null;
      const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: session.user.id, courseId } } });
      if (!enrollment?.completedAt) return false;
      return ensureCourseCertificate(tx, { ...enrollment, userId: session.user.id, courseId }, {
        courseName: course.title, userName: user.name || user.email,
      });
    });
    if (certificate === null) return new NextResponse('Course or user not found', { status: 404 });
    if (certificate === false) return new NextResponse('Course has not been completed', { status: 403 });
    return certificatePdfResponse(certificate);
  } catch (error) {
    console.error('Error generating certificate:', error);
    return new NextResponse('Error generating certificate', { status: 500 });
  }
}
