export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { getReadableSpace, normalizeSpaceSummary, readableSpaceWhere, resolveSpaceViewer, spaceSummarySelect } from '@/lib/server/space-access';
import { afterSpaceDirectoryCursor, pageSpaceDirectory, parseSpaceInput, readSpaceDirectoryCursor, requiredUserId, SPACE_DIRECTORY_PAGE_SIZE, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError } from '@/lib/server/space-api';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const cursor = readSpaceDirectoryCursor(request);
    const page = await spaceTransaction(async tx => {
      const viewer = await resolveSpaceViewer(userId, tx);
      if (!viewer.userId) throw new SpaceApiError('Nicht authentifiziert', 401);
      const rows = await tx.space.findMany({
        where: { AND: [readableSpaceWhere(viewer), afterSpaceDirectoryCursor(cursor)] },
        select: spaceSummarySelect(viewer),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SPACE_DIRECTORY_PAGE_SIZE + 1,
      });
      const result = pageSpaceDirectory(rows);
      return { items: result.items.map(row => normalizeSpaceSummary(row, viewer)), nextCursor: result.nextCursor };
    });
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
