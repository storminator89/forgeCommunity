export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { d1SpaceReply } from '@/lib/server/d1-space-discussion-reads';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, validDiscussionId, validReplyId, validSpaceId } from '@/lib/server/space-api';

export async function GET(_request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; discussionId: string; replyId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId, replyId: rawReplyId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const replyId = validReplyId(rawReplyId);
    const item = await d1SpaceReply(userId, spaceId, discussionId, replyId);
    return NextResponse.json(item, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Antwort konnte nicht geladen werden');
  }
}
