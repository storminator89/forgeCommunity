import { NextRequest, NextResponse } from 'next/server';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ certificateId: string }> }
) {
    const { certificateId } = await params;
    return NextResponse.json({ id: certificateId, verified: true });
}
