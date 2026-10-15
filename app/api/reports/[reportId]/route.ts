import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (actor?.role !== 'ADMIN' && actor?.role !== 'MODERATOR') {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403 });
    }
    if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle' }, { status: 403 });

    const { reportId } = await params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(reportId)) {
      return NextResponse.json({ error: 'Meldung nicht gefunden' }, { status: 404 });
    }
    const body = await readJsonObject(request, 2048);
    const { status, resolutionNote, actionTaken } = body;
    const note = typeof resolutionNote === 'string' ? sanitizeTextServer(resolutionNote) : '';
    if ((status !== 'DISMISSED' && status !== 'RESOLVED') || note.length < 5 || note.length > 500 ||
        (status === 'RESOLVED' && actionTaken !== true)) {
      return NextResponse.json({ error: 'Status und Begründung (5–500 Zeichen) sind erforderlich' }, { status: 400 });
    }

    // Conditional update makes a review one-way and preserves the first
    // moderator's identity, decision, and timestamp on repeated requests.
    const reviewedAt = new Date();
    const updated = await prisma.contentReport.updateMany({
      where: { id: reportId, status: 'OPEN' },
      data: { status, resolutionNote: note, reviewedAt, reviewedById: userId },
    });
    if (updated.count === 0) {
      const existing = await prisma.contentReport.findUnique({ where: { id: reportId }, select: { id: true } });
      return NextResponse.json(
        { error: existing ? 'Meldung wurde bereits bearbeitet' : 'Meldung nicht gefunden' },
        { status: existing ? 409 : 404 },
      );
    }
    return NextResponse.json({ id: reportId, status, reviewedAt, reviewedById: userId },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Report review failed:', error);
    return NextResponse.json({ error: 'Meldung konnte nicht bearbeitet werden' }, { status: 500 });
  }
}
