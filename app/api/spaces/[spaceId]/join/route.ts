import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { getReadableSpace } from '@/lib/server/space-access';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validSpaceId } from '@/lib/server/space-api';

type Context = { params: Promise<{ spaceId: string }> };

async function setMembership(request: NextRequest, context: Context, join: boolean) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawId } = await context.params;
    const spaceId = validSpaceId(rawId);
    const space = await spaceTransaction(async tx => {
      const access = await getReadableSpace(spaceId, userId, tx);
      if (!access || access.space.visibility !== 'PUBLIC') throw new SpaceApiError('Space nicht gefunden', 404);
      if (join) {
        await tx.spaceMember.upsert({ where: { spaceId_userId: { spaceId, userId } },
          update: {}, create: { spaceId, userId } });
      } else {
        await tx.spaceMember.deleteMany({ where: { spaceId, userId } });
      }
      return (await getReadableSpace(spaceId, userId, tx))?.space ?? null;
    });
    if (!space) throw new SpaceApiError('Space nicht gefunden', 404);
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
