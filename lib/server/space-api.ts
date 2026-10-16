import 'server-only';

import { Prisma, SpaceVisibility } from '@prisma/client';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { InvalidPaginationError, requestErrorResponse } from '@/lib/server/api-input';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { InvalidSpaceCursorError } from '@/lib/server/space-discussions';

export const SPACE_NO_STORE = { 'Cache-Control': 'private, no-store' };
export const SPACE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
export const SPACE_REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const SPACE_DIRECTORY_PAGE_SIZE = 30;

type SpaceDirectoryCursor = { createdAt: Date; id: string };

export function readSpaceDirectoryCursor(request: Request): SpaceDirectoryCursor | null {
  const raw = new URL(request.url).searchParams.get('cursor');
  if (raw === null) return null;
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new InvalidPaginationError();
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error('Noncanonical cursor');
    const value = JSON.parse(bytes.toString('utf8'));
    if (value?.v !== 1 || value?.kind !== 'spaces' || typeof value.id !== 'string' ||
        !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string') throw new Error('Invalid cursor');
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error('Invalid date');
    return { createdAt, id: value.id };
  } catch {
    throw new InvalidPaginationError();
  }
}

export function afterSpaceDirectoryCursor(cursor: SpaceDirectoryCursor | null) {
  return cursor ? { OR: [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ] } : {};
}

export function pageSpaceDirectory<T extends SpaceDirectoryCursor>(rows: T[]) {
  const items = rows.slice(0, SPACE_DIRECTORY_PAGE_SIZE);
  return { items, nextCursor: rows.length > SPACE_DIRECTORY_PAGE_SIZE
    ? Buffer.from(JSON.stringify({ v: 1, kind: 'spaces', createdAt: items[items.length - 1].createdAt.toISOString(), id: items[items.length - 1].id })).toString('base64url')
    : null };
}

export class SpaceApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function spaceErrorResponse(error: unknown, fallback: string) {
  if (error instanceof SpaceApiError) return NextResponse.json({ error: error.message }, { status: error.status, headers: SPACE_NO_STORE });
  const input = requestErrorResponse(error);
  if (input) {
    input.headers.set('Cache-Control', SPACE_NO_STORE['Cache-Control']);
    return input;
  }
  if (error instanceof InvalidSpaceCursorError) {
    return NextResponse.json({ error: 'Ungültiger Cursor' }, { status: 400, headers: SPACE_NO_STORE });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500, headers: SPACE_NO_STORE });
}

export function validSpaceId(id: string) {
  if (!SPACE_ID_RE.test(id)) throw new SpaceApiError('Space nicht gefunden', 404);
  return id;
}

export function validDiscussionId(id: string) {
  if (!SPACE_ID_RE.test(id)) throw new SpaceApiError('Diskussion nicht gefunden', 404);
  return id;
}

export function validReplyId(id: string) {
  if (!SPACE_ID_RE.test(id)) throw new SpaceApiError('Antwort nicht gefunden', 404);
  return id;
}

export function requiredUserId(userId: string | null | undefined): string {
  if (!userId) throw new SpaceApiError('Nicht authentifiziert', 401);
  return userId;
}

export function parseSpaceInput(body: Record<string, unknown>) {
  if (typeof body.name !== 'string' || typeof body.description !== 'string' ||
      (body.visibility !== 'PUBLIC' && body.visibility !== 'PRIVATE')) {
    throw new SpaceApiError('Name, Beschreibung und Sichtbarkeit sind erforderlich', 400);
  }
  const name = sanitizeTextServer(body.name);
  const description = sanitizeTextServer(body.description);
  if (name.length < 3 || name.length > 80 || description.length < 1 || description.length > 500 ||
      body.name.length > 400 || body.description.length > 2000) {
    throw new SpaceApiError('Name oder Beschreibung ist ungültig', 400);
  }
  return { name, description, visibility: body.visibility as SpaceVisibility };
}

export function parseDiscussionInput(body: Record<string, unknown>) {
  if (typeof body.title !== 'string' || typeof body.content !== 'string' ||
      body.title.length > 600 || body.content.length > 16000) {
    throw new SpaceApiError('Titel und Inhalt sind erforderlich', 400);
  }
  const title = sanitizeTextServer(body.title);
  const content = sanitizeTextServer(body.content);
  if (title.length < 5 || title.length > 140 || content.length < 10 || content.length > 4000) {
    throw new SpaceApiError('Titel oder Inhalt ist ungültig', 400);
  }
  const requestId = parseSpaceRequestId(body.requestId);
  const payloadDigest = createHash('sha256').update(JSON.stringify({ title, content })).digest('hex');
  return { title, content, requestId, payloadDigest };
}

export function parseReplyInput(body: Record<string, unknown>) {
  if (typeof body.content !== 'string' || body.content.length > 16000) {
    throw new SpaceApiError('Inhalt ist erforderlich', 400);
  }
  const content = sanitizeTextServer(body.content);
  if (content.length < 2 || content.length > 4000) {
    throw new SpaceApiError('Inhalt ist ungültig', 400);
  }
  const requestId = parseSpaceRequestId(body.requestId);
  const payloadDigest = createHash('sha256').update(JSON.stringify({ content })).digest('hex');
  return { content, requestId, payloadDigest };
}

export function parseSpaceRequestId(value: unknown) {
  if (typeof value !== 'string' || !SPACE_REQUEST_ID_RE.test(value)) {
    throw new SpaceApiError('Ungültige Anfrage-ID', 400);
  }
  return value;
}

/** Re-evaluate role and membership within each retry's serializable snapshot. */
export async function spaceTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      if (attempt === 3) throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
    }
  }
  throw new SpaceApiError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
