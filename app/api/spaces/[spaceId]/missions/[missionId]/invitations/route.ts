import { invitationErrorResponse } from '@/lib/server/space-mission-invitation-errors';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { missionId } from '@/lib/server/space-missions';
import { sendMissionInvitation, parseInvitationSend } from '@/lib/server/space-mission-invitations';

type Context = { params: Promise<{ spaceId: string; missionId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const path = await params;
    const input = parseInvitationSend(await readJsonObject(request, 2048));
    return NextResponse.json(await sendMissionInvitation(validSpaceId(path.spaceId), missionId(path.missionId), userId, input), { headers: SPACE_NO_STORE });
  } catch (error) { return invitationErrorResponse(error, 'Einladungsanfrage konnte nicht verarbeitet werden', 'invitation.send'); }
}
