import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { InvalidPaginationError, readJsonObject } from '@/lib/server/api-input';
import { getReadableSpace } from '@/lib/server/space-access';
import { d1SpaceMembers } from '@/lib/server/d1-space-reads';
import { requiredUserId, SPACE_ID_RE, SPACE_NO_STORE, spaceErrorResponse, spaceTransaction, SpaceApiError, validSpaceId } from '@/lib/server/space-api';

function readMemberCursor(request: Request, spaceId: string) {
  const raw = new URL(request.url).searchParams.get('cursor');
  if (raw === null) return null;
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new InvalidPaginationError();
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error('Noncanonical cursor');
    const value = JSON.parse(bytes.toString('utf8'));
    if (value?.v !== 1 || value?.kind !== 'space-members' || value?.spaceId !== spaceId ||
        typeof value.userId !== 'string' || !SPACE_ID_RE.test(value.userId) || typeof value.joinedAt !== 'string') {
      throw new Error('Invalid cursor');
    }
    const joinedAt = new Date(value.joinedAt);
    if (!Number.isFinite(joinedAt.getTime()) || joinedAt.toISOString() !== value.joinedAt) throw new Error('Invalid date');
    return { joinedAt, userId: value.userId };
  } catch {
    throw new InvalidPaginationError();
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = requiredUserId(session?.user?.id);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    let cursor: ReturnType<typeof readMemberCursor> = null;
    let cursorError: unknown;
    try { cursor = readMemberCursor(request, spaceId); } catch (error) { cursorError = error; }
    const result = await d1SpaceMembers(actorId, spaceId, cursor, cursorError === undefined);
    if (cursorError !== undefined) throw cursorError;
    return NextResponse.json(result, { headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Mitglieder konnten nicht geladen werden');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const actorId = requiredUserId(session?.user?.id);
    if (!isSameOriginRequest(request)) throw new SpaceApiError('Ungültige Anfragequelle', 403);
    const { spaceId: rawId } = await params;
    const spaceId = validSpaceId(rawId);
    const body = await readJsonObject(request, 2048);
    const userId = body.userId;
    if (typeof userId !== 'string' || !SPACE_ID_RE.test(userId)) throw new SpaceApiError('Ungültiges Mitglied', 400);
    const result = await spaceTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (actor?.role !== 'ADMIN') throw new SpaceApiError('Nicht autorisiert', 403);
      const access = await getReadableSpace(spaceId, actorId, tx);
      if (!access || access.space.visibility !== 'PRIVATE') throw new SpaceApiError('Space nicht gefunden', 404);
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!target) throw new SpaceApiError('Mitglied nicht gefunden', 404);
      const existing = await tx.spaceMember.findUnique({ where: { spaceId_userId: { spaceId, userId } }, select: { userId: true } });
      if (!existing) await tx.spaceMember.upsert({ where: { spaceId_userId: { spaceId, userId } },
        update: {}, create: { spaceId, userId } });
      return { spaceId, userId, alreadyMember: Boolean(existing) };
    });
    return NextResponse.json(result, { status: result.alreadyMember ? 200 : 201, headers: SPACE_NO_STORE });
  } catch (error) {
    return spaceErrorResponse(error, 'Mitglied konnte nicht hinzugefügt werden');
  }
}
