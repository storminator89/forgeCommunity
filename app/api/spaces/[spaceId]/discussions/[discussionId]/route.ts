export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { getReadableSpace, readableSpaceDiscussionWhere } from '@/lib/server/space-access';
import { normalizeSpaceDiscussion, spaceDiscussionSelect } from '@/lib/server/space-discussions';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validDiscussionId, validSpaceId } from '@/lib/server/space-api';

export async function GET(_request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; discussionId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const item = await spaceTransaction(async tx => {
      const access = await getReadableSpace(spaceId, userId, tx);
      if (!access) throw new SpaceApiError('Diskussion nicht gefunden', 404);
      const row = await tx.spaceDiscussion.findFirst({ where: { id: discussionId, ...readableSpaceDiscussionWhere(access) },
        select: spaceDiscussionSelect });
      if (!row) throw new SpaceApiError('Diskussion nicht gefunden', 404);
      return normalizeSpaceDiscussion(row);
    });
    return NextResponse.json(item, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Diskussion konnte nicht geladen werden');
  }
}
