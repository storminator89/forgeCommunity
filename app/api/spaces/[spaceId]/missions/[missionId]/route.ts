export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { closeMission, missionBody, missionId, readMission } from '@/lib/server/space-missions';

type Context = { params: Promise<{ spaceId: string; missionId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const path = await params;
    return NextResponse.json(await readMission(validSpaceId(path.spaceId), missionId(path.missionId), userId), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Mission konnte nicht geladen werden'); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const body = missionBody(await readJsonObject(request, 1024), ['closed']);
    if (body.closed !== true) throw new SpaceApiError('Mission kann nur geschlossen werden', 400);
    return NextResponse.json(await closeMission(validSpaceId(path.spaceId), missionId(path.missionId), userId), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Mission konnte nicht geschlossen werden'); }
}
