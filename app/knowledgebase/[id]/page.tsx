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

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
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
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center mb-4 sm:mb-0">
              <BookOpen className="mr-2 h-6 w-6" />
              Artikel Details
            </h1>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Card className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <Button
                  variant="outline"
                  onClick={() => router.push('/knowledgebase')}
                  className="bg-black text-white hover:bg-gray-800"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zur Übersicht
                </Button>
                {isAuthor && (
                  <div className="flex space-x-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link href={`/knowledgebase/${article.id}/edit`}>
                            <Button variant="outline" size="icon">
                              <Edit className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Bearbeiten</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="destructive" size="icon" onClick={handleDelete}>
                            <Trash className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Löschen</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>
              <h2 className="text-3xl font-bold text-gray-800 dark:text-white mb-4">{article.title}</h2>
              <div className="flex flex-wrap items-center text-sm text-gray-500 dark:text-gray-400 mb-4">
                <User className="mr-2 h-4 w-4" />
                <span className="mr-4">{article.author.name || article.author.email}</span>
                <Calendar className="mr-2 h-4 w-4" />
                <span>{new Date(article.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center mb-6 flex-wrap">
                <Badge variant="outline" className="mr-2 mb-2">
                  <Tag className="mr-1 h-3 w-3" />
                  {article.category}
                </Badge>
                {article.tags.map((tag) => (
                  <Badge key={tag.id} variant="secondary" className="mr-2 mb-2">
                    {tag.name}
                  </Badge>
                ))}
              </div>
              <Separator className="my-6" />
            </div>
            <ScrollArea className="h-[calc(100vh-400px)] px-6">
              <div 
                className="prose dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.content) }}
              />
            </ScrollArea>
          </Card>
        </main>
      </div>
    </div>
  );
}