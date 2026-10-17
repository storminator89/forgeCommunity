export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { d1SpaceDiscussion } from '@/lib/server/d1-space-discussion-reads';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, validDiscussionId, validSpaceId } from '@/lib/server/space-api';

export async function GET(_request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; discussionId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const item = await d1SpaceDiscussion(userId, spaceId, discussionId);
    return NextResponse.json(item, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Diskussion konnte nicht geladen werden');
  }
}
