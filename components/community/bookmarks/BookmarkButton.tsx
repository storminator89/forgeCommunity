'use client';
import { useId } from 'react';
import { Bookmark, BookmarkCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CommunityBookmarkTarget } from '@/lib/community-bookmarks';
import { useCommunityBookmark } from './CommunityBookmarksProvider';
import { useCommentActionFocus as useActionFocus } from '@/components/community/useCommentActionFocus';
import { communityBookmarkKey } from '@/lib/community-bookmarks';

export function BookmarkButton(target: CommunityBookmarkTarget) {
  const bookmark = useCommunityBookmark(target);
  const errorId = useId();
  const actionFocus = useActionFocus(communityBookmarkKey(target), undefined, Boolean(bookmark?.entry?.pending));
  if (!bookmark) return null;
  const { entry, change, refresh } = bookmark;
  const name = target.kind === 'post' ? 'Beitrag' : 'Kommentar';
  const retry = entry?.uncertain;
  const Icon = retry ? RefreshCw : entry?.state?.saved ? BookmarkCheck : Bookmark;
  return <div className="min-w-0">
    <Button type="button" variant="ghost" size="sm" className="min-h-11 max-w-full text-muted-foreground data-[saved=true]:text-primary"
      data-saved={entry?.state?.saved ?? false} aria-pressed={entry?.state?.saved ?? false}
      aria-label={entry?.unavailable ? `${name} nicht verfügbar` : retry ? `${name}: Stand erneut laden` : `${name} ${entry?.state?.saved ? 'aus Merkliste entfernen' : 'merken'}`}
      aria-describedby={entry?.error ? errorId : undefined} aria-busy={entry?.pending || (!entry && !retry)}
      disabled={entry?.pending || entry?.unavailable || (!entry?.state && !retry)} onClick={async event => {
        if (retry) { refresh(); return; }
        const focus = actionFocus.begin(event.currentTarget);
        try { await change(); } finally { actionFocus.complete(focus); }
      }}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {entry?.unavailable ? 'Nicht verfügbar' : entry?.pending ? 'Speichert…' : retry ? 'Stand prüfen' : entry?.state?.saved ? 'Gemerkt' : 'Merken'}
    </Button>
    {entry?.error && <p id={errorId} role="alert" className="max-w-64 text-sm text-destructive [overflow-wrap:anywhere]">{entry.error}</p>}
  </div>;
}
