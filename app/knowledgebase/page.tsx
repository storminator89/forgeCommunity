'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: knowledge directory · design-system: design.md · designed-as-app */

import { PageState, RetryButton } from '@/components/page-state';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { Badge } from "@/components/ui/badge";

import Image from 'next/image';
import { sanitizeTextPreview } from '@/lib/sanitize-html';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTag, setSelectedTag] = useState('All');
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const clearFilters = () => { setSearchTerm(''); setSelectedCategory('All'); setSelectedTag('All'); };


  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h1 className="min-w-0 truncate">Wissensdatenbank</h1>
            <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <div className="flex flex-wrap items-end justify-between gap-5 border-b pb-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Wissen / Entdecken</p>
                <p className="mt-2 max-w-[55ch] text-base leading-relaxed text-muted-foreground">Entdecke Anleitungen und Antworten aus der Community.</p>
              </div>
              <Button asChild><Link href="/knowledgebase/new-article"><Plus className="h-4 w-4" aria-hidden="true" />Neuer Artikel</Link></Button>
            </div>

            <div className="grid min-w-0 gap-8 pt-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
              <aside aria-labelledby="kb-filter-title" className="min-w-0 border-b pb-7 lg:border-b-0 lg:border-r lg:pr-8">
                <h2 id="kb-filter-title" className="text-base font-semibold tracking-tight">Filter</h2>
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Kategorien</h3>
                  <div role="group" aria-label="Kategorie wählen" className="flex max-w-full gap-1 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">
                    {categories.map(category => (
                      <button type="button" key={category} aria-pressed={selectedCategory === category} onClick={() => setSelectedCategory(category)}
                        className={'flex min-h-11 shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-[10px] px-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:min-w-0 lg:whitespace-normal ' + (selectedCategory === category ? 'bg-accent/70 font-semibold text-foreground' : 'text-muted-foreground')}>
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{category === 'All' ? 'Alle Kategorien' : category}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">{category === 'All' ? articles.length : articles.filter(article => article.category === category).length}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 border-t pt-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Tags</h3>
                    {selectedTag !== 'All' && <button type="button" onClick={() => setSelectedTag('All')} className="min-h-11 text-xs font-medium text-primary hover:underline">Zurücksetzen</button>}
                  </div>
                  <div role="group" aria-label="Tag wählen" className="mt-2 flex flex-wrap gap-2">
                    {tags.slice(1).map(tag => (
                      <button type="button" key={tag} aria-pressed={selectedTag === tag} onClick={() => setSelectedTag(selectedTag === tag ? 'All' : tag)}
                        className={'inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' + (selectedTag === tag ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}>
                        <span className="truncate">{tag}</span><span className="tabular-nums">{articles.filter(article => article.tags.some(item => item.name === tag)).length}</span>
                      </button>
                    ))}
                    {tags.length === 1 && <p className="text-sm text-muted-foreground">Noch keine Tags.</p>}
                  </div>
                </div>
              </aside>

              <section aria-labelledby="kb-results-title" className="min-w-0">
                <label htmlFor="kb-search" className="mb-2 block text-sm font-medium">Artikel suchen</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="kb-search" type="search" placeholder="Titel, Inhalt oder Tag" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="pl-10" />
                </div>

                <div className="mt-9 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
                  <h2 id="kb-results-title" className="text-xl font-semibold tracking-tight">Artikel entdecken</h2>
                  <p role="status" className="text-sm tabular-nums text-muted-foreground">{filteredArticles.length} Artikel</p>
                </div>

                {isLoading ? (
                  <div className="mt-5"><PageState kind="loading" title="Artikel werden geladen" /></div>
                ) : error ? (
                  <div className="mt-5"><PageState kind="error" title="Artikel konnten nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<RetryButton onClick={() => window.location.reload()} />} /></div>
                ) : filteredArticles.length === 0 ? (
                  <div className="mt-5"><PageState title={hasFilters ? 'Keine Artikel gefunden' : 'Noch keine Artikel'} description={hasFilters ? 'Versuche es mit anderen Suchbegriffen oder Filtern.' : 'Sobald Artikel veröffentlicht werden, findest du sie hier.'} action={hasFilters ? <Button type="button" variant="outline" onClick={clearFilters}>Filter zurücksetzen</Button> : undefined} /></div>
                ) : (
                  <ul className="divide-y">
                    {filteredArticles.map(article => (
                      <li key={article.id} className="min-w-0">
                        <Link href={'/knowledgebase/' + article.id} className={'group grid min-w-0 gap-5 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' + (article.featuredImage ? 'sm:grid-cols-[minmax(0,1fr)_11rem]' : '')}>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="font-semibold uppercase tracking-[0.08em]">{article.category}</span>
                              <time dateTime={article.createdAt}>{new Date(article.createdAt).toLocaleDateString('de-DE')}</time>
                              <span>{article.author.name || article.author.email}</span>
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
