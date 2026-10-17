export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { createD1SpaceDiscussion } from '@/lib/server/d1-space-content-writes';
import { d1SpaceDiscussions } from '@/lib/server/d1-space-reads';
import { readSpaceCursor } from '@/lib/server/space-discussions';
import { parseDiscussionInput, requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';

type Context = { params: Promise<{ spaceId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    let cursor: ReturnType<typeof readSpaceCursor> = null;
    let cursorError: unknown;
    try { cursor = readSpaceCursor(request, 'discussions', spaceId); } catch (error) { cursorError = error; }
    const page = await d1SpaceDiscussions(userId, spaceId, cursor, cursorError === undefined);
    if (cursorError !== undefined) throw cursorError;
    return NextResponse.json(page, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Diskussionen konnten nicht geladen werden');
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    const input = parseDiscussionInput(await readJsonObject(request, 20 * 1024));
    const result = await createD1SpaceDiscussion(userId, spaceId, input);
    return NextResponse.json(result.item, { status: result.created ? 201 : 200, headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Diskussion konnte nicht erstellt werden');
  }
}
