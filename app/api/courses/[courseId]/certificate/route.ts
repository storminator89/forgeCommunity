import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { certificatePdfResponse } from '@/lib/server/certificate-pdf';
import { issueD1CourseCertificate } from '@/lib/server/d1-course-certificates';
import { CoursePathError } from '@/lib/server/course-path';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

    const certificate = await issueD1CourseCertificate(session.user, courseId);
    if (certificate === false) return new NextResponse('Course completion and released chapters are required for a new certificate', { status: 403 });
    if (!certificate || typeof certificate !== 'object') throw new Error('Certificate issuance failed');
    return certificatePdfResponse(certificate);
  } catch (error) {
    if (error instanceof CoursePathError) return new NextResponse(error.message,
      { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    console.error('Error generating certificate:', error);
    return new NextResponse('Error generating certificate', { status: 500 });
  }
}
