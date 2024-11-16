'use client';

import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, Calendar, Edit, Trash, ArrowLeft, Tag, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import DOMPurify from 'isomorphic-dompurify';
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

  const fetchArticle = async () => {
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
  };

  useEffect(() => {
    if (id) {
      fetchArticle();
    }
  }, [id]);

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
    <div className="flex flex-col lg:flex-row min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card shadow-sm z-10 sticky top-0 border-b">
          <div className="container mx-auto px-6 py-3 flex flex-col sm:flex-row items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/knowledgebase')}
                className="hover:bg-accent transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Zurück
              </Button>
              <div className="h-4 w-px bg-border hidden sm:block" />
              <h1 className="text-lg font-medium text-foreground hidden sm:block">
                Knowledgebase
              </h1>
            </div>
            <div className="flex items-center space-x-2">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-accent/5">
          <div className="container mx-auto py-8 px-6">
            <div className="max-w-5xl mx-auto">
              <div className="grid gap-8">
                {/* Titel und Meta-Informationen */}
                <div className="space-y-6 bg-card p-8 rounded-lg shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                    <div className="space-y-4 flex-1">
                      <h1 className="text-4xl font-bold text-foreground tracking-tight">
                        {article.title}
                      </h1>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex items-center">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div className="ml-3">
                            <p className="font-medium text-foreground">
                              {article.author.name || article.author.email}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(article.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {isAuthor && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="group"
                          asChild
                        >
                          <Link href={`/knowledgebase/${article.id}/edit`}>
                            <Edit className="h-4 w-4 mr-2 group-hover:text-primary transition-colors" />
                            Artikel bearbeiten
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDelete}
                          className="group text-destructive hover:text-destructive-foreground hover:bg-destructive"
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Löschen
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-4 border-t">
                    <Badge variant="outline" className="text-xs px-3 py-1 rounded-full">
                      <Tag className="mr-1.5 h-3 w-3" />
                      {article.category}
                    </Badge>
                    {article.tags.map((tag) => (
                      <Badge 
                        key={tag.id} 
                        variant="secondary" 
                        className="text-xs px-3 py-1 rounded-full hover:bg-secondary/80 transition-colors"
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Artikel-Bild */}
                {article.featuredImage && (
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-accent/10 shadow-sm">
                    <Image
                      src={article.featuredImage}
                      alt={article.title}
                      fill
                      className="object-cover hover:scale-105 transition-transform duration-300"
                      priority
                    />
                  </div>
                )}

                {/* Artikel-Inhalt */}
                <Card className="p-8 lg:p-10 shadow-sm">
                  <div 
                    className="prose dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-headings:font-semibold prose-a:text-primary prose-img:rounded-lg prose-pre:bg-muted"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.content) }}
                  />
                </Card>

              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}