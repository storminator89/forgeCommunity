'use client';

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Book, Plus, ChevronRight, Calendar, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'isomorphic-dompurify';

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

export default function KnowledgeBase() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const fetchArticles = async () => {
    try {
      const response = await fetch('/api/articles');

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Fetched articles data:', data);

      if (Array.isArray(data)) {
        setArticles(data);
      } else if (Array.isArray(data.articles)) {
        setArticles(data.articles);
      } else {
        throw new Error('Invalid data format: expected an array or an object with an "articles" array');
      }
    } catch (error: any) {
      console.error('Error fetching articles:', error);
      setError(error.message || 'Fehler beim Laden der Artikel.');
      setArticles([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  const categories = useMemo(() => 
    ['All', ...new Set(Array.isArray(articles) ? articles.map(article => article.category) : [])],
    [articles]
  );

  const filteredArticles = useMemo(() => 
    Array.isArray(articles)
      ? articles.filter(article =>
          (selectedCategory === 'All' || article.category === selectedCategory) &&
          (article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            article.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
            article.tags.some(tag => tag.name.toLowerCase().includes(searchTerm.toLowerCase())))
        )
      : [],
    [articles, selectedCategory, searchTerm]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Laden...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">Fehler: {error}</p>
        <Button onClick={fetchArticles} className="ml-4">Erneut versuchen</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center mb-4 sm:mb-0">
              <Book className="mr-2 h-6 w-6" />
              Wissensdatenbank
            </h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Suche..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full sm:w-64 rounded-full"
                />
              </div>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-hidden p-4 lg:p-8">
          <div className="flex justify-between items-center mb-6">
            <nav>
              <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="w-full">
                <TabsList className="overflow-x-auto w-full">
                  {categories.map((category) => (
                    <TabsTrigger key={category} value={category} className="capitalize">
                      {category}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </nav>
            <Link href="/knowledgebase/new-article">
              <Button className="ml-4">
                <Plus className="mr-2 h-4 w-4" /> Neuer Artikel
              </Button>
            </Link>
          </div>
          <ScrollArea className="h-[calc(100vh-200px)]">
            <AnimatePresence>
              <motion.div
                className="space-y-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {filteredArticles.length === 0 ? (
                  <p className="text-center text-gray-500 dark:text-gray-400">Keine Artikel gefunden.</p>
                ) : (
                  filteredArticles.map((article) => (
                    <motion.article
                      key={article.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300"
                    >
                      <h3 className="text-2xl font-bold mb-2 text-gray-800 dark:text-white">
                        <Link href={`/knowledgebase/${article.id}`}>
                          {article.title}
                        </Link>
                      </h3>
                      <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-4">
                        <User className="mr-2 h-4 w-4" />
                        <span className="mr-4">{article.author.name || article.author.email}</span>
                        <Calendar className="mr-2 h-4 w-4" />
                        <span>{new Date(article.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div 
                        className="text-gray-600 dark:text-gray-300 mb-4"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(article.content.substring(0, 200) + '...')
                        }}
                      />
                      <div className="flex flex-wrap gap-2 mb-4">
                        {article.tags.map((tag) => (
                          <Badge key={tag.id} variant="secondary">{tag.name}</Badge>
                        ))}
                      </div>
                      <Link href={`/knowledgebase/${article.id}`}>
                        <Button variant="link">
                          Weiterlesen <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </motion.article>
                  ))
                )}
              </motion.div>
            </AnimatePresence>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}