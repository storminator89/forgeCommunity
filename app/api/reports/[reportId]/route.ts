import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { ReportReviewError, reviewContentReport } from '@/lib/server/report-review';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (actor?.role !== 'ADMIN' && actor?.role !== 'MODERATOR') {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });

    const { reportId } = await params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(reportId)) {
      return NextResponse.json({ error: 'Meldung nicht gefunden' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const body = await readJsonObject(request, 2048);
    const { status, resolutionNote, actionTaken } = body;
    const note = typeof resolutionNote === 'string' ? sanitizeTextServer(resolutionNote) : '';
    if ((status !== 'DISMISSED' && status !== 'RESOLVED') || note.length < 5 || note.length > 500 ||
        (status === 'RESOLVED' && actionTaken !== true)) {
      return NextResponse.json({ error: 'Status und Begründung (5–500 Zeichen) sind erforderlich' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }

    // The early role check above avoids parsing unauthorized input. The helper
    // rereads permission together with the conditional decision write.
    const result = await reviewContentReport(userId, reportId, status, note);
    return NextResponse.json(result,
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ReportReviewError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    const inputError = requestErrorResponse(error);
    if (inputError) {
      inputError.headers.set('Cache-Control', 'private, no-store');
      return inputError;
    }
    console.error('Report review failed:', error);
    return NextResponse.json({ error: 'Meldung konnte nicht bearbeitet werden' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
