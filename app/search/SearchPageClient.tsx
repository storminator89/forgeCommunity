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
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from 'next/link';

import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { sanitizeTextPreview } from '@/lib/sanitize-html';
import { getSafeNavigationUrl } from '@/lib/security';


interface SearchResult {
  id: string;
  title: string;
  description: string;
  type: 'course' | 'event' | 'member' | 'post' | 'resource';
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
  createdAt?: Date;
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

export default function SearchPageClient({
  initialQuery = '',
  initialType = 'all',
  initialPage = 1,
}: {
  initialQuery?: string;
  initialType?: string;
  initialPage?: number;
}) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState(initialType);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(initialQuery.trim()));
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(1);
  const currentSearch = useRef({
    query: initialQuery,
    type: initialType,
    page: initialPage,
  });

  useEffect(() => {
    // Next's URL updates can reach this component after a newer keystroke.
    // Only apply navigation props when they still describe the current URL.
    const params = new URLSearchParams(window.location.search);
    const requestedType = params.get('type') ?? 'all';
    const urlType = ['all', 'course', 'event', 'member', 'post', 'resource'].includes(requestedType)
      ? requestedType
      : 'all';
    const requestedPage = Number(params.get('page') ?? 1);
    const urlPage = Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 1000)
      : 1;
    if (
      (params.get('q') ?? '') !== initialQuery ||
      urlType !== initialType ||
      urlPage !== initialPage
    ) return;

    const current = currentSearch.current;
    if (current.query === initialQuery && current.type === initialType && current.page === initialPage) return;

    currentSearch.current = { query: initialQuery, type: initialType, page: initialPage };
    setSearchTerm(initialQuery);
    setActiveTab(initialType);
    setPage(initialPage);
    setResults([]);
    setTotalPages(0);
    setIsLoading(Boolean(initialQuery.trim()));
  }, [initialQuery, initialType, initialPage]);

  const updateSearchUrl = (query: string, type: string, nextPage: number) => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    if (type !== 'all') url.searchParams.set('type', type);
    else url.searchParams.delete('type');
    if (nextPage > 1) url.searchParams.set('page', String(nextPage));
    else url.searchParams.delete('page');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const updateQuery = (query: string) => {
    currentSearch.current = { query, type: activeTab, page: 1 };
    setSearchTerm(query);
    setPage(1);
    setResults([]);
    setTotalPages(0);
    setIsLoading(Boolean(query.trim()));
    updateSearchUrl(query, activeTab, 1);
  };

  const updateTab = (type: string) => {
    currentSearch.current = { query: searchTerm, type, page: 1 };
    setActiveTab(type);
    setPage(1);
    setResults([]);
    setTotalPages(0);
    setIsLoading(Boolean(searchTerm.trim()));
    updateSearchUrl(searchTerm, type, 1);
  };

  const updatePage = (nextPage: number) => {
    currentSearch.current = { query: searchTerm, type: activeTab, page: nextPage };
    setPage(nextPage);
    setResults([]);
    setIsLoading(Boolean(searchTerm.trim()));
    updateSearchUrl(searchTerm, activeTab, nextPage);
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
      setTotalPages(data.pagination.pages);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Search error:', error);
      toast({
        title: "Fehler",
        description: "Fehler bei der Suche",
        variant: "destructive",
      });
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, [searchTerm, activeTab, page, toast]);

  useEffect(() => {
    if (!searchTerm.trim()) return;

    const controller = new AbortController();
    const timer = setTimeout(() => fetchResults(controller.signal), 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, fetchResults]);

  const getResultHref = (result: SearchResult) => {
    switch (result.type) {
      case 'course':
        return `/courses/${result.id}`;
      case 'event':
        return `/events/${result.id}`;
      case 'member':
        return `/profile/${result.id}`;
      case 'post':
        return `/posts/${result.id}`;
      case 'resource':
        return getSafeNavigationUrl(result.url) ?? '/resources';
    }
  };

  const renderIcon = (type: string) => {
    switch (type) {
      case 'course': return <Book className="h-5 w-5 text-primary" />;
      case 'event': return <Calendar className="h-5 w-5 text-primary" />;
      case 'member': return <Users className="h-5 w-5 text-primary" />;
      case 'post': return <MessageSquare className="h-5 w-5 text-primary" />;
      case 'resource': return <FileText className="h-5 w-5 text-primary" />;
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
          <div className="flex space-x-4 text-sm text-muted-foreground">
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
          <div className="flex space-x-4 text-sm text-muted-foreground">
            <span className="flex items-center">
              <Users className="h-4 w-4 mr-1" />
              {result.stats!.attendees} / {result.stats!.maxAttendees || '∞'} Teilnehmer
            </span>
            {result.location && (
              <span className="flex items-center">
                <MapPin className="h-4 w-4 mr-1" />
                {result.location}
              </span>
            )}
          </div>
        );

      case 'resource':
        return (
          <div className="flex space-x-4 text-sm text-muted-foreground">
            {result.resourceType && (
              <span className="flex items-center capitalize">
                <Tag className="h-4 w-4 mr-1" />
                {result.resourceType.toLowerCase()}
              </span>
            )}
            {result.url && (
              <span className="flex items-center text-primary truncate max-w-[200px]">
                <LinkIcon className="h-4 w-4 mr-1 flex-shrink-0" />
                <span className="truncate">{result.url}</span>
              </span>
            )}
          </div>
        )

      case 'member':
        return (
          <div className="space-y-2">
            <div className="flex space-x-4 text-sm text-muted-foreground">
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
                  <div key={index} className="flex items-center space-x-2">
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
          <div className="flex space-x-4 text-sm text-muted-foreground">
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
      <Avatar className="h-10 w-10">
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
      <div className="flex flex-wrap gap-2 mt-2">
        {result.tags.map((tag, index) => (
          <Badge key={index} variant="secondary" className="flex items-center">
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground ">Suche</h1>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto space-y-6">

            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Suche nach Kursen, Events, Mitgliedern, Beiträgen oder Ressourcen"
                type="text"
                placeholder="Suche nach Kursen, Events, Mitgliedern, Beiträgen oder Ressourcen"
                value={searchTerm}
                onChange={(e) => updateQuery(e.target.value)}
                className="pl-10 pr-10 py-2 w-full rounded-full shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchTerm && (
                <Button aria-label="Suche löschen"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2"
                  onClick={() => updateQuery('')}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}
            </div>

            <Tabs value={activeTab} onValueChange={updateTab} className="w-full">
              <TabsList className="w-full justify-start mb-4 bg-card p-1 rounded-lg shadow-sm overflow-x-auto">
                <TabsTrigger value="all">Alle</TabsTrigger>
                <TabsTrigger value="course">Kurse</TabsTrigger>
                <TabsTrigger value="event">Events</TabsTrigger>
                <TabsTrigger value="member">Mitglieder</TabsTrigger>
                <TabsTrigger value="post">Beiträge</TabsTrigger>
                <TabsTrigger value="resource">Ressourcen</TabsTrigger>
              </TabsList>

              <AnimatePresence mode="wait">
                {isLoading ? (
                  <div role="status" aria-label="Suche läuft" className="flex justify-center items-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  </div>
                ) : (
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <TabsContent value={activeTab} className="mt-6">
                      {results.length === 0 ? (
                        <div className="text-center py-10">
                          <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                          <h3 className="text-lg font-medium text-foreground mb-2">
                            {searchTerm ? 'Keine Ergebnisse gefunden' : 'Geben Sie einen Suchbegriff ein'}
                          </h3>
                          <p className="text-muted-foreground">
                            {searchTerm
                              ? "Versuchen Sie es mit anderen Suchbegriffen oder wählen Sie eine andere Kategorie."
                              : "Suchen Sie nach Kursen, Events, Mitgliedern oder Beiträgen."}
                          </p>
                        </div>
                      ) : (
                        <>
                          {results.map((result) => {
                            const href = getResultHref(result);
                            const external = result.type === 'resource' && /^https?:\/\//.test(href);

                            return (
                              <motion.div
                                key={`${result.type}-${result.id}`}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                transition={{ duration: 0.2 }}
                                className="mb-4"
                              >
                                <Link
                                  href={href}
                                  target={external ? '_blank' : undefined}
                                  rel={external ? 'noopener noreferrer' : undefined}
                                  className="block bg-card p-4 rounded-xl border hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                >
                                  <div className="flex items-start space-x-4">
                                    {renderAvatar(result)}
                                    <div className="flex-grow min-w-0">
                                      <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold text-foreground truncate">
                                          {result.title}
                                        </h3>
                                        {renderIcon(result.type)}
                                      </div>

                                      {result.type === 'member' && result.role && (
                                        <div className="mt-1">
                                          <Badge variant="outline" className="text-xs">
                                            {result.role}
                                          </Badge>
                                        </div>
                                      )}

                                      <div className="text-sm text-muted-foreground mt-1">
                                        <SafeHTML html={result.description} />
                                      </div>

                                      {result.category && (
                                        <Badge variant="secondary" className="mt-2">
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
                                              className="flex items-center bg-yellow-50 dark:bg-yellow-900/20"
                                            >
                                              <Award className="h-3 w-3 mr-1 text-yellow-500" />
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

                                      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                                        <div className="flex items-center space-x-2">
                                          {result.author && (
                                            <span className="flex items-center">
                                              <User className="h-3 w-3 mr-1" />
                                              {result.author}
                                            </span>
                                          )}
                                          {result.instructor && (
                                            <span className="flex items-center">
                                              <Briefcase className="h-3 w-3 mr-1" />
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
                                          <div className="flex items-center">
                                            <Clock className="h-4 w-4 mr-1" />
                                            {result.time.start} - {result.time.end} ({result.time.timezone})
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {external && <span className="sr-only"> (öffnet in neuem Tab)</span>}
                                </Link>
                              </motion.div>
                            );
                          })}

                        {totalPages > 1 && (
                          <div className="flex justify-center space-x-2 mt-6">
                            <Button
                              variant="outline"
                              onClick={() => updatePage(Math.max(1, page - 1))}
                              disabled={page === 1}
                              className="flex items-center"
                            >
                              <span className="mr-2">←</span>
                              Vorherige
                            </Button>
                            <div className="flex items-center space-x-2">
                              {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                                .map((p, i, arr) => (
                                  <React.Fragment key={p}>
                                    {i > 0 && arr[i - 1] !== p - 1 && (
                                      <span className="text-muted-foreground">...</span>
                                    )}
                                    <Button
                                      variant={p === page ? "default" : "outline"}
                                      onClick={() => updatePage(p)}
                                      aria-current={p === page ? 'page' : undefined}
                                      aria-label={`Seite ${p}`}
                                      className="w-10 h-10"
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
                          </div>
                        )}
                      </>
                    )}
                  </TabsContent>
                </motion.div>
                )}
              </AnimatePresence>
            </Tabs>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
