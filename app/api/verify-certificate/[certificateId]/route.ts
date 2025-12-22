import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ certificateId: string }> }
) {
  const params = await props.params;
  try {
    const certificateId = params.certificateId;

    const certificate = await prisma.certificate.findUnique({
      where: { id: certificateId },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        course: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!certificate) {
      return NextResponse.json(
        { valid: false, message: 'Certificate not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      valid: true,
      certificate: {
        id: certificate.id,
        userName: certificate.userName,
        courseName: certificate.courseName,
        issuedAt: certificate.issuedAt,
      },
    });
  } catch (error) {
    console.error('Error verifying certificate:', error);
    return NextResponse.json(
      { valid: false, message: 'Error verifying certificate' },
      { status: 500 }
    );
  }
}
