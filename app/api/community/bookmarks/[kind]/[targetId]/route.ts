import { NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/server/api-input';
import { bookmarkActor, bookmarkErrorResponse, BOOKMARK_NO_STORE } from '@/lib/server/community-bookmark-api';
import { parseBookmarkInput, parseBookmarkTarget, resolveCommunityBookmark, setCommunityBookmark } from '@/lib/server/community-bookmarks';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ kind: string; targetId: string }> };
export async function PUT(request: Request, { params }: Context) {
  try {
    const userId = await bookmarkActor(request, true);
    const path = await params;
    const target = parseBookmarkTarget(path.kind, path.targetId);
    const input = parseBookmarkInput(await readJsonObject(request, 1024));
    return NextResponse.json({ state: await setCommunityBookmark(userId, target, input) }, { headers: BOOKMARK_NO_STORE });
  } catch (error) { return bookmarkErrorResponse(error); }
}

export async function GET(request: Request, { params }: Context) {
  try {
    const userId = await bookmarkActor(request);
    const path = await params;
    const href = await resolveCommunityBookmark(userId, parseBookmarkTarget(path.kind, path.targetId));
    return NextResponse.redirect(new URL(href, request.url), { status: 303, headers: BOOKMARK_NO_STORE });
  } catch (error) { return bookmarkErrorResponse(error); }
}
