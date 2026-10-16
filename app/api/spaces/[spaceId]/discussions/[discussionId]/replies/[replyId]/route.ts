export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getReadableSpace, readableSpaceReplyWhere } from '@/lib/server/space-access';
import { normalizeSpaceReply, spaceReplySelect } from '@/lib/server/space-discussions';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validDiscussionId, validReplyId, validSpaceId } from '@/lib/server/space-api';

export async function GET(_request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; discussionId: string; replyId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId, replyId: rawReplyId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const replyId = validReplyId(rawReplyId);
    const item = await spaceTransaction(async tx => {
      const access = await getReadableSpace(spaceId, userId, tx);
      if (!access) throw new SpaceApiError('Antwort nicht gefunden', 404);
      const row = await tx.spaceReply.findFirst({ where: { id: replyId,
        ...readableSpaceReplyWhere(access, discussionId) }, select: spaceReplySelect });
      if (!row) throw new SpaceApiError('Antwort nicht gefunden', 404);
      return normalizeSpaceReply(row);
    });
    return NextResponse.json(item, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Antwort konnte nicht geladen werden');
  }
}
