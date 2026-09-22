import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ certificateId: string }> }
) {
    const { certificateId } = await params;
    const certificate = await prisma.certificate.findUnique({
        where: { id: certificateId },
        select: { id: true },
    });

    if (!certificate) {
        return NextResponse.json({ id: certificateId, verified: false }, { status: 404 });
    }

    return NextResponse.json({ id: certificate.id, verified: true });
}
