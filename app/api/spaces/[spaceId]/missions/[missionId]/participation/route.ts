import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { missionId, parseMissionEpoch, setMissionParticipation } from '@/lib/server/space-missions';

type Context = { params: Promise<{ spaceId: string; missionId: string }> };

async function setParticipation(request: NextRequest, { params }: Context, join: boolean) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const epoch = parseMissionEpoch(await readJsonObject(request, 1024), join);
    return NextResponse.json(await setMissionParticipation(validSpaceId(path.spaceId), missionId(path.missionId), userId, epoch, join), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Teilnahme konnte nicht geändert werden'); }
}

export async function POST(request: NextRequest, context: Context) { return setParticipation(request, context, true); }
export async function DELETE(request: NextRequest, context: Context) { return setParticipation(request, context, false); }
