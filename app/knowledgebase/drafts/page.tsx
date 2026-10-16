'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: draft worklist · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Edit,
  Trash2,
  Plus,
  Search
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/utils";
import { toast } from 'sonner';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Draft {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  featuredImage: string | null;
  content: string; // Hinzufügen für Vorschau
}

export default function DraftsPage() {
  const { data: session, status } = useSession();
  const accountId = status === 'authenticated' ? session?.user?.id ?? null : null;
  // A session change must discard private drafts during render, before a new
  // account's request starts or a previous account's request settles.
  return <AccountDrafts key={accountId ?? 'anonymous'} accountId={accountId} status={status} />;
}

function AccountDrafts({ accountId, status }: { accountId: string | null; status: 'loading' | 'authenticated' | 'unauthenticated' }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const fetchDrafts = async () => {
      try {
        const response = await fetch('/api/articles/drafts', { signal: controller.signal });
        if (!response.ok) throw new Error('Draft fetch failed');
        const data = await response.json() as Draft[];
        if (controller.signal.aborted) return;
        setDrafts(data);
        setLoadError(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(true);
        toast.error('Fehler beim Laden der Entwürfe');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void fetchDrafts();
    return () => controller.abort();
  }, [accountId, retryKey]);

  const handleDelete = async (id: string) => {
    setActionInProgress(id);
    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setDrafts(previous => previous.filter(draft => draft.id !== id));
        toast.success('Entwurf wurde gelöscht');
      } else {
        throw new Error('Fehler beim Löschen');
      }
    } catch (error) {
      toast.error('Fehler beim Löschen des Entwurfs');
    } finally {
      setActionInProgress(null);
      setShowDeleteDialog(false);
    }
  };

  const filteredAndSortedDrafts = drafts
    .filter(draft =>
      draft.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      draft.category.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'oldest':
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

  const retryLoad = () => { setIsLoading(true); setLoadError(false); setRetryKey(value => value + 1); };
  const newArticleLink = <Button asChild><Link href="/knowledgebase/new-article"><Plus className="h-4 w-4" aria-hidden="true" />Neuer Artikel</Link></Button>;

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <h1 className="app-header-title">Entwürfe</h1>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <div className="flex flex-wrap items-end justify-between gap-5 border-b pb-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Wissen / Meine Entwürfe</p>
                <p className="mt-2 max-w-[55ch] text-base leading-relaxed text-muted-foreground">Begonnene Artikel weiterbearbeiten und veröffentlichen.</p>
              </div>
              {newArticleLink}
            </div>

            <div className="grid gap-3 pt-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="min-w-0">
                <label htmlFor="draft-search" className="mb-2 block text-sm font-medium">Entwürfe suchen</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="draft-search" type="search" placeholder="Titel oder Kategorie" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="pl-10" />
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button type="button" variant="outline">Sortieren: {sortBy === 'title' ? 'Titel A–Z' : sortBy === 'oldest' ? 'Älteste' : 'Neueste'}</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Sortieren nach</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSortBy('newest')}>Neueste zuerst</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('oldest')}>Älteste zuerst</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('title')}>Titel A–Z</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-9 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
              <h2 className="text-xl font-semibold tracking-tight">Meine Entwürfe</h2>
              <p role="status" className="text-sm tabular-nums text-muted-foreground">{filteredAndSortedDrafts.length} {filteredAndSortedDrafts.length === 1 ? 'Entwurf' : 'Entwürfe'}</p>
            </div>

            {status === 'loading' || (accountId && isLoading) ? (
              <div className="space-y-1" role="status" aria-label="Entwürfe werden geladen">
                {[1, 2, 3].map(index => <div key={index} className="space-y-3 border-b py-6"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-1/2" /></div>)}
              </div>
            ) : !accountId ? (
              <div className="mt-6"><PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um deine Entwürfe zu sehen." action={<Button asChild variant="outline"><Link href="/login">Zur Anmeldung</Link></Button>} /></div>
            ) : loadError ? (
              <div className="mt-6"><PageState kind="error" title="Entwürfe konnten nicht geladen werden" description="Bitte versuche es erneut." action={<Button type="button" variant="outline" onClick={retryLoad}>Erneut versuchen</Button>} /></div>
            ) : filteredAndSortedDrafts.length === 0 ? (
              <div className="mt-6"><PageState title={searchQuery ? 'Keine Ergebnisse gefunden' : 'Keine Entwürfe vorhanden'} description={searchQuery ? 'Keine Entwürfe für diese Suche gefunden.' : 'Erstelle deinen ersten Artikel-Entwurf, um ihn später zu veröffentlichen.'} action={searchQuery ? <Button type="button" variant="outline" onClick={() => setSearchQuery('')}>Suche zurücksetzen</Button> : <Button asChild variant="outline"><Link href="/knowledgebase/new-article">Neuen Artikel erstellen</Link></Button>} /></div>
            ) : (
              <ul className="divide-y">
                {filteredAndSortedDrafts.map(draft => (
                  <li key={draft.id} className="min-w-0 py-6">
                    <div className={'grid min-w-0 gap-4 ' + (draft.featuredImage ? 'sm:grid-cols-[minmax(0,1fr)_5rem]' : '')}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{draft.category}</Badge><span className="text-xs text-muted-foreground">Entwurf</span></div>
                        <h3 className="mt-2 min-w-0 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]"><Link href={'/knowledgebase/edit/' + draft.id} className="hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{draft.title}</Link></h3>
                        <time dateTime={draft.updatedAt} className="mt-2 block text-xs text-muted-foreground">Zuletzt bearbeitet: {formatDate(draft.updatedAt)}</time>
                        {draft.content && <p className="mt-3 line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{draft.content.replace(/<[^>]*>/g, '')}</p>}
                      </div>
                      {draft.featuredImage && <div className="relative aspect-square h-20 w-20 overflow-hidden rounded-[10px] bg-muted"><Image src={draft.featuredImage} alt="" fill className="object-cover" /></div>}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" size="sm"><Link href={'/knowledgebase/edit/' + draft.id}><Edit className="h-4 w-4" aria-hidden="true" />Bearbeiten</Link></Button>
                      <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => { setDeletingId(draft.id); setShowDeleteDialog(true); }} disabled={!!actionInProgress}>
                        {actionInProgress === draft.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}Löschen
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Entwurf löschen</AlertDialogTitle>
              <AlertDialogDescription>Möchtest du diesen Entwurf wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={() => deletingId && handleDelete(deletingId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Löschen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
