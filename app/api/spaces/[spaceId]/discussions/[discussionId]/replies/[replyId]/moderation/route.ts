import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { getReadableSpace } from '@/lib/server/space-access';
import { moderateD1SpaceReply } from '@/lib/server/d1-space-content-moderation';
import { normalizeSpaceReply, spaceReplySelect } from '@/lib/server/space-discussions';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validDiscussionId, validReplyId, validSpaceId } from '@/lib/server/space-api';

export async function PATCH(request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; discussionId: string; replyId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId, replyId: rawReplyId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const replyId = validReplyId(rawReplyId);
    const body = await readJsonObject(request, 1024);
    if (typeof body.hidden !== 'boolean') throw new SpaceApiError('Ungültiger Moderationsstatus', 400);
    const item = await moderateD1SpaceReply(spaceId, discussionId, replyId, actorId, body.hidden);
    return NextResponse.json(item, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Moderation konnte nicht gespeichert werden');
  }
}
