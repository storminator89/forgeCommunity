export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { parsePollVote, pollId, votePoll } from '@/lib/server/space-polls';

type Context = { params: Promise<{ spaceId: string; pollId: string }> };
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const userId = requiredUserId((await getServerSession(authOptions))?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const input = parsePollVote(await readJsonObject(request, 1024));
    return NextResponse.json(await votePoll(validSpaceId(path.spaceId), pollId(path.pollId), userId, input), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Stimme konnte nicht gespeichert werden'); }
}
