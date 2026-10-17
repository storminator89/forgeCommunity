export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse } from '@/lib/server/space-api';
import { listSpaceMissionOverview } from '@/lib/server/space-mission-overview';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    return NextResponse.json(await listSpaceMissionOverview(userId, request), { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Missionen konnten nicht geladen werden');
  }
}
