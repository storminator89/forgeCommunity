import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { certificatePdfResponse } from '@/lib/server/certificate-pdf';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });
    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId, userId: session.user.id },
    });
    if (!certificate) return new NextResponse('Certificate not found', { status: 404 });
    return certificatePdfResponse(certificate);
  } catch (error) {
    console.error('Error generating certificate:', error);
    return new NextResponse('Error generating certificate', { status: 500 });
  }
}
