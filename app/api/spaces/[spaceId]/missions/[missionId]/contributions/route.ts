import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { contributeToMission, missionId, parseMissionContribution } from '@/lib/server/space-missions';

export async function POST(request: NextRequest, { params }: { params: Promise<{ spaceId: string; missionId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const input = parseMissionContribution(await readJsonObject(request, 12 * 1024));
    const result = await contributeToMission(validSpaceId(path.spaceId), missionId(path.missionId), userId, input);
    return NextResponse.json(result.item, { status: result.created ? 201 : 200, headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Missionsbeitrag konnte nicht gespeichert werden'); }
}
