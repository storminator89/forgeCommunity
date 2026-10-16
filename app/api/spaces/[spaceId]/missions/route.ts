export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { createMission, listMissions, parseMissionInput } from '@/lib/server/space-missions';

type Context = { params: Promise<{ spaceId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId } = await params;
    return NextResponse.json(await listMissions(validSpaceId(spaceId), userId, request), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Missionen konnten nicht geladen werden'); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId } = await params;
    const input = parseMissionInput(await readJsonObject(request, 12 * 1024));
    const result = await createMission(validSpaceId(spaceId), userId, input);
    return NextResponse.json(result.item, { status: result.created ? 201 : 200, headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Mission konnte nicht erstellt werden'); }
}
