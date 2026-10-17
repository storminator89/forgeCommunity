'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: resource directory · design-system: design.md · designed-as-app */

import { HeroBanner, PageContainer } from '@/components/discovery';
import { FolderOpen } from 'lucide-react';
import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Book, File, Video, Link as LinkIcon, Search, Plus, MoreVertical, Edit, Trash2, Copy, Check, ArrowUpRight } from 'lucide-react';
import axios from 'axios';
import { useSession } from '@/lib/sites-auth/react';
import type { Session } from '@/lib/sites-auth/server';
import { ToastContainer, toast } from 'react-toastify';
import { useInView } from 'react-intersection-observer';
import { getSafeNavigationUrl } from '@/lib/security';
import Link from 'next/link';
import { RESOURCE_QUERY_LIMIT, readResourceDirectoryState, resourceDirectoryHref, type ResourceDirectoryState, type ResourceSort } from './resources-directory-url';

const directoryUrlChange = 'forge-resource-directory-url-change';

function subscribeDirectoryUrl(callback: () => void) {
  window.addEventListener('popstate', callback);
  window.addEventListener(directoryUrlChange, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(directoryUrlChange, callback);
  };
}

function directorySearchSnapshot() { return window.location.search; }
function serverDirectorySearchSnapshot() { return ''; }

enum ResourceType {
  ARTICLE = 'ARTICLE',
  VIDEO = 'VIDEO',
  EBOOK = 'EBOOK',
  PODCAST = 'PODCAST',
  COURSE = 'COURSE',
}

interface User {
  id: string;
  name: string | null;
  email: string;
}

interface Resource {
  id: string;
  title: string;
  type: ResourceType;
  category: string;
  author: User;
  url: string;
  createdAt: string;
  updatedAt: string;
}

const categories = ["Web Development", "Data Science", "Design", "Mobile Development", "DevOps"];
const types = ["ARTICLE", "VIDEO", "EBOOK", "PODCAST", "COURSE"];
const ITEMS_PER_PAGE = 9;
const typeLabels: Record<ResourceType, string> = {
  ARTICLE: 'Artikel', VIDEO: 'Video', EBOOK: 'E-Book', PODCAST: 'Podcast', COURSE: 'Kurs',
};

export default function ResourceLibrary() {
  const { data, status } = useSession();
  const session = status === 'authenticated' ? data : null;
  return <ResourceLibraryForViewer key={session?.user?.id ?? 'anonymous'} session={session} />;
}

function ResourceLibraryForViewer({ session }: { session: Session | null }) {
  const urlSearch = useSyncExternalStore(subscribeDirectoryUrl, directorySearchSnapshot, serverDirectorySearchSnapshot);
  const directoryState = useMemo(() => readResourceDirectoryState(urlSearch, categories, types), [urlSearch]);
  const { query: searchTerm, category: selectedCategory, type: selectedType, sort: sortBy } = directoryState;
  const searchRef = useRef<HTMLInputElement>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [newResource, setNewResource] = useState({
    title: '',
    type: 'ARTICLE',
    category: 'Web Development',
    url: '',
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAddingResource, setIsAddingResource] = useState(false);
  const [addResourceError, setAddResourceError] = useState('');
  const addPendingRef = useRef(false);
  const addActiveRef = useRef(true);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editResource, setEditResource] = useState<Resource | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [displayedResources, setDisplayedResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [loadedSearchTerm, setLoadedSearchTerm] = useState<string | null>(null);
  const loadedPageRef = useRef(0);
  const generationRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(true);
  const pendingLoadRef = useRef(false);
  const loadMoreRef = useRef<() => void>(() => {});

  const updateDirectoryState = (change: Partial<ResourceDirectoryState>, push = false) => {
    // Merge into the actual URL, including immediately after typing or Back.
    const next = { ...readResourceDirectoryState(window.location.search, categories, types), ...change };
    const href = resourceDirectoryHref(next, categories, types, window.location.hash);
    if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    if (push) window.history.pushState(window.history.state, '', href);
    else window.history.replaceState(window.history.state, '', href);
    window.dispatchEvent(new Event(directoryUrlChange));
  };

  const setSearchTerm = (query: string) => updateDirectoryState({ query });
  const setSelectedCategory = (category: string) => updateDirectoryState({ category }, true);
  const setSelectedType = (type: string) => updateDirectoryState({ type }, true);
  const setSortBy = (sort: ResourceSort) => updateDirectoryState({ sort }, true);

  useEffect(() => {
    addActiveRef.current = true;
    return () => { addActiveRef.current = false; };
  }, []);

  const fetchResources = useCallback(async (pageNumber = 1, signal?: AbortSignal) => {
    const response = await axios.get('/api/resources', {
      params: { page: pageNumber, limit: ITEMS_PER_PAGE, search: searchTerm },
      signal,
    });
    return response.data as { resources: Resource[]; hasMore: boolean };
  }, [searchTerm]);

  const applyResourcePage = useCallback((pageNumber: number, data: { resources: Resource[]; hasMore: boolean }) => {
    if (pageNumber === 1) {
      setDisplayedResources(data.resources);
    } else {
      setDisplayedResources(prev => {
        const existingIds = new Set(prev.map(resource => resource.id));
        return [...prev, ...data.resources.filter(resource => !existingIds.has(resource.id))];
      });
    }
    loadedPageRef.current = pageNumber;
    setHasMore(data.hasMore);
  }, []);

  const checkAdminStatus = useCallback(async (signal: AbortSignal) => {
    if (!session?.user?.id) return false;
    try {
      const response = await axios.get(`/api/users/${session.user.id}/role`, { signal });
      return response.data.role === 'ADMIN';
    } catch (error) {
      if (!signal.aborted) console.error('Fehler beim Prüfen des Admin-Status:', error);
      return false;
    }
  }, [session]);

  useEffect(() => {
    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;
    const generation = ++generationRef.current;
    loadingRef.current = true;
    loadedPageRef.current = 0;

    void Promise.all([fetchResources(1, controller.signal), checkAdminStatus(controller.signal)])
      .then(([result, admin]) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        applyResourcePage(1, result);
        setLoadedSearchTerm(searchTerm);
        setIsAdmin(admin);
        setLoadError(false);
      })
      .catch(error => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        console.error('Fehler beim Abrufen der Ressourcen:', error);
        toast.error('Fehler beim Abrufen der Ressourcen.');
        setLoadedSearchTerm(searchTerm);
        setDisplayedResources([]);
        setHasMore(false);
        setLoadError(true);
      })
      .finally(() => {
        if (generation === generationRef.current) {
          activeRequestRef.current = null;
          loadingRef.current = false;
          setLoading(false);
          if (pendingLoadRef.current) {
            pendingLoadRef.current = false;
            loadMoreRef.current();
          }
        }
      });

    return () => {
      controller.abort();
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      generationRef.current += 1;
    };
  }, [applyResourcePage, checkAdminStatus, fetchResources, searchTerm, retryKey]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore || activeRequestRef.current) return;
    const nextPage = loadedPageRef.current + 1;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const generation = ++generationRef.current;
    loadingRef.current = true;
    setLoading(true);

    void fetchResources(nextPage, controller.signal)
      .then(result => {
        if (!controller.signal.aborted && generation === generationRef.current) {
          applyResourcePage(nextPage, result);
        }
      })
      .catch(error => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        console.error('Fehler beim Abrufen der Ressourcen:', error);
        toast.error('Fehler beim Abrufen der Ressourcen.');
      })
      .finally(() => {
        if (generation === generationRef.current) {
          activeRequestRef.current = null;
          loadingRef.current = false;
          setLoading(false);
        }
      });
  }, [applyResourcePage, fetchResources, hasMore]);

  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  const { ref } = useInView({
    threshold: 0,
    onChange: visible => {
      if (!visible) return;
      if (loadingRef.current) pendingLoadRef.current = true;
      else loadMore();
    },
  });

  const handleAddResource = async () => {
    // The ref closes the same-frame double-submit gap before React renders
    // the native disabled button. It stays pending if the dialog is closed.
    if (!session?.user?.id || !addActiveRef.current || addPendingRef.current) return;
    if (!newResource.title || !newResource.url) {
      setAddResourceError('Titel und URL sind erforderlich.');
      toast.error('Titel und URL sind erforderlich.');
      return;
    }

    addPendingRef.current = true;
    setIsAddingResource(true);
    setAddResourceError('');
    try {
      const resourceToAdd = {
        title: newResource.title,
        type: newResource.type,
        category: newResource.category,
        url: newResource.url,
        color: 'bg-blue-500', // Default value maintained for backend compatibility
      };

      const response = await axios.post('/api/resources', resourceToAdd);
      // The keyed viewer may have unmounted after a session/account change.
      // An old request must not announce success in the next account's view.
      if (!addActiveRef.current) return;
      setDisplayedResources(prev => [response.data, ...prev]);
      setNewResource({
        title: '',
        type: 'ARTICLE',
        category: 'Web Development',
        url: '',
      });
      setIsDialogOpen(false);
      toast.success('Ressource erfolgreich hinzugefügt!');
    } catch (error: any) {
      if (!addActiveRef.current) return;
      console.error('Fehler beim Hinzufügen der Ressource:', error);
      setAddResourceError('Ressource konnte nicht hinzugefügt werden. Bitte versuche es erneut.');
      toast.error('Fehler beim Hinzufügen der Ressource.');
    } finally {
      addPendingRef.current = false;
      if (addActiveRef.current) setIsAddingResource(false);
    }
  };

  const handleDeleteResource = async (id: string) => {
    try {
      const response = await axios.delete(`/api/resources/${id}`);
      if (response.status === 200) {
        setDisplayedResources(prev => prev.filter(resource => resource.id !== id));
        toast.success('Ressource wurde erfolgreich gelöscht');
      }
    } catch (error: any) {
      console.error('Fehler beim Löschen der Ressource:', error);
      toast.error(error.response?.data?.message || 'Fehler beim Löschen der Ressource');
    }
  };

  const handleEditResource = (resource: Resource) => {
    setEditResource(resource);
    setIsEditDialogOpen(true);
  };

  const handleUpdateResource = async () => {
    if (!editResource?.title || !editResource?.url) {
      toast.error('Titel und URL sind erforderlich.');
      return;
    }

    try {
      const response = await axios.put(`/api/resources/${editResource.id}`, {
        title: editResource.title,
        url: editResource.url,
      });

      setDisplayedResources(prev =>
        prev.map(resource =>
          resource.id === editResource.id ? response.data : resource
        )
      );
      setIsEditDialogOpen(false);
      toast.success('Ressource erfolgreich aktualisiert!');
    } catch (error: any) {
      console.error('Fehler beim Aktualisieren der Ressource:', error);
      toast.error('Fehler beim Aktualisieren der Ressource.');
    }
  };

  const filteredAndSortedResources = useMemo(() => {
    let filtered = loadedSearchTerm === searchTerm ? [...displayedResources] : [];

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(resource => resource.category === selectedCategory);
    }

    if (selectedType !== 'all') {
      filtered = filtered.filter(resource => resource.type === selectedType);
    }

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  }, [displayedResources, loadedSearchTerm, searchTerm, selectedCategory, selectedType, sortBy]);

  const isLoadingResults = loading || loadedSearchTerm !== searchTerm;
  const isFirstPageLoading = isLoadingResults && (loadedSearchTerm !== searchTerm || displayedResources.length === 0);
  const hasFilters = Boolean(searchTerm || selectedCategory !== 'all' || selectedType !== 'all');
  const hasDirectoryState = hasFilters || sortBy !== 'newest';
  const clearFilters = () => {
    updateDirectoryState({ query: '', category: 'all', type: 'all', sort: 'newest' }, true);
    searchRef.current?.focus();
  };
  const retryLoad = () => { setLoading(true); setLoadError(false); setRetryKey(value => value + 1); };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <h1 className="app-header-title">Ressourcen</h1>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <ToastContainer position="top-right" />
          <PageContainer>
            <HeroBanner icon={FolderOpen} title="Gutes Wissen verdient einen Platz." description="Entdecke hilfreiche Links, Werkzeuge und Materialien aus der Community." action={session ? <Button type="button" onClick={() => setIsDialogOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />Ressource hinzufügen</Button> : undefined} />
            {session && <div>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                  <DialogHeader><DialogTitle>Neue Ressource hinzufügen</DialogTitle><DialogDescription>Öffentlich, auch ohne Anmeldung. Dein Name wird angezeigt.</DialogDescription></DialogHeader>
                  <form onSubmit={event => { event.preventDefault(); void handleAddResource(); }} className="space-y-5" aria-busy={isAddingResource}>
                    <div className="space-y-2"><Label htmlFor="resource-title">Titel</Label><Input id="resource-title" value={newResource.title} onChange={event => setNewResource(previous => ({ ...previous, title: event.target.value }))} placeholder="Titel der Ressource" required disabled={isAddingResource} /></div>
                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                      <div className="min-w-0 space-y-2"><Label htmlFor="resource-type">Typ</Label><Select value={newResource.type} onValueChange={value => setNewResource(previous => ({ ...previous, type: value }))} disabled={isAddingResource}><SelectTrigger id="resource-type"><SelectValue /></SelectTrigger><SelectContent>{types.map(type => <SelectItem key={type} value={type}>{typeLabels[type as ResourceType]}</SelectItem>)}</SelectContent></Select></div>
                      <div className="min-w-0 space-y-2"><Label htmlFor="resource-category">Kategorie</Label><Select value={newResource.category} onValueChange={value => setNewResource(previous => ({ ...previous, category: value }))} disabled={isAddingResource}><SelectTrigger id="resource-category"><SelectValue /></SelectTrigger><SelectContent>{categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                    <div className="space-y-2"><Label htmlFor="resource-url">URL</Label><Input id="resource-url" type="url" value={newResource.url} onChange={event => setNewResource(previous => ({ ...previous, url: event.target.value }))} placeholder="https://…" required disabled={isAddingResource} /></div>
                    {addResourceError && <p role="alert" className="text-sm text-destructive">{addResourceError}</p>}
                    <DialogFooter><Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>{isAddingResource ? 'Schließen' : 'Abbrechen'}</Button><Button type="submit" disabled={isAddingResource}>{isAddingResource ? 'Wird hinzugefügt…' : 'Hinzufügen'}</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>}

            <section aria-label="Ressourcen filtern" className="fc-filter-bar fc-filter-surface grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_10rem_10rem] lg:items-end">
              <div className="min-w-0 sm:col-span-2 lg:col-span-1"><Label htmlFor="resource-search" className="mb-2 block">Ressourcen suchen</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input ref={searchRef} id="resource-search" type="search" maxLength={RESOURCE_QUERY_LIMIT} value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Titel, Kategorie oder Autor" className="pl-10" /></div></div>
              <div className="min-w-0"><Label htmlFor="resource-filter-category" className="mb-2 block">Kategorie</Label><Select value={selectedCategory} onValueChange={setSelectedCategory}><SelectTrigger id="resource-filter-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Kategorien</SelectItem>{categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
              <div className="min-w-0"><Label htmlFor="resource-filter-type" className="mb-2 block">Typ</Label><Select value={selectedType} onValueChange={setSelectedType}><SelectTrigger id="resource-filter-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alle Typen</SelectItem>{types.map(type => <SelectItem key={type} value={type}>{typeLabels[type as ResourceType]}</SelectItem>)}</SelectContent></Select></div>
              <div className="min-w-0"><Label htmlFor="resource-sort" className="mb-2 block">Sortieren</Label><Select value={sortBy} onValueChange={value => setSortBy(value as ResourceSort)}><SelectTrigger id="resource-sort"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Neueste</SelectItem><SelectItem value="oldest">Älteste</SelectItem><SelectItem value="title">Titel A–Z</SelectItem></SelectContent></Select></div>
            </section>

            {hasDirectoryState && <div className="pt-3"><Button type="button" variant="ghost" onClick={clearFilters} className="text-primary">Suche und Filter zurücksetzen</Button></div>}

            <section aria-labelledby="resource-results-title" className="pt-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-4"><h2 id="resource-results-title" className="text-xl font-semibold tracking-tight">Ressourcen entdecken</h2><p role="status" className="text-sm tabular-nums text-muted-foreground">{filteredAndSortedResources.length} angezeigt</p></div>
              {hasMore && (selectedCategory !== 'all' || selectedType !== 'all' || sortBy !== 'newest') && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Filter und Sortierung gelten für die bisher geladenen Ressourcen. Lade weitere Ressourcen, um zusätzliche Treffer zu sehen.</p>}

              {isFirstPageLoading ? <div className="mt-6"><PageState kind="loading" title="Ressourcen werden geladen" /></div>
                : loadError ? <div className="mt-6"><PageState kind="error" title="Ressourcen konnten nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<Button type="button" variant="outline" onClick={retryLoad}>Erneut versuchen</Button>} /></div>
                : filteredAndSortedResources.length === 0 ? <div className="mt-6"><PageState title={hasMore ? 'Noch keine passenden Ressourcen geladen' : hasFilters ? 'Keine Ressourcen gefunden' : 'Noch keine Ressourcen'} description={hasMore ? 'Lade weitere Ressourcen, um nach passenden Einträgen zu suchen.' : hasFilters ? 'Versuche es mit anderen Suchbegriffen oder Filtern.' : 'Sobald Links geteilt werden, findest du sie hier.'} action={hasMore ? <Button type="button" variant="outline" onClick={loadMore} disabled={loading}>Weitere Ressourcen laden</Button> : hasFilters ? <Button type="button" variant="outline" onClick={clearFilters}>Filter zurücksetzen</Button> : session ? <Button type="button" onClick={() => setIsDialogOpen(true)}>Erste Ressource hinzufügen</Button> : undefined} /></div>
                : <ul className="fc-entity-grid">{filteredAndSortedResources.map(resource => <ResourceItem key={resource.id} resource={resource} isAdmin={isAdmin} currentUserId={session?.user?.id} onDelete={handleDeleteResource} onEdit={handleEditResource} />)}</ul>}

              {hasMore && filteredAndSortedResources.length > 0 && <div ref={ref} className="flex justify-center py-7"><Button type="button" variant="outline" onClick={loadMore} disabled={loading}>{loading ? 'Weitere Ressourcen werden geladen…' : 'Weitere Ressourcen laden'}</Button></div>}
              {loading && !isFirstPageLoading && <p role="status" className="pb-6 text-center text-sm text-muted-foreground">Weitere Ressourcen werden geladen…</p>}
            </section>
          </PageContainer>
        </main>

        {editResource && <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Ressource bearbeiten</DialogTitle><DialogDescription>Titel und URL sind erforderlich.</DialogDescription></DialogHeader>
            <form onSubmit={event => { event.preventDefault(); void handleUpdateResource(); }} className="space-y-5">
              <div className="space-y-2"><Label htmlFor="edit-resource-title">Titel</Label><Input id="edit-resource-title" value={editResource.title} onChange={event => setEditResource(previous => previous ? { ...previous, title: event.target.value } : previous)} required /></div>
              <div className="space-y-2"><Label htmlFor="edit-resource-url">URL</Label><Input id="edit-resource-url" type="url" value={editResource.url} onChange={event => setEditResource(previous => previous ? { ...previous, url: event.target.value } : previous)} required /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>Abbrechen</Button><Button type="submit">Aktualisieren</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}
      </div>
    </AppShell>
  );
}

function ResourceItem({ resource, isAdmin, currentUserId, onDelete, onEdit }: {
  resource: Resource;
  isAdmin: boolean;
  currentUserId?: string;
  onDelete: (id: string) => void;
  onEdit: (resource: Resource) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canModify = isAdmin || resource.author.id === currentUserId;
  const safeResourceUrl = getSafeNavigationUrl(resource.url);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/resources/${resource.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Link kopiert');
    } catch {
      toast.error('Der Link konnte nicht kopiert werden.');
    }
  };

  const shareResource = (platform: 'twitter' | 'linkedin') => {
    const url = encodeURIComponent(`${window.location.origin}/resources/${resource.id}`);
    const title = encodeURIComponent(resource.title);
    const destinations = {
      twitter: `https://twitter.com/intent/tweet?text=${title}&url=${url}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    };
    window.open(destinations[platform], '_blank', 'noopener,noreferrer');
  };

  return <li className="fc-entity-card">
    <div className="flex min-w-0 items-start gap-3 sm:gap-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border bg-muted text-muted-foreground" aria-hidden="true">{getIcon(resource.type)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="font-semibold uppercase tracking-[0.08em] text-foreground">{typeLabels[resource.type]}</span><span className="min-w-0 break-words [overflow-wrap:anywhere]">{resource.category}</span><time dateTime={resource.createdAt}>{new Date(resource.createdAt).toLocaleDateString('de-DE')}</time></div>
        <h3 className="mt-2 min-w-0 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]"><Link href={`/resources/${resource.id}`} className="hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{resource.title}</Link></h3>
        <p className="mt-2 text-sm text-muted-foreground">Von {resource.author.name || resource.author.email || 'Unbekannt'}</p>
        {safeResourceUrl ? <a href={safeResourceUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Quelle öffnen <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a> : <p className="mt-4 text-sm text-muted-foreground">Keine sichere Zieladresse verfügbar.</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`Aktionen für ${resource.title}`} className="shrink-0"><MoreVertical className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void handleCopyLink()}>{copied ? <Check className="mr-2 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-2 h-4 w-4" aria-hidden="true" />}Link kopieren</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => shareResource('twitter')}>Auf X teilen</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => shareResource('linkedin')}>Auf LinkedIn teilen</DropdownMenuItem>
          {canModify && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => onEdit(resource)}><Edit className="mr-2 h-4 w-4" aria-hidden="true" />Bearbeiten</DropdownMenuItem><DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive focus:bg-destructive/10"><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Löschen</DropdownMenuItem></>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent className="w-[calc(100%_-_2rem)] rounded-[14px]"><AlertDialogHeader><AlertDialogTitle>Ressource löschen?</AlertDialogTitle><AlertDialogDescription>„{resource.title}“ wird dauerhaft aus der Ressourcenbibliothek entfernt.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => onDelete(resource.id)}>Ressource löschen</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </li>;
}

function getIcon(type: ResourceType) {
  const className = 'h-5 w-5';
  switch (type) {
    case ResourceType.ARTICLE: return <File className={className} />;
    case ResourceType.VIDEO: return <Video className={className} />;
    case ResourceType.EBOOK: return <Book className={className} />;
    case ResourceType.PODCAST: return <LinkIcon className={className} />;
    case ResourceType.COURSE: return <Book className={className} />;
    default: return <LinkIcon className={className} />;
  }
}
