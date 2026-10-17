export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { d1SpaceMemberCandidates } from '@/lib/server/d1-space-reads';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = requiredUserId(session?.user?.id);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    const rawQuery = new URL(request.url).searchParams.get('q') ?? '';
    if (rawQuery.length > 200) throw new SpaceApiError('Ungültige Suche', 400);
    const q = sanitizeTextServer(rawQuery);
    if (q.length > 80) throw new SpaceApiError('Ungültige Suche', 400);
    const items = await d1SpaceMemberCandidates(actorId, spaceId, q);
    return NextResponse.json({ items }, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Mitglieder konnten nicht gesucht werden');
  }
}
