"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { MessageSquare, ThumbsUp, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageState } from '@/components/page-state';
import { sanitizeTextPreview } from '@/lib/sanitize-html';

interface Activity {
  type: 'post' | 'comment' | 'project' | 'course';
  id: string;
  title?: string;
  content?: string;
  description?: string;
  postTitle?: string;
  postId?: string;
  stats?: { comments?: number; likes?: number; enrollments?: number };
  createdAt: string;
}

const activityTypes: Record<Activity['type'], string> = {
  post: 'Beitrag', comment: 'Kommentar', project: 'Projekt', course: 'Kurs',
};

function activityHref(activity: Activity) {
  if (activity.type === 'post') return `/community#post-${encodeURIComponent(activity.id)}`;
  if (activity.type === 'comment') return `/community#comment-${encodeURIComponent(activity.id)}`;
  if (activity.type === 'project') return `/projects/${encodeURIComponent(activity.id)}`;
  return `/courses/${encodeURIComponent(activity.id)}`;
}

function activityTitle(activity: Activity) {
  if (activity.type === 'comment') return activity.postTitle || 'Kommentar ansehen';
  return activity.title || `${activityTypes[activity.type]} ansehen`;
}

export function ActivityFeed({ userId }: { userId: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  const fetchActivities = useCallback(async (pageNum: number, signal: AbortSignal, requestId: number) => {
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/activity?page=${pageNum}&limit=10`, {
        credentials: 'include', signal,
      });
      if (!response.ok) throw new Error('Aktivitäten konnten nicht geladen werden.');
      const data = await response.json() as { activities: Activity[]; pagination: { hasMore: boolean } };
      if (signal.aborted || requestIdRef.current !== requestId) return;
      setActivities(previous => pageNum === 1 ? data.activities : [...previous, ...data.activities]);
      setPage(pageNum);
      setHasMore(data.pagination.hasMore);
      setLoadError(null);
      setLoadedForUserId(userId);
    } catch (error) {
      if (signal.aborted || requestIdRef.current !== requestId) return;
      console.error('Error fetching activities:', error);
      setLoadError('Aktivitäten konnten nicht geladen werden.');
      setLoadedForUserId(userId);
    } finally {
      if (!signal.aborted && requestIdRef.current === requestId) setIsLoading(false);
    }
  }, [userId]);

  const startFetch = useCallback((pageNum: number) => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError(null);
    if (pageNum === 1) {
      setActivities([]);
      setPage(1);
      setHasMore(false);
      setLoadedForUserId(null);
    }
    void fetchActivities(pageNum, controller.signal, requestId);
  }, [fetchActivities]);

  useEffect(() => {
    const timer = window.setTimeout(() => startFetch(1), 0);
    return () => { window.clearTimeout(timer); activeControllerRef.current?.abort(); requestIdRef.current += 1; };
  }, [startFetch]);

  if (loadedForUserId !== userId || (isLoading && page === 1 && activities.length === 0)) {
    return <PageState kind="loading" title="Aktivitäten werden geladen" />;
  }
  if (loadError && activities.length === 0) {
    return <PageState kind="error" title={loadError} description="Prüfe deine Verbindung und versuche es erneut." action={<Button variant="outline" onClick={() => startFetch(1)}>Erneut versuchen</Button>} />;
  }
  if (activities.length === 0) {
    return <PageState title="Noch keine Aktivitäten" description="Hier erscheinen Beiträge, Kommentare, Projekte und Kurse dieses Mitglieds." />;
  }

  return (
    <div>
      {loadError && <p role="alert" className="mb-4 rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError} <Button variant="outline" size="sm" className="ml-2" onClick={() => startFetch(page + 1)}>Erneut versuchen</Button></p>}
      <ol className="divide-y border-y">
        {activities.map(activity => (
          <li key={`${activity.type}-${activity.id}`} className="grid min-w-0 gap-2 py-5 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:gap-5">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{activityTypes[activity.type]}</span>
            <div className="min-w-0">
              <Link href={activityHref(activity)} className="break-words font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [overflow-wrap:anywhere]">{activityTitle(activity)}</Link>
              {(activity.content || activity.description) && <p className="mt-1 line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{sanitizeTextPreview(activity.content || activity.description || '', 220)}</p>}
              {activity.stats && <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                {typeof activity.stats.likes === 'number' && <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />{activity.stats.likes} Likes</span>}
                {typeof activity.stats.comments === 'number' && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{activity.stats.comments} Kommentare</span>}
                {typeof activity.stats.enrollments === 'number' && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden="true" />{activity.stats.enrollments} Teilnahmen</span>}
              </div>}
            </div>
            <time dateTime={activity.createdAt} className="text-xs text-muted-foreground sm:text-right">{format(new Date(activity.createdAt), 'dd. MMM yyyy', { locale: de })}</time>
          </li>
        ))}
      </ol>
      {hasMore && <div className="mt-6"><Button type="button" variant="outline" onClick={() => startFetch(page + 1)} disabled={isLoading}>{isLoading ? 'Wird geladen…' : 'Mehr laden'}</Button></div>}
    </div>
  );
}
