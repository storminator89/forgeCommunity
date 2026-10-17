export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, validSpaceId } from '@/lib/server/space-api';
import { listMissionModeration, missionId } from '@/lib/server/space-missions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string; missionId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const path = await params;
    return NextResponse.json(await listMissionModeration(validSpaceId(path.spaceId), missionId(path.missionId), userId, request), { headers: SPACE_NO_STORE });
  } catch (error) { return spaceErrorResponse(error, 'Missionsmoderation konnte nicht geladen werden'); }
}
