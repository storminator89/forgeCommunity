"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ArrowUpRight, Github, Heart, MessageSquare, Share2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageState } from '@/components/page-state';
import { getSafeHttpUrl, getSafeNavigationUrl } from '@/lib/security';
import { sanitizeTextPreview } from '@/lib/sanitize-html';

interface Project {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  link: string;
  githubUrl?: string;
  category?: string;
  tags: string[];
  createdAt: string;
  stats: { likes: number; comments: number };
  isLiked: boolean;
}

export function ProjectsList({ userId, isOwner }: { userId: string; isOwner: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingLikeId, setPendingLikeId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  const fetchProjects = useCallback(async (pageNum: number, signal: AbortSignal, requestId: number) => {
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/projects?page=${pageNum}&limit=6`, {
        credentials: 'include', signal,
      });
      if (!response.ok) throw new Error('Projekte konnten nicht geladen werden.');
      const data = await response.json() as { projects: Project[]; pagination: { hasMore: boolean } };
      if (signal.aborted || requestIdRef.current !== requestId) return;
      setProjects(previous => pageNum === 1 ? data.projects : [...previous, ...data.projects]);
      setPage(pageNum);
      setHasMore(data.pagination.hasMore);
      setLoadError(null);
      setLoadedForUserId(userId);
    } catch (error) {
      if (signal.aborted || requestIdRef.current !== requestId) return;
      console.error('Error fetching projects:', error);
      setLoadError('Projekte konnten nicht geladen werden.');
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
      setProjects([]);
      setPage(1);
      setHasMore(false);
      setLoadedForUserId(null);
    }
    void fetchProjects(pageNum, controller.signal, requestId);
  }, [fetchProjects]);

  useEffect(() => {
    const timer = window.setTimeout(() => startFetch(1), 0);
    return () => { window.clearTimeout(timer); activeControllerRef.current?.abort(); requestIdRef.current += 1; };
  }, [startFetch]);

  const handleLike = async (projectId: string) => {
    if (pendingLikeId) return;
    setPendingLikeId(projectId);
    setActionError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/like`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Das Projekt konnte nicht bewertet werden.');
      // This endpoint toggles the like on every POST.
      setProjects(previous => previous.map(project => project.id === projectId ? {
        ...project,
        isLiked: !project.isLiked,
        stats: { ...project.stats, likes: Math.max(0, project.stats.likes + (project.isLiked ? -1 : 1)) },
      } : project));
    } catch (error) {
      console.error('Error liking project:', error);
      setActionError('Das Projekt konnte nicht bewertet werden.');
    } finally {
      setPendingLikeId(null);
    }
  };

  const handleShare = async (project: Project) => {
    const url = new URL(`/projects/${encodeURIComponent(project.id)}`, window.location.origin).toString();
    setActionError(null);
    if (navigator.share) {
      try {
        await navigator.share({ title: project.title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
    } catch (error) {
      console.error('Error sharing project:', error);
      setActionError('Der Projektlink konnte nicht geteilt werden. Öffne stattdessen die Projektdetails.');
    }
  };

  if (loadedForUserId !== userId || (isLoading && page === 1 && projects.length === 0)) {
    return <PageState kind="loading" title="Projekte werden geladen" />;
  }
  if (loadError && projects.length === 0) {
    return <PageState kind="error" title={loadError} description="Prüfe deine Verbindung und versuche es erneut." action={<Button variant="outline" onClick={() => startFetch(1)}>Erneut versuchen</Button>} />;
  }
  if (projects.length === 0) {
    return <PageState title="Noch keine Projekte" description={isOwner ? 'Du kannst dein erstes Projekt veröffentlichen.' : 'Dieses Mitglied hat noch keine Projekte veröffentlicht.'} action={isOwner ? <Button asChild><Link href="/projects/new">Projekt erstellen</Link></Button> : undefined} />;
  }

  return (
    <div>
      {actionError && <p role="alert" className="mb-4 rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</p>}
      {loadError && <p role="alert" className="mb-4 rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError} <Button variant="outline" size="sm" className="ml-2" onClick={() => startFetch(page + 1)}>Erneut versuchen</Button></p>}
      <ul className="divide-y border-y">
        {projects.map(project => {
          const safeImage = getSafeNavigationUrl(project.imageUrl);
          const safeDemo = getSafeHttpUrl(project.link);
          const safeCode = getSafeHttpUrl(project.githubUrl);
          return <li key={project.id} className="grid min-w-0 gap-5 py-6 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">{project.category && <span className="font-semibold uppercase tracking-[0.08em] text-foreground">{project.category}</span>}<time dateTime={project.createdAt}>{format(new Date(project.createdAt), 'dd. MMM yyyy', { locale: de })}</time></div>
              <h3 className="mt-2 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]"><Link href={`/projects/${encodeURIComponent(project.id)}`} className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{project.title}</Link></h3>
              <p className="mt-2 line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{sanitizeTextPreview(project.description, 200)}</p>
              {project.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{project.tags.map(tag => <Badge key={tag} variant="secondary" className="max-w-full break-all">{tag}</Badge>)}</div>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm"><Link href={`/projects/${encodeURIComponent(project.id)}`}>Details <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
                {safeDemo && <Button asChild variant="ghost" size="sm"><a href={safeDemo} target="_blank" rel="noopener noreferrer">Demo <span className="sr-only">(öffnet in neuem Tab)</span></a></Button>}
                {safeCode && <Button asChild variant="ghost" size="sm"><a href={safeCode} target="_blank" rel="noopener noreferrer"><Github className="h-4 w-4" aria-hidden="true" />Code <span className="sr-only">(öffnet in neuem Tab)</span></a></Button>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" aria-label={project.isLiked ? 'Gefällt mir zurücknehmen' : 'Projekt gefällt mir'} aria-pressed={project.isLiked} disabled={pendingLikeId === project.id} onClick={() => void handleLike(project.id)}><Heart className="h-4 w-4" aria-hidden="true" />{project.stats.likes}</Button>
                <Button asChild variant="ghost" size="sm"><Link href={`/projects/${encodeURIComponent(project.id)}#comments`} aria-label={`${project.stats.comments} Kommentare zu ${project.title}`}><MessageSquare className="h-4 w-4" aria-hidden="true" />{project.stats.comments}</Link></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Projekt ${project.title} teilen`} onClick={() => void handleShare(project)}><Share2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            </div>
            {safeImage && <div className="h-28 w-full rounded-[10px] bg-muted bg-cover bg-center sm:w-44" style={{ backgroundImage: `url("${safeImage.replaceAll('"', '%22')}")` }} role="img" aria-label={`Vorschaubild für ${project.title}`} />}
          </li>;
        })}
      </ul>
      {hasMore && <div className="mt-6"><Button type="button" variant="outline" onClick={() => startFetch(page + 1)} disabled={isLoading}>{isLoading ? 'Wird geladen…' : 'Mehr laden'}</Button></div>}
    </div>
  );
}
