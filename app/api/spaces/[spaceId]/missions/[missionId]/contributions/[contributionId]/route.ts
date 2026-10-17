import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { missionId, parseMissionEpoch, withdrawMissionContribution } from '@/lib/server/space-missions';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ spaceId: string; missionId: string; contributionId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const epoch = parseMissionEpoch(await readJsonObject(request, 1024), false);
    return NextResponse.json(await withdrawMissionContribution(validSpaceId(path.spaceId), missionId(path.missionId), missionId(path.contributionId), userId, epoch), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Missionsbeitrag konnte nicht zurückgezogen werden'); }
}
