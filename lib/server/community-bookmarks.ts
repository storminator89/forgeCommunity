import 'server-only';

import { Prisma } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import prisma from '@/lib/prisma';
import { COMMUNITY_BOOKMARK_BATCH_LIMIT, communityBookmarkKey } from '@/lib/community-bookmarks';
import type { CommunityBookmarkTarget, CommunityBookmarkInput, CommunityBookmarkFilter, OwnCommunityBookmark, CommunityBookmarkPage } from '@/lib/community-bookmarks';
import { encodeBookmarkCursor, readBookmarkCursor } from './community-bookmark-cursor';

export const COMMUNITY_BOOKMARK_PAGE_SIZE = 30;
export const COMMUNITY_BOOKMARK_MAX_REVISION = 2147483647;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class CommunityBookmarkError extends Error {
  constructor(message: string, readonly status: number, readonly state?: OwnCommunityBookmark) { super(message); }
}
const unavailable = () => new CommunityBookmarkError('Inhalt nicht verfügbar', 404);
const conflict = (state?: OwnCommunityBookmark) => new CommunityBookmarkError('Merker wurde inzwischen geändert. Aktuellen Stand prüfen.', 409, state);
export function parseBookmarkTarget(kind: unknown, targetId: unknown): CommunityBookmarkTarget {
  if ((kind !== 'post' && kind !== 'comment') || typeof targetId !== 'string' || !ID.test(targetId)) throw unavailable();
  return { kind, targetId };
}
export function parseBookmarkInput(body: Record<string, unknown>): CommunityBookmarkInput {
  if (Object.keys(body).length !== 3 || typeof body.saved !== 'boolean' || typeof body.expectedRevision !== 'number' ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= COMMUNITY_BOOKMARK_MAX_REVISION ||
      typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw new CommunityBookmarkError('Ungültige Merkerdaten', 400);
  return { saved: body.saved, expectedRevision: body.expectedRevision, requestId: body.requestId };
}
export function parseBookmarkTargets(body: Record<string, unknown>): CommunityBookmarkTarget[] {
  if (Object.keys(body).length !== 1 || !Array.isArray(body.targets) || body.targets.length > COMMUNITY_BOOKMARK_BATCH_LIMIT) throw new CommunityBookmarkError('Ungültige Merkerabfrage', 400);
  const result = new Map<string, CommunityBookmarkTarget>();
  for (const value of body.targets) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) throw new CommunityBookmarkError('Ungültige Merkerabfrage', 400);
    const target = parseBookmarkTarget(value.kind, value.targetId);
    result.set(communityBookmarkKey(target), target);
  }
  return [...result.values()];
}
export function parseBookmarkFilter(raw: string | null): CommunityBookmarkFilter {
  if (raw === null || raw === 'all') return 'all';
  if (raw !== 'post' && raw !== 'comment') throw new CommunityBookmarkError('Ungültiger Filter', 400);
  return raw;
}
async function requireAccount(userId: string, tx: Prisma.TransactionClient) {
  if (!ID.test(userId) || !await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new CommunityBookmarkError('Nicht authentifiziert', 401);
}
const targetWhere = (target: CommunityBookmarkTarget) => target.kind === 'post' ? { postId: target.targetId } : { commentId: target.targetId };
async function requireTarget(target: CommunityBookmarkTarget, tx: Prisma.TransactionClient) {
  const row = target.kind === 'post'
    ? await tx.post.findFirst({ where: { id: target.targetId, published: true }, select: { id: true } })
    : await tx.comment.findFirst({ where: { id: target.targetId, post: { published: true } }, select: { id: true } });
  if (!row) throw unavailable();
}
const ownState = (target: CommunityBookmarkTarget, row: { savedAt: Date | null; revision: number } | null): OwnCommunityBookmark => ({ ...target, saved: row?.savedAt != null, revision: row?.revision ?? 0 });

/** No mutation retry: only committed response or an explicit conflict. Unknown
 * outcomes require a fresh read; an old request cannot overwrite a later unsave. */
export async function setCommunityBookmark(userId: string, target: CommunityBookmarkTarget, input: CommunityBookmarkInput): Promise<OwnCommunityBookmark> {
  try {
    return await prisma.$transaction(async tx => {
      await requireAccount(userId, tx);
      await requireTarget(target, tx);
      const where = { userId, ...targetWhere(target) };
      const current = await tx.communityBookmark.findFirst({ where });
      const state = ownState(target, current);
      if (current?.lastRequestId === input.requestId) {
        if (current.lastExpectedRevision === input.expectedRevision && state.saved === input.saved) return state;
        throw conflict(state);
      }
      if (state.revision !== input.expectedRevision) throw conflict(state);
      const data = { savedAt: input.saved ? new Date() : null, revision: input.expectedRevision + 1,
        lastRequestId: input.requestId, lastExpectedRevision: input.expectedRevision };
      if (current) {
        const changed = await tx.communityBookmark.updateMany({ where: { id: current.id, userId, revision: input.expectedRevision }, data });
        if (changed.count !== 1) throw conflict();
      } else await tx.communityBookmark.create({ data: { userId, ...targetWhere(target), ...data } });
      return { ...target, saved: input.saved, revision: data.revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034', 'P2003'].includes(error.code)) throw conflict();
    const adapter = error instanceof DriverAdapterError ? error : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1008' ? error.meta?.driverAdapterError : null;
    if (adapter instanceof DriverAdapterError && ((adapter.cause.kind === 'TransactionWriteConflict' && ['40001', '40P01'].includes(adapter.cause.originalCode ?? '')) ||
        (adapter.cause.kind === 'SocketTimeout' && /^SQLITE_BUSY(?:_SNAPSHOT|_RECOVERY|_TIMEOUT)?$/.test(adapter.cause.originalCode ?? '')))) throw conflict();
    throw error;
  }
}

/** At most four bounded queries, independent of batch size. Missing and hidden
 * targets are both omitted; no absent state is invented for either. */
export async function readCommunityBookmarkStates(userId: string, targets: CommunityBookmarkTarget[]): Promise<OwnCommunityBookmark[]> {
  if (targets.length > COMMUNITY_BOOKMARK_BATCH_LIMIT) throw new CommunityBookmarkError('Zu viele Inhalte', 400);
  return prisma.$transaction(async tx => {
    await requireAccount(userId, tx);
    const posts = targets.filter(t => t.kind === 'post').map(t => t.targetId);
    const comments = targets.filter(t => t.kind === 'comment').map(t => t.targetId);
    const [availablePosts, availableComments] = await Promise.all([
      posts.length ? tx.post.findMany({ where: { id: { in: posts }, published: true }, select: { id: true } }) : [],
      comments.length ? tx.comment.findMany({ where: { id: { in: comments }, post: { published: true } }, select: { id: true } }) : [],
    ]);
    const allowed = [...availablePosts.map(p => ({ kind: 'post' as const, targetId: p.id })), ...availableComments.map(c => ({ kind: 'comment' as const, targetId: c.id }))];
    if (!allowed.length) return [];
    const rows = await tx.communityBookmark.findMany({ where: { userId, OR: allowed.map(targetWhere) }, select: { postId: true, commentId: true, savedAt: true, revision: true } });
    const states = new Map(rows.map(row => [row.postId ? `post:${row.postId}` : `comment:${row.commentId}`, row]));
    return allowed.map(target => ownState(target, states.get(communityBookmarkKey(target)) ?? null));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listCommunityBookmarks(userId: string, filter: CommunityBookmarkFilter, rawCursor: string | null): Promise<CommunityBookmarkPage> {
  return prisma.$transaction(async tx => {
    await requireAccount(userId, tx);
    const cursor = readBookmarkCursor(rawCursor, userId, filter);
    const visible: Prisma.CommunityBookmarkWhereInput = filter === 'post' ? { post: { published: true } }
      : filter === 'comment' ? { comment: { post: { published: true } } }
      : { OR: [{ post: { published: true } }, { comment: { post: { published: true } } }] };
    const rows = await tx.communityBookmark.findMany({
      where: { AND: [{ userId, savedAt: { not: null } }, visible, cursor ? { OR: [
        { savedAt: { lt: cursor.savedAt } }, { savedAt: cursor.savedAt, id: { lt: cursor.id } },
      ] } : {}] },
      take: COMMUNITY_BOOKMARK_PAGE_SIZE + 1, orderBy: [{ savedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, postId: true, commentId: true, savedAt: true, revision: true,
        post: { select: { title: true, content: true, author: { select: { name: true, image: true } } } },
        comment: { select: { content: true, post: { select: { title: true } }, author: { select: { name: true, image: true } } } },
      },
    });
    const items = rows.slice(0, COMMUNITY_BOOKMARK_PAGE_SIZE).map(row => {
      const kind = row.postId ? 'post' as const : 'comment' as const;
      const targetId = (row.postId ?? row.commentId)!;
      const target = row.post ?? row.comment!;
      // Plain text only: global posts may contain authored HTML; never render
      // this excerpt as HTML and never copy it into bookmark persistence.
      const excerpt = target.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      return { id: row.id, kind, targetId, saved: true, revision: row.revision, savedAt: row.savedAt!.toISOString(),
        title: row.post?.title ?? row.comment!.post.title, excerpt, author: target.author,
        href: `/api/community/bookmarks/${kind}/${encodeURIComponent(targetId)}` };
    });
    const boundary = rows[COMMUNITY_BOOKMARK_PAGE_SIZE - 1];
    return { items, nextCursor: rows.length > COMMUNITY_BOOKMARK_PAGE_SIZE
      ? encodeBookmarkCursor({ id: boundary.id, savedAt: boundary.savedAt! }, userId, filter) : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** A stale Saved link is an authorization boundary too, including native
 * open-in-new-tab. The redirect then uses the existing older-comment resolver. */
export async function resolveCommunityBookmark(userId: string, target: CommunityBookmarkTarget): Promise<string> {
  return prisma.$transaction(async tx => {
    await requireAccount(userId, tx);
    await requireTarget(target, tx);
    const saved = await tx.communityBookmark.findFirst({ where: { userId, ...targetWhere(target), savedAt: { not: null } }, select: { id: true } });
    if (!saved) throw unavailable();
    return `/community#${target.kind}-${encodeURIComponent(target.targetId)}`;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
