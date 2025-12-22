'use client';

import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, Calendar, Edit, Trash, ArrowLeft, Tag, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { SanitizedHtml } from '@/components/SanitizedHtml';
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from 'next/image';

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

export default function ArticlePage() {
  const params = useParams();
  const id = params?.id as string;
  const [article, setArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();
  const router = useRouter();

  const fetchArticle = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/articles/${id}`);
      if (response.ok) {
        const data = await response.json();
        setArticle(data);
      } else {
        throw new Error('Artikel nicht gefunden oder Fehler beim Abrufen.');
      }
    } catch (error) {
      console.error('Error fetching article:', error);
      setError(error instanceof Error ? error.message : 'Ein unbekannter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchArticle();
    }
  }, [id, fetchArticle]);

  const handleDelete = async () => {
    if (!confirm('Bist du sicher, dass du diesen Artikel löschen möchtest?')) return;

    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/knowledgebase');
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Löschen des Artikels.');
      }
    } catch (error) {
      console.error('Error deleting article:', error);
      alert(error instanceof Error ? error.message : 'Fehler beim Löschen des Artikels.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Lade Artikel...</p>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-lg text-red-500 mb-4">{error || 'Artikel nicht gefunden.'}</p>
        <Button onClick={() => router.push('/knowledgebase')}>Zurück zur Übersicht</Button>
      </div>
    );
  }

  const isAuthor = session?.user?.id === article.author.id;

  return (
    <div className="flex flex-col lg:flex-row min-h-screen h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen">
        <header className="bg-gradient-to-b from-background via-background to-transparent z-10 sticky top-0 flex-none">
          <div className="container mx-auto px-6">
            {/* Top Navigation */}
            <div className="py-3 border-b border-border/40 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4 w-full sm:w-auto">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push('/knowledgebase')}
                        className="hover:bg-accent/50 transition-all duration-200 -ml-2"
                      >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        <span className="font-medium">Zurück</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Zurück zur Übersicht
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex items-center space-x-3">
                {isAuthor && (
                  <>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="hover:bg-accent/50 transition-all duration-200"
                            asChild
                          >
                            <Link href={`/knowledgebase/${article.id}/edit`}>
                              <Edit className="h-4 w-4 mr-2" />
                              <span className="font-medium">Bearbeiten</span>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Artikel bearbeiten
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDelete}
                            className="text-destructive hover:bg-destructive/10 transition-all duration-200"
                          >
                            <Trash className="h-4 w-4 mr-2" />
                            <span className="font-medium">Löschen</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Artikel löschen
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </>
                )}
                <div className="h-4 w-px bg-border/50 hidden sm:block" />
                <ThemeToggle />
                <UserNav />
              </div>
            </div>

            {/* Article Title Section */}
            <div className="py-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BookOpen className="h-4 w-4" />
                <span>{article.category}</span>
                <span className="text-border/60">•</span>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {new Date(article.createdAt).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </span>
                </div>
              </div>
              <div className="space-y-4">
                <h1 className="text-4xl font-bold tracking-tight text-foreground">
                  {article.title}
                </h1>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-muted/40 hover:bg-muted/60 transition-colors rounded-full pl-1 pr-3 py-1">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-foreground/80">
                      {article.author.name || article.author.email}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {article.tags.map((tag) => (
                      <Badge
                        key={tag.id}
                        variant="secondary"
                        className="text-xs bg-muted/40 hover:bg-muted/60 transition-colors"
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-border/0 via-border/40 to-border/0" />
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto py-8 px-6">
            <div className="max-w-4xl mx-auto">
              <div className="space-y-8">
                {/* Artikel Inhalt */}
                <div className="bg-card rounded-xl shadow-sm border border-border/40 overflow-hidden">
                  {article.featuredImage && (
                    <div className="relative w-full h-[400px] sm:h-[500px] overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent z-10" />
                      <Image
                        src={article.featuredImage}
                        alt={article.title}
                        fill
                        className="object-contain object-center transition-transform duration-500 group-hover:scale-105"
                        priority
                      />
                    </div>
                  )}
                  <div className="p-6 sm:p-8 sm:pt-10">
                    <SanitizedHtml
                      html={article.content}
                      className="prose prose-neutral dark:prose-invert max-w-none 
                        prose-headings:font-semibold prose-headings:tracking-tight
                        prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl
                        prose-h4:text-lg prose-h5:text-base
                        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                        prose-strong:text-foreground/90 prose-strong:font-semibold
                        prose-code:text-primary prose-code:bg-primary/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                        prose-pre:bg-muted prose-pre:border prose-pre:border-border/40
                        prose-img:rounded-lg prose-img:ring-1 prose-img:ring-border/40
                        prose-blockquote:border-l-primary/30 prose-blockquote:bg-muted/30 prose-blockquote:not-italic
                        prose-blockquote:pl-6 prose-blockquote:py-1 prose-blockquote:text-muted-foreground
                        prose-ul:list-none prose-ul:pl-0
                        prose-li:relative prose-li:pl-6
                        prose-li:before:absolute prose-li:before:left-1 prose-li:before:top-3
                        prose-li:before:h-1.5 prose-li:before:w-1.5 prose-li:before:rounded-full
                        prose-li:before:bg-primary/40
                        [&_ul_li]:mt-2 first:[&_ul_li]:mt-0
                        prose-hr:border-border/40"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}