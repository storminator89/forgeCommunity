export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { d1SpaceReplies } from '@/lib/server/d1-space-discussion-reads';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { createD1SpaceReply } from '@/lib/server/d1-space-content-writes';
import { readSpaceCursor } from '@/lib/server/space-discussions';
import { parseReplyInput, requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validDiscussionId, validSpaceId } from '@/lib/server/space-api';

type Context = { params: Promise<{ spaceId: string; discussionId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    let cursor: ReturnType<typeof readSpaceCursor> = null;
    let cursorError: unknown;
    try { cursor = readSpaceCursor(request, 'replies', spaceId, discussionId); } catch (error) { cursorError = error; }
    const page = await d1SpaceReplies(userId, spaceId, discussionId, cursor, cursorError === undefined);
    if (cursorError !== undefined) throw cursorError;
    return NextResponse.json(page, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Antworten konnten nicht geladen werden');
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const input = parseReplyInput(await readJsonObject(request, 20 * 1024));
    const result = await createD1SpaceReply(userId, spaceId, discussionId, input);
    return NextResponse.json(result.item, { status: result.created ? 201 : 200, headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Antwort konnte nicht erstellt werden');
  }
}
