'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: knowledge directory · design-system: design.md · designed-as-app */

import { HeroBanner } from '@/components/discovery';
import { Library as PageBannerIcon } from 'lucide-react';
import { PageState, RetryButton } from '@/components/page-state';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, ArrowUpRight, SlidersHorizontal, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { Badge } from "@/components/ui/badge";

import Image from 'next/image';
import { sanitizeTextPreview } from '@/lib/sanitize-html';
import { KNOWLEDGE_QUERY_LIMIT, knowledgeDirectoryHref, readKnowledgeDirectoryState, validateKnowledgeDirectoryFilters, type KnowledgeDirectoryState } from './knowledgebase-directory-url';

const directoryUrlChange = 'forge-knowledge-directory-url-change';

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

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  featuredImage: string | null;
  author: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  tags: { id: string; name: string }[];
}

async function loadArticles(signal: AbortSignal): Promise<Article[]> {
  const response = await fetch('/api/articles', { signal });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return (await response.json()) as Article[];
}

export default function KnowledgeBase() {
  const urlSearch = useSyncExternalStore(subscribeDirectoryUrl, directorySearchSnapshot, serverDirectorySearchSnapshot);
  const requestedState = useMemo(() => readKnowledgeDirectoryState(urlSearch), [urlSearch]);
  const searchRef = useRef<HTMLInputElement>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void loadArticles(controller.signal)
      .then((data) => {
        if (!active) return;
        setArticles(data);
        setError(null);
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        console.error('Error fetching articles:', error);
        setError(error instanceof Error ? error.message : 'Fehler beim Laden der Artikel.');
        setArticles([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const categories = useMemo(() =>
    ['All', ...new Set(articles.map(article => article.category))],
    [articles]
  );

  const tags = useMemo(() =>
    ['All', ...new Set(articles.flatMap(article => article.tags.map(tag => tag.name)))],
    [articles]
  );

  // Keep a shared link intact while its categories/tags are still loading.
  // Unknown values become an unfiltered view only against a successful read.
  const directoryState = !isLoading && !error
    ? validateKnowledgeDirectoryFilters(requestedState, categories, tags)
    : requestedState;
  const { query: searchTerm, category: selectedCategory, tag: selectedTag } = directoryState;

  const updateDirectoryState = (change: Partial<KnowledgeDirectoryState>, push = false) => {
    // Read the actual URL, so rapid typing cannot be overwritten by an older
    // router render or a just-restored history entry.
    const next = { ...readKnowledgeDirectoryState(window.location.search), ...change };
    const checked = !isLoading && !error ? validateKnowledgeDirectoryFilters(next, categories, tags) : next;
    const href = knowledgeDirectoryHref(checked, window.location.hash);
    if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    if (push) window.history.pushState(window.history.state, '', href);
    else window.history.replaceState(window.history.state, '', href);
    window.dispatchEvent(new Event(directoryUrlChange));
  };

  const setSearchTerm = (query: string) => updateDirectoryState({ query });
  const setSelectedCategory = (category: string) => updateDirectoryState({ category }, true);
  const setSelectedTag = (tag: string) => updateDirectoryState({ tag }, true);

  const filteredArticles = useMemo(() =>
    articles.filter(article =>
      (selectedCategory === 'All' || article.category === selectedCategory) &&
      (selectedTag === 'All' || article.tags.some(tag => tag.name === selectedTag)) &&
      (article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.tags.some(tag => tag.name.toLowerCase().includes(searchTerm.toLowerCase())))
    ),
    [articles, selectedCategory, selectedTag, searchTerm]
  );

  const hasFilters = Boolean(searchTerm || selectedCategory !== 'All' || selectedTag !== 'All');
  const clearFilters = () => {
    updateDirectoryState({ query: '', category: 'All', tag: 'All' }, true);
    searchRef.current?.focus();
  };


  return (
    <AppShell data-page-family="discovery">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <h1 className="app-header-title">Wissensdatenbank</h1>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="fc-page-container mx-auto w-full max-w-[1440px]">
          <HeroBanner title="Wissen, das weiterbringt." description="Entdecke Artikel, teile Erfahrungen und finde Antworten aus der Community." icon={PageBannerIcon} action={<Button asChild><Link href="/knowledgebase/new-article"><Plus className="h-4 w-4" aria-hidden="true" />Neuer Artikel</Link></Button>} />
            <div className="fc-filter-surface flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
              <div className="min-w-0 flex-1">
                <label htmlFor="kb-search" className="mb-2 block text-sm font-medium">Artikel suchen</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input ref={searchRef} id="kb-search" type="search" maxLength={KNOWLEDGE_QUERY_LIMIT} placeholder="Titel, Inhalt oder Tag" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="pl-10" />
                </div>
              </div>

            </div>

            {hasFilters && <div aria-label="Aktive Suche und Filter" className="flex min-w-0 flex-wrap items-center gap-2 pt-3 text-sm">
              {selectedCategory !== 'All' && <span className="max-w-full break-words rounded-md bg-accent px-2 py-1 [overflow-wrap:anywhere]">Kategorie: {selectedCategory}</span>}
              {selectedTag !== 'All' && <span className="max-w-full break-words rounded-md bg-accent px-2 py-1 [overflow-wrap:anywhere]">Tag: {selectedTag}</span>}
              <Button type="button" variant="ghost" onClick={clearFilters} className="text-primary">Filter zurücksetzen</Button>
            </div>}

            <div className="grid min-w-0 gap-4 pt-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:pt-6">
              <aside aria-label="Artikelfilter" className="fc-section-card self-start">
                <h2 className="hidden text-base font-semibold tracking-tight lg:block">Filter</h2>
                <Button type="button" variant="outline" aria-expanded={filtersOpen} aria-controls="kb-filter-options" onClick={() => setFiltersOpen(!filtersOpen)} className="w-full justify-between lg:hidden">
                  <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Filter</span>
                  <ChevronDown className={'h-4 w-4 ' + (filtersOpen ? 'rotate-180' : '')} aria-hidden="true" />
                </Button>
                <div id="kb-filter-options" className={(filtersOpen ? 'block' : 'hidden') + ' border-b pb-4 lg:block lg:border-b-0 lg:pb-0'}>
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-medium text-muted-foreground">Kategorien</h3>
                    <div role="group" aria-label="Kategorie wählen" className="space-y-1">
                      {categories.map(category => (
                        <button type="button" key={category} aria-pressed={selectedCategory === category} onClick={() => setSelectedCategory(category)}
                          className={'flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ' + (selectedCategory === category ? 'bg-accent/70 font-semibold text-foreground' : 'text-muted-foreground')}>
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{category === 'All' ? 'Alle Kategorien' : category}</span>
                          <span className="tabular-nums text-xs text-muted-foreground">{category === 'All' ? articles.length : articles.filter(article => article.category === category).length}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {tags.length > 1 && <div className="mt-4 border-t pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-muted-foreground">Tags</h3>
                      {selectedTag !== 'All' && <button type="button" onClick={() => setSelectedTag('All')} className="min-h-11 text-xs font-medium text-primary hover:underline">Zurücksetzen</button>}
                    </div>
                    <div role="group" aria-label="Tag wählen" className="mt-2 flex flex-wrap gap-2">
                      {tags.slice(1).map(tag => (
                        <button type="button" key={tag} aria-pressed={selectedTag === tag} onClick={() => setSelectedTag(selectedTag === tag ? 'All' : tag)}
                          className={'inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ' + (selectedTag === tag ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}>
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{tag}</span><span className="shrink-0 tabular-nums">{articles.filter(article => article.tags.some(item => item.name === tag)).length}</span>
                        </button>
                      ))}
                    </div>
                  </div>}
                </div>
              </aside>

              <section aria-labelledby="kb-results-title" className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                  <h2 id="kb-results-title" className="text-xl font-semibold tracking-tight">Artikel</h2>
                  {!isLoading && !error && <p role="status" className="text-sm tabular-nums text-muted-foreground">{filteredArticles.length} Artikel</p>}
                </div>

                {isLoading ? (
                  <div className="mt-5"><PageState kind="loading" title="Artikel werden geladen" /></div>
                ) : error ? (
                  <div className="mt-5"><PageState kind="error" title="Artikel konnten nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<RetryButton onClick={() => window.location.reload()} />} /></div>
                ) : filteredArticles.length === 0 ? (
                  <div className="mt-5"><PageState title={hasFilters ? 'Keine Artikel gefunden' : 'Noch keine Artikel'} description={hasFilters ? 'Versuche es mit anderen Suchbegriffen oder Filtern.' : 'Sobald Artikel veröffentlicht werden, findest du sie hier.'} /></div>
                ) : (
                  <ul className="fc-entity-list">
                    {filteredArticles.map(article => (
                      <li key={article.id} className="min-w-0">
                        <Link href={'/knowledgebase/' + article.id} className={'fc-entity-card group grid min-w-0 gap-5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' + (article.featuredImage ? 'sm:grid-cols-[minmax(0,1fr)_11rem]' : '')}>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="min-w-0 max-w-full break-words font-semibold [overflow-wrap:anywhere]">{article.category}</span>
                              <time dateTime={article.createdAt}>{new Date(article.createdAt).toLocaleDateString('de-DE')}</time>
                              <span className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">{article.author.name || article.author.email}</span>
                            </div>
                            <h3 className="mt-2 min-w-0 break-words text-lg font-semibold tracking-tight group-hover:text-primary [overflow-wrap:anywhere]">{article.title}</h3>
                            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{sanitizeTextPreview(article.content, 150)}</p>
                            {article.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">
                              {article.tags.map(tag => <Badge key={tag.id} variant="secondary" className="max-w-full truncate">{tag.name}</Badge>)}
                            </div>}
                            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">Weiterlesen <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></span>
                          </div>
                          {article.featuredImage && <div className="relative -order-1 aspect-video min-w-0 overflow-hidden rounded-[10px] bg-muted sm:order-last"><Image src={article.featuredImage} alt="" fill className="object-cover" /></div>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
