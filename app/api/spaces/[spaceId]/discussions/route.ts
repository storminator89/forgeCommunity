export const dynamic = 'force-dynamic';

import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { getReadableSpace, readableSpaceDiscussionWhere } from '@/lib/server/space-access';
import { afterSpaceCursor, normalizeSpaceDiscussion, pageSpaceRows, readSpaceCursor, SPACE_ORDER, SPACE_PAGE_SIZE, spaceDiscussionSelect } from '@/lib/server/space-discussions';
import { parseDiscussionInput, requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validSpaceId } from '@/lib/server/space-api';

type Context = { params: Promise<{ spaceId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    const page = await spaceTransaction(async tx => {
      const access = await getReadableSpace(spaceId, userId, tx);
      if (!access) throw new SpaceApiError('Space nicht gefunden', 404);
      const cursor = readSpaceCursor(request, 'discussions', spaceId);
      const rows = await tx.spaceDiscussion.findMany({
        where: { AND: [readableSpaceDiscussionWhere(access), afterSpaceCursor(cursor)] },
        select: spaceDiscussionSelect, orderBy: SPACE_ORDER, take: SPACE_PAGE_SIZE + 1,
      });
      const result = pageSpaceRows(rows, 'discussions', spaceId);
      return { items: result.items.map(normalizeSpaceDiscussion), nextCursor: result.nextCursor };
    });
    return NextResponse.json(page, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Diskussionen konnten nicht geladen werden');
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    const input = parseDiscussionInput(await readJsonObject(request, 20 * 1024));
    const key = { spaceId_authorId_requestId: { spaceId, authorId: userId, requestId: input.requestId } };
    const existingResult = async (tx: Prisma.TransactionClient) => {
      const access = await getReadableSpace(spaceId, userId, tx);
      if (!access || !access.canWrite) throw new SpaceApiError('Space nicht gefunden', 404);
      const existing = await tx.spaceDiscussion.findUnique({ where: key,
        select: { ...spaceDiscussionSelect, payloadDigest: true } });
      if (!existing) return null;
      if (existing.payloadDigest !== input.payloadDigest) throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
      if (existing.hiddenAt && !access.canManage) throw new SpaceApiError('Diskussion nicht gefunden', 404);
      return { item: normalizeSpaceDiscussion(existing), created: false };
    };
    let result: Awaited<ReturnType<typeof existingResult>>;
    try {
      result = await spaceTransaction(async tx => {
        const previous = await existingResult(tx);
        if (previous) return previous;
        const created = await tx.spaceDiscussion.create({ data: { spaceId, authorId: userId, ...input },
          select: spaceDiscussionSelect });
        return { item: normalizeSpaceDiscussion(created), created: true };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      result = await spaceTransaction(existingResult);
      if (!result) throw error;
    }
    if (!result) throw new Error('Missing discussion result');
    return NextResponse.json(result.item, { status: result.created ? 201 : 200, headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Diskussion konnte nicht erstellt werden');
  }
}
