'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: resource reading · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useState, useEffect, useCallback, useEffectEvent, useRef } from 'react';
import { useParams } from 'next/navigation';
import { ThemeToggle } from "@/components/theme-toggle";
import { UserNav } from "@/components/user-nav";
import { Button } from "@/components/ui/button";
import { Book, File, Video, Link as LinkIcon, ArrowLeft, Share2, ExternalLink } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import axios from 'axios';
import { ResourceType } from '@/generated/prisma/client';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Sidebar } from "@/components/Sidebar";
import { getSafeNavigationUrl } from '@/lib/security';
import { ResourcePreview } from '@/components/ResourcePreview';
import Link from 'next/link';

interface Resource {
  id: string;
  title: string;
  type: ResourceType;
  category: string;
  author: {
    id: string;
    name: string | null;
    email: string;
  };
  url: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export default function ResourcePage() {
  const params = useParams();
  const resourceId = typeof params.id === 'string' ? params.id : params.id?.[0];
  const [resource, setResource] = useState<Resource | null>(null);
  const safeResourceUrl = getSafeNavigationUrl(resource?.url);
  const [loading, setLoading] = useState(true);
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  const fetchResource = useCallback(async (
    id: string,
    signal: AbortSignal,
    requestId: number,
  ) => {
    try {
      const response = await axios.get(`/api/resources/${id}`, { signal });

      if (signal.aborted || requestIdRef.current !== requestId) return;
      setResource(response.data);
      setLoadedForId(id);
    } catch (error) {
      if (signal.aborted || requestIdRef.current !== requestId) return;
      console.error('Fehler beim Laden der Ressource:', error);
      toast.error('Ressource konnte nicht geladen werden.');
      setResource(null);
      setLoadedForId(id);
    } finally {
      if (!signal.aborted && requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const startResourceFetch = useEffectEvent(() => {
    if (!resourceId) return;

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    void fetchResource(resourceId, controller.signal, requestId);
  });

  useEffect(() => {
    startResourceFetch();

    return () => {
      activeControllerRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, [resourceId, retryKey]);

  const getIcon = (type: ResourceType) => {
    const iconClass = "h-6 w-6 shrink-0 text-primary";
    switch (type) {
      case 'ARTICLE': return <File className={iconClass} />;
      case 'VIDEO': return <Video className={iconClass} />;
      case 'EBOOK': return <Book className={iconClass} />;
      default: return <LinkIcon className={iconClass} />;
    }
  };

  const typeLabel = resource ? ({ ARTICLE: 'Artikel', VIDEO: 'Video', EBOOK: 'E-Book', PODCAST: 'Podcast', COURSE: 'Kurs' } as Record<ResourceType, string>)[resource.type] : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link kopiert');
    } catch {
      toast.error('Der Link konnte nicht kopiert werden.');
    }
  };

  return (
    <AppShell data-page-family="detail">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <div className="app-header-title"><Button asChild type="button" variant="ghost" size="sm"><Link href="/resources" aria-label="Zur Ressourcenübersicht"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zurück</Link></Button></div>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <ToastContainer position="top-right" />
          <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            {loading || loadedForId !== resourceId ? <><h1 className="sr-only">Ressource</h1><PageState kind="loading" title="Ressource wird geladen" /></>
              : !resource ? <><h1 className="sr-only">Ressource</h1><PageState kind="error" title="Ressource nicht verfügbar" description="Die Ressource konnte nicht geladen werden oder wurde entfernt." action={<div className="flex flex-wrap justify-center gap-2"><Button type="button" variant="outline" onClick={() => { setLoading(true); setRetryKey(value => value + 1); }}>Erneut versuchen</Button><Button asChild variant="outline"><Link href="/resources">Zur Übersicht</Link></Button></div>} /></>
              : <article>
                <div className="flex flex-wrap items-center justify-end gap-3 border-b pb-5">

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" aria-label="Ressource teilen"><Share2 className="h-4 w-4" aria-hidden="true" />Teilen</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void handleCopyLink()}>Link kopieren</DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <header className="fc-detail-header mx-auto mb-6 max-w-[72ch]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2 font-semibold text-foreground">{getIcon(resource.type)}{typeLabel}</span><span>{resource.category}</span></div>
                  <h1 className="mt-5 min-w-0 break-words text-[clamp(2rem,1.35rem+2.5vw,3.5rem)] font-semibold leading-tight tracking-[-0.045em] [overflow-wrap:anywhere]">{resource.title}</h1>
                  <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"><span>Von {resource.author.name || resource.author.email || 'Unbekannt'}</span><span aria-hidden="true">·</span><time dateTime={resource.createdAt}>{new Date(resource.createdAt).toLocaleDateString('de-DE')}</time></div>
                </header>

                <div className="fc-section-card mx-auto max-w-[72ch]">
                  <h2 className="text-base font-semibold tracking-tight">Quelle</h2>
                  {safeResourceUrl ? <div className="mt-3 flex flex-wrap items-center gap-3"><Button asChild><a href={safeResourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden="true" />Ressource öffnen</a></Button><span className="min-w-0 break-all text-sm text-muted-foreground">{safeResourceUrl}</span></div> : <p className="mt-2 text-sm text-muted-foreground">Für diese Ressource ist keine sichere Zieladresse verfügbar.</p>}
                </div>

                {safeResourceUrl && <section aria-labelledby="resource-preview-title" className="fc-section-card mx-auto mt-6 max-w-4xl"><h2 id="resource-preview-title" className="mb-4 text-lg font-semibold tracking-tight">Vorschau</h2><div className="overflow-hidden rounded-[14px] border bg-card"><ResourcePreview url={resource.url} type={resource.type} /></div></section>}
              </article>}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
