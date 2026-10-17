export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { getReadableSpace } from '@/lib/server/space-access';
import { d1SpaceDirectory } from '@/lib/server/d1-space-reads';
import { parseSpaceInput, readSpaceDirectoryCursor, requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError } from '@/lib/server/space-api';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const cursor = readSpaceDirectoryCursor(request);
    const page = await d1SpaceDirectory(userId, cursor);
    return NextResponse.json(page, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Spaces konnten nicht geladen werden');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const input = parseSpaceInput(await readJsonObject(request, 4096));
    const space = await spaceTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new SpaceApiError('Nicht autorisiert', 403);
      const created = await tx.space.create({ data: { ...input, members: { create: { userId } } }, select: { id: true } });
      const access = await getReadableSpace(created.id, userId, tx);
      if (!access) throw new Error('Created Space was not readable');
      return access.space;
    });
    return NextResponse.json(space, { status: 201, headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Space konnte nicht erstellt werden');
  }
}
