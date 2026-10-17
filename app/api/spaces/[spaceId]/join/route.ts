import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { setD1PublicSpaceMembership } from '@/lib/server/d1-space-base-writes';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, SpaceApiError, validSpaceId } from '@/lib/server/space-api';

type Context = { params: Promise<{ spaceId: string }> };

async function setMembership(request: NextRequest, context: Context, join: boolean) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawId } = await context.params;
    const spaceId = validSpaceId(rawId);
    const space = await setD1PublicSpaceMembership(userId, spaceId, join);
    return NextResponse.json(space, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Mitgliedschaft konnte nicht geändert werden');
  }
}

export async function POST(request: NextRequest, context: Context) {
  return setMembership(request, context, true);
}

export async function DELETE(request: NextRequest, context: Context) {
  return setMembership(request, context, false);
}
