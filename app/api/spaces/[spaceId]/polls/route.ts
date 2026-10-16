export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { createPoll, listPolls, parsePollInput } from '@/lib/server/space-polls';

type Context = { params: Promise<{ spaceId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const userId = requiredUserId((await getServerSession(authOptions))?.user?.id);
    const { spaceId } = await params;
    return NextResponse.json(await listPolls(validSpaceId(spaceId), userId, request), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Umfragen konnten nicht geladen werden'); }
}
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const userId = requiredUserId((await getServerSession(authOptions))?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId } = await params;
    const input = parsePollInput(await readJsonObject(request, 6 * 1024));
    const result = await createPoll(validSpaceId(spaceId), userId, input);
    return NextResponse.json(result.item, { status: result.created ? 201 : 200, headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Umfrage konnte nicht erstellt werden'); }
}
