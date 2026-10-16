export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { moderatePoll, parsePollModeration, pollId, readPoll } from '@/lib/server/space-polls';

type Context = { params: Promise<{ spaceId: string; pollId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const userId = requiredUserId((await getServerSession(authOptions))?.user?.id);
    const path = await params;
    return NextResponse.json(await readPoll(validSpaceId(path.spaceId), pollId(path.pollId), userId), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Umfrage konnte nicht geladen werden'); }
}
export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const userId = requiredUserId((await getServerSession(authOptions))?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const input = parsePollModeration(await readJsonObject(request, 1024));
    return NextResponse.json(await moderatePoll(validSpaceId(path.spaceId), pollId(path.pollId), userId, input), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Umfrage konnte nicht geändert werden'); }
}
