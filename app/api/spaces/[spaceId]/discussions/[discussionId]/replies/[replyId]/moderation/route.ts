import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { getReadableSpace } from '@/lib/server/space-access';
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
    const item = await spaceTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new SpaceApiError('Nicht autorisiert', 403);
      const access = await getReadableSpace(spaceId, actorId, tx);
      if (!access) throw new SpaceApiError('Antwort nicht gefunden', 404);
      const previous = await tx.spaceReply.findFirst({ where: { id: replyId, discussionId,
        discussion: { spaceId } }, select: spaceReplySelect });
      if (!previous) throw new SpaceApiError('Antwort nicht gefunden', 404);
      const row = Boolean(previous.hiddenAt) === body.hidden ? previous
        : await tx.spaceReply.update({ where: { id: replyId },
          data: { hiddenAt: body.hidden ? new Date() : null }, select: spaceReplySelect });
      return normalizeSpaceReply(row);
    });
    return NextResponse.json(item, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Moderation konnte nicht gespeichert werden');
  }
}
