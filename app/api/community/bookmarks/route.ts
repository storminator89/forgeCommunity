import { NextResponse } from 'next/server';
import { bookmarkActor, bookmarkErrorResponse, BOOKMARK_NO_STORE } from '@/lib/server/community-bookmark-api';
import { listCommunityBookmarks, parseBookmarkFilter } from '@/lib/server/community-bookmarks';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const userId = await bookmarkActor(request);
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listCommunityBookmarks(userId, parseBookmarkFilter(params.get('filter')), params.get('cursor')), { headers: BOOKMARK_NO_STORE });
  } catch (error) { return bookmarkErrorResponse(error); }
}
