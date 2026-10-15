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
      select: { id: true, userName: true, courseName: true, issuedAt: true },
    });

    if (!certificate) {
      return NextResponse.json(
        { valid: false, message: 'Certificate not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
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
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error verifying certificate:', error);
    return NextResponse.json(
      { valid: false, message: 'Error verifying certificate' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
