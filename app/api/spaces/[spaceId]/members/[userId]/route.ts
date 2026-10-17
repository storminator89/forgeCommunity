import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { getReadableSpace } from '@/lib/server/space-access';
import { revokeSpaceMissionBookmarks } from '@/lib/server/space-mission-bookmarks';
import { invitationTransaction, revokeSpaceMissionInvitations } from '@/lib/server/space-mission-invitation-state';
import { revokeSpaceMissionParticipation } from '@/lib/server/space-missions';
import { requiredUserId, SPACE_ID_RE, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';

export async function DELETE(request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; userId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawId, userId } = await params;
    const spaceId = validSpaceId(rawId);
    if (!SPACE_ID_RE.test(userId)) throw new SpaceApiError('Mitglied nicht gefunden', 404);
    await invitationTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new SpaceApiError('Nicht autorisiert', 403);
      const access = await getReadableSpace(spaceId, actorId, tx);
      if (!access || access.space.visibility !== 'PRIVATE') throw new SpaceApiError('Space nicht gefunden', 404);
      await revokeSpaceMissionInvitations(spaceId, userId, tx);
      await revokeSpaceMissionBookmarks(spaceId, userId, tx);
      await revokeSpaceMissionParticipation(spaceId, userId, tx);
      await tx.spaceMember.deleteMany({ where: { spaceId, userId } });
    });
    return NextResponse.json({ spaceId, userId, removed: true }, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Mitglied konnte nicht entfernt werden');
  }
}
