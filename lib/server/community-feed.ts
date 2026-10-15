import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { InvalidPaginationError } from './api-input';

export const COMMUNITY_PAGE_SIZE = 50;
export const COMMUNITY_COMMENT_PREVIEW_SIZE = 3;
export const COMMUNITY_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.PostOrderByWithRelationInput[];

const author = { select: { id: true, name: true, image: true } } as const;
type CursorScope = 'posts' | 'comments';
type CommunityCursor = { createdAt: Date; id: string };

/** Carry the boundary values, rather than referencing a row which can be deleted. */
export function encodeCommunityCursor(row: CommunityCursor, scope: CursorScope, postId?: string, tag?: string | null): string {
  return Buffer.from(JSON.stringify({ v: 1, scope, ...(postId ? { postId } : {}), ...(tag ? { tag } : {}), createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}

export function readCommunityCursor(request: Request, scope: CursorScope, postId?: string, tag?: string | null): CommunityCursor | null {
  const raw = new URL(request.url).searchParams.get('cursor');
  if (raw === null) return null;
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new InvalidPaginationError();
  try {
    const decoded = Buffer.from(raw, 'base64url');
    if (decoded.toString('base64url') !== raw) throw new Error('Noncanonical cursor');
    const value = JSON.parse(decoded.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1 || value.scope !== scope ||
        value.postId !== postId || value.tag !== (tag || undefined) || typeof value.id !== 'string' || !value.id || value.id.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(value.id) || typeof value.createdAt !== 'string') throw new Error('Invalid cursor');
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error('Invalid cursor date');
    return { createdAt, id: value.id };
  } catch {
    throw new InvalidPaginationError();
  }
}

export function afterCommunityCursor(cursor: CommunityCursor | null) {
  return cursor ? { OR: [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ] } : {};
}

/** Only an authenticated, currently stored ADMIN can read another member's draft. */
export async function isCurrentCommunityAdmin(userId?: string, sessionRole?: string | null): Promise<boolean> {
  if (!userId || sessionRole !== 'ADMIN') return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === 'ADMIN';
}

export function communityVisibility(userId?: string, isAdmin = false): Prisma.PostWhereInput {
  if (isAdmin) return {};
  return userId ? { OR: [{ published: true }, { published: false, authorId: userId }] } : { published: true };
}

export function communityCommentInclude(userId?: string) {
  return {
    author: { select: { id: true, name: true, image: true, isTestAccount: true } },
    _count: { select: { likeComments: true } },
    // Unique (userId, commentId) makes this at most one row. Anonymous reads
    // never materialize any likes, even when the aggregate count is large.
    likeComments: { ...(userId ? { where: { userId } } : {}), take: userId ? 1 : 0, select: { id: true } },
  } satisfies Prisma.CommentInclude;
}

export function communityPostInclude(userId?: string) {
  return {
    author,
    tags: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
    _count: { select: { likePosts: true, comments: true } },
    likePosts: { ...(userId ? { where: { userId } } : {}), take: userId ? 1 : 0, select: { id: true } },
    // Independent bounded include: never expand or shift the comment preview.
    acceptedSolution: { include: { comment: { include: communityCommentInclude(userId) } } },
    comments: {
      take: COMMUNITY_COMMENT_PREVIEW_SIZE,
      orderBy: COMMUNITY_ORDER,
      include: communityCommentInclude(userId),
    },
  } satisfies Prisma.PostInclude;
}

type CommentRecord = Prisma.CommentGetPayload<{ include: ReturnType<typeof communityCommentInclude> }>;
type PostRecord = Prisma.PostGetPayload<{ include: ReturnType<typeof communityPostInclude> }>;

export function normalizeCommunityComment(comment: CommentRecord, canSelectSolution = false) {
  const { _count, likeComments, author: replyAuthor, ...fields } = comment;
  return { ...fields,
    author: { id: replyAuthor.id, name: replyAuthor.name, image: replyAuthor.image },
    ...(canSelectSolution ? { solutionEligible: !replyAuthor.isTestAccount } : {}),
    votes: _count.likeComments, isLiked: likeComments.length > 0 };
}

export function normalizeCommunityPost(post: PostRecord, viewerId?: string) {
  const { _count, likePosts, comments, acceptedSolution, ...fields } = post;
  const visibleSolution = post.published && acceptedSolution &&
    acceptedSolution.comment.authorId !== post.authorId && !acceptedSolution.comment.author.isTestAccount
    ? acceptedSolution : null;

  return {
    ...fields,
    solutionRevision: visibleSolution || post.authorId === viewerId ? acceptedSolution?.revision ?? null : null,
    acceptedSolution: visibleSolution ? {
      revision: visibleSolution.revision, comment: normalizeCommunityComment(visibleSolution.comment, post.published && post.authorId === viewerId),
    } : null,
    acceptedSolutionCount: visibleSolution ? 1 : 0,
    votes: _count.likePosts,
    isLiked: likePosts.length > 0,
    comments: comments.map(comment => normalizeCommunityComment(comment, post.published && post.authorId === viewerId)),
    commentCount: _count.comments,
    commentsNextCursor: comments.length > 0 && _count.comments > comments.length
      ? encodeCommunityCursor(comments[comments.length - 1], 'comments', post.id)
      : null,
  };
}

export function communityPage<T extends CommunityCursor>(rows: T[], scope: CursorScope, postId?: string, tag?: string | null) {
  const items = rows.slice(0, COMMUNITY_PAGE_SIZE);
  return {
    items,
    nextCursor: rows.length > COMMUNITY_PAGE_SIZE
      ? encodeCommunityCursor(items[items.length - 1], scope, postId, tag)
      : null,
  };
}
