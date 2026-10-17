import { NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/server/api-input';
import { bookmarkActor, bookmarkErrorResponse, BOOKMARK_NO_STORE } from '@/lib/server/community-bookmark-api';
import { parseBookmarkTargets, readCommunityBookmarkStates } from '@/lib/server/community-bookmarks';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const userId = await bookmarkActor(request, true);
    const targets = parseBookmarkTargets(await readJsonObject(request, 32_768));
    return NextResponse.json({ states: await readCommunityBookmarkStates(userId, targets) }, { headers: BOOKMARK_NO_STORE });
  } catch (error) { return bookmarkErrorResponse(error); }
}
