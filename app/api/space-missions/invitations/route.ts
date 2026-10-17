import { invitationErrorResponse } from '@/lib/server/space-mission-invitation-errors';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { requiredUserId, SPACE_NO_STORE } from '@/lib/server/space-api';
import { listMissionInvitations } from '@/lib/server/space-mission-invitations';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    return NextResponse.json(await listMissionInvitations(requiredUserId(session?.user?.id), request), { headers: SPACE_NO_STORE });
  } catch (error) { return invitationErrorResponse(error, 'Einladungen konnten nicht geladen werden', 'invitations.list'); }
}
