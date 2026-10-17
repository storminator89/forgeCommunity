import { invitationErrorResponse } from '@/lib/server/space-mission-invitation-errors';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { requiredUserId, SPACE_NO_STORE, SpaceApiError } from '@/lib/server/space-api';
import { readInvitationPreference, setInvitationPreference, parseInvitationPreference } from '@/lib/server/space-mission-invitations';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    return NextResponse.json(await readInvitationPreference(requiredUserId(session?.user?.id)), { headers: SPACE_NO_STORE });
  } catch (error) { return invitationErrorResponse(error, 'Einladungseinstellung konnte nicht geladen werden', 'invitation-preference.read'); }
}
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    return NextResponse.json(await setInvitationPreference(userId, parseInvitationPreference(await readJsonObject(request, 1024))), { headers: SPACE_NO_STORE });
  } catch (error) { return invitationErrorResponse(error, 'Einladungseinstellung konnte nicht geändert werden', 'invitation-preference.update'); }
}
