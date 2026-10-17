import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { changeAcceptedSolution, SolutionError } from '@/lib/server/accepted-solutions';
import { communityPostInclude, normalizeCommunityPost } from '@/lib/server/community-feed';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  let actorId: string | undefined;
  let postId: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    actorId = session?.user?.id;
    if (!actorId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle' }, { status: 403 });
    ({ postId } = await params);
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(postId)) return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 });
    const body = await readJsonObject(request, 1024);
    const { commentId, expectedRevision } = body;
    if (!(commentId === null || (typeof commentId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(commentId))) ||
        !(expectedRevision === null || (typeof expectedRevision === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(expectedRevision)))) {
      return NextResponse.json({ error: 'Kommentar und aktueller Lösungsstand sind erforderlich' }, { status: 400 });
    }
    const result = await changeAcceptedSolution(postId, actorId, commentId, expectedRevision);
    // Recheck visibility after commit: an intervening hide/delete cannot leak
    // a solution or turn a historical decision into a public signal.
    const post = await prisma.post.findUnique({ where: { id: postId, authorId: actorId }, include: communityPostInclude(actorId) });
    if (!post) return NextResponse.json({ error: 'Beitrag nicht gefunden' }, { status: 404 });
    return NextResponse.json({ ...result, post: normalizeCommunityPost(post, actorId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    if (error instanceof SolutionError) {
      // Refresh only the requesting author's own discussion. A reply may have
      // been removed or become ineligible since the UI last loaded its signal.
      const post = [400, 404, 409].includes(error.status) && postId && actorId
        ? await prisma.post.findUnique({ where: { id: postId, authorId: actorId }, include: communityPostInclude(actorId) }) : null;
      return NextResponse.json({ error: error.message, ...(post ? { post: normalizeCommunityPost(post, actorId) } : {}) },
        { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    }
    console.error('Accepted solution change failed:', error);
    return NextResponse.json({ error: 'Lösung konnte nicht gespeichert werden' }, { status: 500 });
  }
}
