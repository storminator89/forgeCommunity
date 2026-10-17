export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { missionId } from '@/lib/server/space-missions';
import { parseMissionBookmark, setMissionBookmark } from '@/lib/server/space-mission-bookmarks';

type Context = { params: Promise<{ spaceId: string; missionId: string }> };

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const input = parseMissionBookmark(await readJsonObject(request, 1024));
    return NextResponse.json(await setMissionBookmark(validSpaceId(path.spaceId), missionId(path.missionId), userId, input), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Merker konnte nicht geändert werden'); }
}
