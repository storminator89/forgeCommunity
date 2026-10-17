import { invitationErrorResponse } from '@/lib/server/space-mission-invitation-errors';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requiredUserId, SPACE_NO_STORE, validSpaceId } from '@/lib/server/space-api';
import { missionId } from '@/lib/server/space-missions';
import { invitationCandidates } from '@/lib/server/space-mission-invitations';

type Context = { params: Promise<{ spaceId: string; missionId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const path = await params;
    return NextResponse.json(await invitationCandidates(validSpaceId(path.spaceId), missionId(path.missionId), userId, request), { headers: SPACE_NO_STORE });
  } catch (error) { return invitationErrorResponse(error, 'Personen konnten nicht geladen werden', 'invitation-candidates.search'); }
}
