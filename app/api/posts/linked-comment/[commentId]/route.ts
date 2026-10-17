import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { communityCommentInclude, communityPostInclude, communityVisibility, isCurrentCommunityAdmin, normalizeCommunityComment, normalizeCommunityPost } from '@/lib/server/community-feed';

/** Resolve an existing comment link without scanning older feed/comment pages. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    const { commentId } = await params;
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    const linkedComment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { ...communityCommentInclude(userId), post: { select: { id: true, authorId: true, published: true } } },
    });
    if (!linkedComment) return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 });
    const isAdmin = !linkedComment.post.published && linkedComment.post.authorId !== userId
      ? await isCurrentCommunityAdmin(userId, session?.user?.role)
      : false;
    if (!linkedComment.post.published && linkedComment.post.authorId !== userId && !isAdmin) {
      return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 });
    }
    const post = await prisma.post.findUnique({
      where: { id: linkedComment.post.id, AND: [communityVisibility(userId, isAdmin)] },
      include: communityPostInclude(userId),
    });
    if (!post) return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 });
    const normalized = normalizeCommunityPost(post, userId);
    if (!normalized.comments.some(comment => comment.id === commentId)) {
      const { post: _parent, ...comment } = linkedComment;
      normalized.comments.push(normalizeCommunityComment(comment, post.published && post.authorId === userId));
      normalized.comments.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() ||
        (left.id === right.id ? 0 : left.id < right.id ? 1 : -1));
    }
    // Preserve the ordinary 3-comment preview cursor so following it cannot
    // skip replies between that boundary and a separately resolved older link.
    return NextResponse.json(normalized, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Fehler beim Abrufen des verlinkten Kommentars:', error);
    return NextResponse.json({ error: 'Kommentar konnte nicht geladen werden' }, { status: 500 });
  }
}
