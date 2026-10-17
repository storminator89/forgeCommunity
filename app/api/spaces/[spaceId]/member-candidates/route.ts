export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { getReadableSpace } from '@/lib/server/space-access';
import { requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validSpaceId } from '@/lib/server/space-api';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = requiredUserId(session?.user?.id);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    const rawQuery = new URL(request.url).searchParams.get('q') ?? '';
    if (rawQuery.length > 200) throw new SpaceApiError('Ungültige Suche', 400);
    const q = sanitizeTextServer(rawQuery);
    if (q.length > 80) throw new SpaceApiError('Ungültige Suche', 400);
    const items = await spaceTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new SpaceApiError('Nicht autorisiert', 403);
      const access = await getReadableSpace(spaceId, actorId, tx);
      if (!access || access.space.visibility !== 'PRIVATE') throw new SpaceApiError('Space nicht gefunden', 404);
      if (q.length < 2) return [];
      return tx.user.findMany({
        where: { OR: [{ id: { contains: q } }, { name: { contains: q } }],
          spaceMemberships: { none: { spaceId } } },
        select: { id: true, name: true, image: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 20,
      });
    });
    return NextResponse.json({ items }, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Mitglieder konnten nicht gesucht werden');
  }
}
