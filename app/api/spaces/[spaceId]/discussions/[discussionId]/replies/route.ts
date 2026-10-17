export const dynamic = 'force-dynamic';

import { Prisma } from '@/generated/prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject } from '@/lib/server/api-input';
import { getReadableSpace, readableSpaceDiscussionWhere, readableSpaceReplyWhere } from '@/lib/server/space-access';
import { afterSpaceCursor, normalizeSpaceReply, pageSpaceRows, readSpaceCursor, SPACE_ORDER, SPACE_PAGE_SIZE, spaceReplySelect } from '@/lib/server/space-discussions';
import { parseReplyInput, requiredUserId, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validDiscussionId, validSpaceId } from '@/lib/server/space-api';

type Context = { params: Promise<{ spaceId: string; discussionId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const page = await spaceTransaction(async tx => {
      const access = await getReadableSpace(spaceId, userId, tx);
      if (!access) throw new SpaceApiError('Diskussion nicht gefunden', 404);
      const parent = await tx.spaceDiscussion.findFirst({ where: { id: discussionId,
        ...readableSpaceDiscussionWhere(access) }, select: { id: true } });
      if (!parent) throw new SpaceApiError('Diskussion nicht gefunden', 404);
      const cursor = readSpaceCursor(request, 'replies', spaceId, discussionId);
      const rows = await tx.spaceReply.findMany({
        where: { AND: [readableSpaceReplyWhere(access, discussionId), afterSpaceCursor(cursor)] },
        select: spaceReplySelect, orderBy: SPACE_ORDER, take: SPACE_PAGE_SIZE + 1,
      });
      const result = pageSpaceRows(rows, 'replies', spaceId, discussionId);
      return { items: result.items.map(normalizeSpaceReply), nextCursor: result.nextCursor };
    });
    return NextResponse.json(page, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Antworten konnten nicht geladen werden');
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await getServerSession(authOptions);
    const userId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawSpaceId, discussionId: rawDiscussionId } = await params;
    const spaceId = validSpaceId(rawSpaceId);
    const discussionId = validDiscussionId(rawDiscussionId);
    const input = parseReplyInput(await readJsonObject(request, 20 * 1024));
    const key = { discussionId_authorId_requestId: { discussionId, authorId: userId, requestId: input.requestId } };
    const existingResult = async (tx: Prisma.TransactionClient) => {
      const access = await getReadableSpace(spaceId, userId, tx);
      if (!access || !access.canWrite) throw new SpaceApiError('Diskussion nicht gefunden', 404);
      const parent = await tx.spaceDiscussion.findFirst({ where: { id: discussionId, spaceId, hiddenAt: null }, select: { id: true } });
      if (!parent) throw new SpaceApiError('Diskussion nicht gefunden', 404);
      const existing = await tx.spaceReply.findUnique({ where: key,
        select: { ...spaceReplySelect, payloadDigest: true } });
      if (!existing) return null;
      if (existing.payloadDigest !== input.payloadDigest) throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
      if (existing.hiddenAt && !access.canManage) throw new SpaceApiError('Antwort nicht gefunden', 404);
      return { item: normalizeSpaceReply(existing), created: false };
    };
    let result: Awaited<ReturnType<typeof existingResult>>;
    try {
      result = await spaceTransaction(async tx => {
        const previous = await existingResult(tx);
        if (previous) return previous;
        const created = await tx.spaceReply.create({ data: { discussionId, authorId: userId, ...input },
          select: spaceReplySelect });
        return { item: normalizeSpaceReply(created), created: true };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      result = await spaceTransaction(existingResult);
      if (!result) throw error;
    }
    if (!result) throw new Error('Missing reply result');
    return NextResponse.json(result.item, { status: result.created ? 201 : 200, headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Antwort konnte nicht erstellt werden');
  }
}
