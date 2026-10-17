"use client";

import { AppShell, AppHeader } from '@/components/app-shell';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Book,
  Calendar,
  Users,
  MessageSquare,
  X,
  Loader2,
  ThumbsUp,
  MessageCircle,
  User,
  MapPin,
  Award,
  Briefcase,
  Clock,
  DollarSign,
  Tag,
  FileText,
  Link as LinkIcon
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { PageState } from '@/components/page-state';

import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { sanitizeTextPreview } from '@/lib/sanitize-html';
import { getSafeNavigationUrl } from '@/lib/security';


interface SearchResult {
  id: string;
  title: string;
  description: string;
  type: 'course' | 'event' | 'member' | 'post' | 'resource' | 'article' | 'project' | 'skill';
  author?: string;
  authorImage?: string;
  instructor?: string;
  instructorImage?: string;
  category?: string;
  date?: Date;
  location?: string;
  image?: string;
  price?: number;
  currency?: string;
  url?: string;
  resourceType?: string;
  stats?: {
    attendees?: number;
    maxAttendees?: number;
    enrollments?: number;
    maxStudents?: number;
    comments?: number;
    likes?: number;
    followers?: number;
    following?: number;
    posts?: number;
    courses?: number;
    projects?: number;
    endorsements?: number;
  };
  time?: {
    start: string;
    end: string;
    timezone: string;
  };
  role?: string;
  createdAt?: Date | null;
  tags?: string[];
  skills?: Array<{
    name: string;
    level: number;
    endorsements: number;
  }>;
  badges?: Array<{
    name: string;
    awardedAt: Date;
  }>;
  lastActive?: Date;
}

interface SearchResponse {
  results: SearchResult[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

const SafeHTML = ({ html }: { html: string }) => {
  return <span className="inline">{sanitizeTextPreview(html, 240)}</span>;
};

const SEARCH_TYPES = ['all', 'course', 'event', 'member', 'post', 'resource', 'article', 'project', 'skill'];
const RESULT_TYPE_LABELS: Record<SearchResult['type'], string> = {
  course: 'Kurs',
  event: 'Event',
  member: 'Mitglied',
  post: 'Beitrag',
  resource: 'Ressource',
  article: 'Artikel',
  project: 'Projekt',
  skill: 'Fähigkeit',
};

function readSearchUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedType = params.get('type') ?? 'all';
  const requestedPage = Number(params.get('page') ?? 1);
  return {
    query: params.get('q') ?? '',
    type: SEARCH_TYPES.includes(requestedType) ? requestedType : 'all',
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 1000)
      : 1,
  };
}

interface SearchPageProps {
  initialQuery?: string;
  initialType?: string;
  initialPage?: number;
}

export default function SearchPageClient(props: SearchPageProps) {
  const { data: session, status } = useSession();
  const viewerId = status === 'authenticated' ? session?.user?.id ?? null : null;
  // Clear all prior-account results immediately, including a direct switch
  // between signed-in accounts without waiting for a route change.
  return <SearchPageForViewer key={viewerId ?? status} {...props} viewerId={viewerId} sessionLoading={status === 'loading'} />;
}

function SearchPageForViewer({
  initialQuery = '',
  initialType = 'all',
  initialPage = 1,
  viewerId,
  sessionLoading,
}: SearchPageProps & { viewerId: string | null; sessionLoading: boolean }) {
  const { toast } = useToast();
  // A new account starts with the shareable current URL, never old result state
  // or delayed initial props from the previous account's latest keystroke.
  const initial = typeof window === 'undefined' ? { query: initialQuery, type: initialType, page: initialPage } : readSearchUrl();
  const [searchTerm, setSearchTerm] = useState(initial.query);
  const [activeTab, setActiveTab] = useState(initial.type);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(initial.query.trim()));
  const [hasError, setHasError] = useState(false);
  const [page, setPage] = useState(initial.page);
  const [totalResults, setTotalResults] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [retryToken, setRetryToken] = useState(0);
  const tabListRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const currentSearch = useRef({
    query: initial.query,
    type: initial.type,
    page: initial.page,
  });

  const applySearchState = useCallback((next: { query: string; type: string; page: number }) => {
    const current = currentSearch.current;
    if (current.query === next.query && current.type === next.type && current.page === next.page) return;

    currentSearch.current = next;
    setSearchTerm(next.query);
    setActiveTab(next.type);
    setPage(next.page);
    setResults([]);
    setHasError(false);
    setTotalResults(0);
    setTotalPages(0);
    setIsLoading(Boolean(next.query.trim()));
  }, [setSearchTerm, setActiveTab, setPage, setResults, setHasError, setTotalResults, setTotalPages, setIsLoading]);

  useEffect(() => {
    // Next's URL updates can reach this component after a newer keystroke.
    // Only apply navigation props when they still describe the current URL.
    const url = readSearchUrl();
    if (
      url.query !== initialQuery ||
      url.type !== initialType ||
      url.page !== initialPage
    ) return;

    applySearchState({ query: initialQuery, type: initialType, page: initialPage });
  }, [initialQuery, initialType, initialPage, applySearchState]);

  useEffect(() => {
    const restoreFromHistory = () => applySearchState(readSearchUrl());
    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, [applySearchState]);

  useEffect(() => {
    tabListRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  const updateSearchUrl = (query: string, type: string, nextPage: number, push = false) => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    if (type !== 'all') url.searchParams.set('type', type);
    else url.searchParams.delete('type');
    if (nextPage > 1) url.searchParams.set('page', String(nextPage));
    else url.searchParams.delete('page');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (nextUrl === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    if (push) window.history.pushState(window.history.state, '', nextUrl);
    else window.history.replaceState(window.history.state, '', nextUrl);
  };

  const updateQuery = (query: string) => {
    currentSearch.current = { query, type: activeTab, page: 1 };
    setSearchTerm(query);
    setPage(1);
    setResults([]);
    setHasError(false);
    setTotalResults(0);
    setTotalPages(0);
    setIsLoading(Boolean(query.trim()));
    updateSearchUrl(query, activeTab, 1);
  };

  const updateTab = (type: string) => {
    currentSearch.current = { query: searchTerm, type, page: 1 };
    setActiveTab(type);
    setPage(1);
    setResults([]);
    setHasError(false);
    setTotalResults(0);
    setTotalPages(0);
    setIsLoading(Boolean(searchTerm.trim()));
    updateSearchUrl(searchTerm, type, 1, true);
  };

  const updatePage = (nextPage: number) => {
    currentSearch.current = { query: searchTerm, type: activeTab, page: nextPage };
    setPage(nextPage);
    setResults([]);
    setHasError(false);
    setTotalResults(0);
    setIsLoading(Boolean(searchTerm.trim()));
    updateSearchUrl(searchTerm, activeTab, nextPage, true);
  };

  const fetchResults = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/search?query=${encodeURIComponent(searchTerm)}&type=${activeTab}&page=${page}&limit=10`,
        {
          credentials: 'include',
          signal,
        }
      );

      if (!response.ok) {
        throw new Error('Fehler bei der Suche');
      }

      const data: SearchResponse = await response.json();
      if (signal.aborted) return;
      setResults(data.results);
      setHasError(false);
      setTotalResults(data.pagination.total);
      setTotalPages(data.pagination.pages);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Search error:', error);
      setHasError(true);
      toast({
        title: "Fehler",
        description: "Fehler bei der Suche",
        variant: "destructive",
      });
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, [searchTerm, activeTab, page, toast, setResults, setHasError, setTotalResults, setTotalPages, setIsLoading]);

  const retrySearch = () => {
    setRetryToken((token) => token + 1);
  };

  useEffect(() => {
    if (!viewerId || !searchTerm.trim()) return;

    const controller = new AbortController();
    const timer = setTimeout(() => fetchResults(controller.signal), 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, fetchResults, retryToken, viewerId]);

  const getResultHref = (result: SearchResult) => {
    switch (result.type) {
      case 'course':
        return `/courses/${result.id}`;
      case 'event':
        return `/events#event-${encodeURIComponent(result.id)}`;
      case 'member':
        return `/profile/${result.id}`;
      case 'post':
        return `/community#post-${encodeURIComponent(result.id)}`;
      case 'resource':
        return getSafeNavigationUrl(result.url) ?? '/resources';
      case 'article':
        return `/knowledgebase/${encodeURIComponent(result.id)}`;
      case 'project':
        return `/projects/${encodeURIComponent(result.id)}`;
      case 'skill':
        return `/skills?query=${encodeURIComponent(result.title)}`;
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'course': return <Book aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      case 'event': return <Calendar aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      case 'member': return <Users aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      case 'post': return <MessageSquare aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      case 'resource': return <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      case 'article': return <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      case 'project': return <Briefcase aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      case 'skill': return <Tag aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />;
      default: return null;
    }
  };

  const getTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 60) return `vor ${minutes} Minuten`;
    if (hours < 24) return `vor ${hours} Stunden`;
    if (days === 1) return 'gestern';
    return `vor ${days} Tagen`;
  };

  const renderStats = (result: SearchResult) => {
    if (!result.stats && result.type !== 'resource') return null;

    switch (result.type) {
      case 'course':
        return (
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center">
              <Users className="h-4 w-4 mr-1" />
              {result.stats!.enrollments} / {result.stats!.maxStudents || '∞'} Teilnehmer
            </span>
            {result.price !== undefined && (
              <span className="flex items-center">
                <DollarSign className="h-4 w-4 mr-1" />
                {result.price} {result.currency}
              </span>
            )}
          </div>
        );

      case 'event':
        return (
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center">
              <Users className="h-4 w-4 mr-1" />
              {result.stats!.attendees} / {result.stats!.maxAttendees || '∞'} Teilnehmer
            </span>
            {result.location && (
              <span className="flex min-w-0 items-center [overflow-wrap:anywhere]">
                <MapPin className="mr-1 h-4 w-4 shrink-0" />
                {result.location}
              </span>
            )}
          </div>
        );

      case 'resource':
        return (
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {result.resourceType && (
              <span className="flex items-center capitalize">
                <Tag className="h-4 w-4 mr-1" />
                {result.resourceType.toLowerCase()}
              </span>
            )}
            {result.url && (
              <span className="flex min-w-0 max-w-[200px] items-center text-muted-foreground">
                <LinkIcon className="h-4 w-4 mr-1 flex-shrink-0" />
                <span className="truncate">{result.url}</span>
              </span>
            )}
          </div>
        )

      case 'member':
        return (
          <div className="space-y-2">
            <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center">
                <Users className="h-4 w-4 mr-1" />
                {result.stats!.followers} Follower
              </span>
              <span className="flex items-center">
                <MessageSquare className="h-4 w-4 mr-1" />
                {result.stats!.posts} Beiträge
              </span>
              <span className="flex items-center">
                <Book className="h-4 w-4 mr-1" />
                {result.stats!.courses} Kurse
              </span>
            </div>
            {result.skills && result.skills.length > 0 && (
              <div className="space-y-1">
                {result.skills.slice(0, 3).map((skill, index) => (
                  <div key={index} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm">{skill.name}</span>
                    <Progress value={skill.level} className="h-2 w-24" />
                    <span className="text-xs text-muted-foreground">
                      {skill.endorsements} Endorsements
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'post':
        return (
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center">
              <ThumbsUp className="h-4 w-4 mr-1" />
              {result.stats!.likes}
            </span>
            <span className="flex items-center">
              <MessageCircle className="h-4 w-4 mr-1" />
              {result.stats!.comments}
            </span>
            {result.createdAt && (
              <span className="flex items-center">
                <Clock className="h-4 w-4 mr-1" />
                {getTimeAgo(result.createdAt)}
              </span>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const renderAvatar = (result: SearchResult) => {
    const image = result.authorImage || result.instructorImage || result.image;
    const name = result.author || result.instructor || result.title;

    return (
      <Avatar aria-hidden="true" className="h-10 w-10 shrink-0">
        <AvatarImage src={image || ''} alt={name} />
        <AvatarFallback>
          {name?.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  };

  const renderTags = (result: SearchResult) => {
    if (!result.tags || result.tags.length === 0) return null;

    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {result.tags.map((tag, index) => (
          <Badge key={index} variant="secondary" className="min-w-0 max-w-full [overflow-wrap:anywhere]">
            <Tag className="h-3 w-3 mr-1" />
            {tag}
          </Badge>
        ))}
      </div>
    );
  };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <h1 className="app-header-title text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight text-foreground">Suche</h1>
            <div className="app-header-actions">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-4xl space-y-6">

            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchInputRef} aria-label="Suche nach Kursen, Events, Mitgliedern, Beiträgen, Ressourcen, Artikeln, Projekten oder Fähigkeiten"
                role="searchbox"
                type="text"
                placeholder="Kurse, Wissen, Projekte und mehr suchen"
                value={searchTerm}
                onChange={(e) => updateQuery(e.target.value)}
                className="w-full rounded-[10px] pl-10 pr-14"
              />
              {searchTerm && (
                <Button aria-label="Suche löschen"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-1/2 -translate-y-1/2"
                  onClick={() => { updateQuery(''); searchInputRef.current?.focus(); }}
                >
                  <X aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}
            </div>

            <Tabs value={activeTab} onValueChange={updateTab} className="w-full">
              <TabsList ref={tabListRef} aria-label="Suchkategorie" aria-describedby="search-tabs-hint" className="h-auto min-h-12 w-full justify-start gap-1 overflow-x-auto rounded-[10px] bg-muted p-1">
                <TabsTrigger className="min-h-11" value="all">Alle</TabsTrigger>
                <TabsTrigger className="min-h-11" value="course">Kurse</TabsTrigger>
                <TabsTrigger className="min-h-11" value="event">Events</TabsTrigger>
                <TabsTrigger className="min-h-11" value="member">Mitglieder</TabsTrigger>
                <TabsTrigger className="min-h-11" value="post">Beiträge</TabsTrigger>
                <TabsTrigger className="min-h-11" value="article">Artikel</TabsTrigger>
                <TabsTrigger className="min-h-11" value="project">Projekte</TabsTrigger>
                <TabsTrigger className="min-h-11" value="resource">Ressourcen</TabsTrigger>
                <TabsTrigger className="min-h-11" value="skill">Fähigkeiten</TabsTrigger>
              </TabsList>
              <p id="search-tabs-hint" className="mt-2 text-xs text-muted-foreground sm:sr-only">Weitere Kategorien: wischen oder Pfeiltasten.</p>

              <TabsContent value={activeTab} className="mt-6">
                {sessionLoading ? (
                  <PageState kind="loading" title="Anmeldung wird geprüft" />
                ) : !viewerId ? (
                  <PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um die Suche zu verwenden." />
                ) : isLoading ? (
                  <div role="status" className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
                    <Loader2 aria-hidden="true" className="h-7 w-7 animate-spin text-primary motion-reduce:animate-none" />
                    <span>Suche läuft …</span>
                  </div>
                ) : hasError ? (
                  <div role="alert" className="border-t border-border py-10 text-center">
                    <h2 className="text-lg font-semibold text-foreground">Suche fehlgeschlagen</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Die Ergebnisse konnten nicht geladen werden.</p>
                    <Button variant="outline" onClick={retrySearch} className="mt-4">Erneut versuchen</Button>
                  </div>
                ) : results.length === 0 ? (
                  <div role="status" className="border-t border-border py-10 text-center">
                    <Search aria-hidden="true" className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                    <h2 className="mb-2 text-lg font-semibold text-foreground">
                      {!searchTerm.trim() ? 'Geben Sie einen Suchbegriff ein' : searchTerm.trim().length < 2 ? 'Mindestens zwei Zeichen eingeben' : 'Keine Ergebnisse gefunden'}
                    </h2>
                    {searchTerm.trim().length >= 2 && <p className="text-sm text-muted-foreground">Versuchen Sie es mit anderen Suchbegriffen oder wählen Sie eine andere Kategorie.</p>}
                  </div>
                ) : (
                        <>
                          <h2 className="mb-2 text-lg font-semibold text-foreground">Ergebnisse <span className="ml-1 text-sm font-normal text-muted-foreground">({(activeTab === 'all' ? results.length : totalResults).toLocaleString('de-DE')})</span></h2>
                          {activeTab === 'all' && <p className="mb-4 text-sm text-muted-foreground">Bis zu fünf Treffer je Kategorie. Für weitere Ergebnisse eine Kategorie wählen.</p>}
                          <ol className="divide-y divide-border border-y border-border">
                          {results.map((result) => {
                            const href = getResultHref(result);
                            const external = result.type === 'resource' && /^https?:\/\//.test(href);

                            return (
                              <li
                                key={`${result.type}-${result.id}`}
                              >
                                <Link
                                  href={href}
                                  target={external ? '_blank' : undefined}
                                  rel={external ? 'noopener noreferrer' : undefined}
                                  className="-mx-2 block rounded-lg px-2 py-5 transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                >
                                  <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                                    {renderAvatar(result)}
                                    <div className="min-w-0 flex-grow">
                                      <div className="flex min-w-0 items-start justify-between gap-2">
                                        <h3 className="min-w-0 text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
                                          {result.title}
                                        </h3>
                                        {activeTab === 'all' && <Badge variant="outline" className="shrink-0">{RESULT_TYPE_LABELS[result.type]}</Badge>}
                                        {renderIcon(result.type)}
                                      </div>

                                      {result.type === 'member' && result.role && (
                                        <div className="mt-1">
                                          <Badge variant="outline" className="max-w-full text-xs [overflow-wrap:anywhere]">
                                            {result.role}
                                          </Badge>
                                        </div>
                                      )}

                                      <div className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                                        <SafeHTML html={result.description} />
                                      </div>

                                      {result.category && (
                                        <Badge variant="secondary" className="mt-2 max-w-full [overflow-wrap:anywhere]">
                                          {result.category}
                                        </Badge>
                                      )}

                                      {renderStats(result)}
                                      {renderTags(result)}

                                      {result.type === 'member' && result.badges && result.badges.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-2">
                                          {result.badges.slice(0, 3).map((badge, index) => (
                                            <Badge
                                              key={index}
                                              variant="outline"
                                              className="max-w-full bg-muted [overflow-wrap:anywhere]"
                                            >
                                              <Award aria-hidden="true" className="mr-1 h-3 w-3 text-muted-foreground" />
                                              {badge.name}
                                            </Badge>
                                          ))}
                                          {result.badges.length > 3 && (
                                            <Badge variant="outline">
                                              +{result.badges.length - 3} weitere
                                            </Badge>
                                          )}
                                        </div>
                                      )}

                                      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                          {result.author && (
                                            <span className="flex min-w-0 items-center [overflow-wrap:anywhere]">
                                              <User aria-hidden="true" className="mr-1 h-3 w-3 shrink-0" />
                                              {result.author}
                                            </span>
                                          )}
                                          {result.instructor && (
                                            <span className="flex min-w-0 items-center [overflow-wrap:anywhere]">
                                              <Briefcase aria-hidden="true" className="mr-1 h-3 w-3 shrink-0" />
                                              {result.instructor}
                                            </span>
                                          )}
                                        </div>
                                        {result.createdAt && (
                                          <span className="flex items-center">
                                            <Clock className="h-3 w-3 mr-1" />
                                            {getTimeAgo(result.createdAt)}
                                          </span>
                                        )}
                                      </div>

                                      {result.time && (
                                        <div className="mt-2 text-sm text-muted-foreground">
                                          <div className="flex min-w-0 items-center [overflow-wrap:anywhere]">
                                            <Clock className="h-4 w-4 mr-1" />
                                            {result.time.start} - {result.time.end} ({result.time.timezone})
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {external && <span className="sr-only"> (öffnet in neuem Tab)</span>}
                                </Link>
                              </li>
                            );
                          })}
                          </ol>

                        {totalPages > 1 && (
                          <nav aria-label="Suchergebnisseiten" className="mt-6 flex flex-wrap items-center justify-center gap-2">
                            <Button
                              variant="outline"
                              onClick={() => updatePage(Math.max(1, page - 1))}
                              disabled={page === 1}
                              className="flex items-center"
                            >
                              <span className="mr-2">←</span>
                              Vorherige
                            </Button>
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                                .map((p, i, arr) => (
                                  <React.Fragment key={p}>
                                    {i > 0 && arr[i - 1] !== p - 1 && (
                                      <span aria-hidden="true" className="text-muted-foreground">…</span>
                                    )}
                                    <Button
                                      variant={p === page ? "default" : "outline"}
                                      onClick={() => updatePage(p)}
                                      aria-current={p === page ? 'page' : undefined}
                                      aria-label={`Seite ${p}`}
                                      className="h-11 min-w-11"
                                    >
                                      {p}
                                    </Button>
                                  </React.Fragment>
                                ))}
                            </div>
                            <Button
                              variant="outline"
                              onClick={() => updatePage(Math.min(totalPages, page + 1))}
                              disabled={page === totalPages}
                              className="flex items-center"
                            >
                              Nächste
                              <span className="ml-2">→</span>
                            </Button>
                          </nav>
                        )}
                      </>
                    )}
                  </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
