import 'server-only';

import type { Prisma } from '@prisma/client';
import { validSpaceId } from './space-access';

export const SPACE_PAGE_SIZE = 30;
export const SPACE_ORDER = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

export class InvalidSpaceCursorError extends Error {
  readonly status = 400;
  constructor() { super('Ungültiger Seitenzeiger'); }
}

type SpaceCursorKind = 'discussions' | 'replies';
type SpaceCursor = { createdAt: Date; id: string };

function encodeSpaceCursor(row: SpaceCursor, kind: SpaceCursorKind, spaceId: string, parentId?: string): string {
  return Buffer.from(JSON.stringify({ v: 1, kind, spaceId, ...(parentId ? { parentId } : {}),
    createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}

/** A cursor is tied to one space and, for replies, one discussion. */
export function readSpaceCursor(request: Request, kind: SpaceCursorKind, spaceId: string, parentId?: string): SpaceCursor | null {
  if (!validSpaceId(spaceId) || (kind === 'replies' ? !validSpaceId(parentId) : parentId !== undefined)) {
    throw new InvalidSpaceCursorError();
  }
  const raw = new URL(request.url).searchParams.get('cursor');
  if (raw === null) return null;
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new InvalidSpaceCursorError();
  try {
    const decoded = Buffer.from(raw, 'base64url');
    if (decoded.toString('base64url') !== raw) throw new Error('Noncanonical cursor');
    const value = JSON.parse(decoded.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1 ||
        value.kind !== kind || value.spaceId !== spaceId || value.parentId !== parentId ||
        !validSpaceId(value.id) || typeof value.createdAt !== 'string') throw new Error('Wrong scope');
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error('Invalid date');
    return { createdAt, id: value.id };
  } catch {
    throw new InvalidSpaceCursorError();
  }
}

export function afterSpaceCursor(cursor: SpaceCursor | null) {
  return cursor ? { OR: [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ] } : {};
}

export function pageSpaceRows<T extends SpaceCursor>(rows: T[], kind: SpaceCursorKind, spaceId: string, parentId?: string) {
  const items = rows.slice(0, SPACE_PAGE_SIZE);
  return { items, nextCursor: rows.length > SPACE_PAGE_SIZE
    ? encodeSpaceCursor(items[items.length - 1], kind, spaceId, parentId) : null };
}

export const spaceDiscussionSelect = {
  id: true, spaceId: true, title: true, content: true, createdAt: true, updatedAt: true, hiddenAt: true,
  author: { select: { id: true, name: true, image: true } },
  _count: { select: { replies: { where: { hiddenAt: null } } } },
} satisfies Prisma.SpaceDiscussionSelect;

export const spaceReplySelect = {
  id: true, discussionId: true, content: true, createdAt: true, updatedAt: true, hiddenAt: true,
  author: { select: { id: true, name: true, image: true } },
} satisfies Prisma.SpaceReplySelect;

type DiscussionRow = Prisma.SpaceDiscussionGetPayload<{ select: typeof spaceDiscussionSelect }>;
type ReplyRow = Prisma.SpaceReplyGetPayload<{ select: typeof spaceReplySelect }>;

export interface SpaceDiscussionDto {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  hiddenAt: string | null;
  author: { id: string; name: string | null; image: string | null };
  replyCount: number;
}

export interface SpaceReplyDto {
  id: string;
  discussionId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  hiddenAt: string | null;
  author: { id: string; name: string | null; image: string | null };
}

/** Never serialize request IDs or payload digests to clients. */
export function normalizeSpaceDiscussion(row: DiscussionRow): SpaceDiscussionDto {
  return { id: row.id, spaceId: row.spaceId, title: row.title, content: row.content,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    hiddenAt: row.hiddenAt?.toISOString() ?? null,
    author: row.author, replyCount: row._count.replies };
}

export function normalizeSpaceReply(row: ReplyRow): SpaceReplyDto {
  return { id: row.id, discussionId: row.discussionId, content: row.content,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    hiddenAt: row.hiddenAt?.toISOString() ?? null,
    author: row.author };
}
