import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { getReadableSpace } from '@/lib/server/space-access';
import { removeD1PrivateSpaceMember } from '@/lib/server/d1-space-private-members';
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
    await removeD1PrivateSpaceMember(actorId, spaceId, userId);
    return NextResponse.json({ spaceId, userId, removed: true }, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Mitglied konnte nicht entfernt werden');
  }
}
