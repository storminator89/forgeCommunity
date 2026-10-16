export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getReadableSpace } from '@/lib/server/space-access';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validSpaceId } from '@/lib/server/space-api';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    const space = await spaceTransaction(async tx => (await getReadableSpace(spaceId, userId, tx))?.space ?? null);
    if (!space) throw new SpaceApiError('Space nicht gefunden', 404);
    return NextResponse.json(space, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Space konnte nicht geladen werden');
  }
}
