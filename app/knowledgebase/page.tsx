'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Book, Plus, ChevronRight, Calendar, User, Tag, Filter } from 'lucide-react';
import Link from 'next/link';
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'isomorphic-dompurify';
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

export default function KnowledgeBase() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTag, setSelectedTag] = useState('All');
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const fetchArticles = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/articles');

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Fetched articles data:', data);

      setArticles(data);
      setError(null);
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Laden...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen h-screen bg-gradient-to-br from-background to-background/80">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-card shadow-sm z-10 sticky top-0 border-b backdrop-blur-sm">
          <div className="container mx-auto px-6 py-5">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
              <div className="flex items-center">
                <div className="bg-primary/10 p-2.5 rounded-xl mr-4">
                  <Book className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-foreground tracking-tight">Wissensdatenbank</h1>
                  <p className="text-sm text-muted-foreground mt-0.5">Entdecke und teile Wissen</p>
                </div>
              </div>
              <div className="flex items-center gap-4 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-initial">
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                    <Input
                      type="text"
                      placeholder="Artikel durchsuchen..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 pr-4 w-full sm:w-[300px] bg-background/50 focus:bg-background transition-all border-muted-foreground/20 focus:border-primary rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ThemeToggle />
                  <UserNav />
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-accent/5">
          <div className="container mx-auto py-8 px-6">
            <div className="max-w-7xl mx-auto space-y-8">
              {/* Filter und Aktionen */}
              <div className="grid lg:grid-cols-[300px,1fr] gap-6">
                {/* Linke Seite: Filter */}
                <div className="space-y-6">
                  {/* Aktionen */}
                  <div className="bg-card rounded-xl shadow-sm overflow-hidden border border-border/40">
                    <div className="p-4">
                      <Link href="/knowledgebase/new-article">
                        <Button className="w-full shadow-sm hover:shadow group bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-all duration-200">
                          <Plus className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform duration-200" />
                          Neuer Artikel
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Filter */}
                  <div className="bg-card rounded-xl shadow-sm overflow-hidden border border-border/40">
                    <div className="p-4 border-b border-border/40">
                      <h2 className="font-semibold text-lg flex items-center">
                        <Filter className="mr-2 h-5 w-5 text-primary" />
                        Filter
                      </h2>
                    </div>
                    
                    {/* Kategorien */}
                    <div className="p-4 border-b border-border/40">
                      <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center">
                        <Book className="mr-2 h-4 w-4" />
                        Kategorien
                      </h3>
                      <div className="space-y-1">
                        {categories.map((category) => (
                          <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                              selectedCategory === category 
                                ? 'bg-primary text-primary-foreground' 
                                : 'hover:bg-muted/50 text-foreground'
                            }`}
                          >
                            <span className="flex items-center">
                              {category === 'All' ? 'Alle Kategorien' : category}
                            </span>
                            <Badge 
                              variant={selectedCategory === category ? "outline" : "secondary"}
                              className={`ml-auto ${selectedCategory === category ? 'border-primary-foreground/30 text-primary-foreground' : ''}`}
                            >
                              {category === 'All' 
                                ? articles.length
                                : articles.filter(a => a.category === category).length
                              }
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-muted-foreground flex items-center">
                          <Tag className="mr-2 h-4 w-4" />
                          Tags
                        </h3>
                        {selectedTag !== 'All' && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => setSelectedTag('All')}
                            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Zurücksetzen
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(new Set(articles.flatMap(article => article.tags.map(tag => tag.name)))).map((tag) => (
                          <Badge 
                            key={tag}
                            variant={selectedTag === tag ? "default" : "secondary"}
                            className={`cursor-pointer transition-all duration-200 text-xs ${
                              selectedTag === tag 
                                ? 'bg-primary hover:bg-primary/90 text-primary-foreground' 
                                : 'hover:bg-secondary/80'
                            }`}
                            onClick={() => setSelectedTag(tag === selectedTag ? 'All' : tag)}
                          >
                            {tag}
                            <span className="ml-1.5 px-1 py-0.5 rounded-sm bg-background/10 text-[10px]">
                              {articles.filter(article => 
                                article.tags.some(t => t.name === tag)
                              ).length}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rechte Seite: Artikel Liste */}
                <div className="space-y-6">
                  {/* Suchleiste */}
                  <div className="bg-card rounded-xl shadow-sm overflow-hidden border border-border/40">
                    <div className="p-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Artikel durchsuchen..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10 pr-4 w-full bg-background/50 focus:bg-background transition-all border-muted-foreground/20 focus:border-primary rounded-lg"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Artikel Grid */}
                  <div className="grid gap-6">
                    <AnimatePresence>
                      <motion.div
                        className="grid gap-8"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        {filteredArticles.length === 0 ? (
                          <div className="bg-card p-12 rounded-xl shadow-sm text-center border border-border/40">
                            <div className="flex flex-col items-center gap-5">
                              <div className="bg-primary/10 p-5 rounded-full">
                                <Search className="h-8 w-8 text-primary" />
                              </div>
                              <div>
                                <h3 className="text-lg font-medium mb-2">Keine Artikel gefunden</h3>
                                <p className="text-muted-foreground">
                                  Versuche es mit anderen Suchbegriffen oder Filtern
                                </p>
                              </div>
                              {(selectedCategory !== 'All' || selectedTag !== 'All') && (
                                <Button 
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedCategory('All');
                                    setSelectedTag('All');
                                  }}
                                  className="mt-2"
                                >
                                  Filter zurücksetzen
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : (
                          filteredArticles.map((article) => (
                            <motion.article
                              key={article.id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -20 }}
                              transition={{ duration: 0.3 }}
                              className="group bg-card rounded-xl shadow-sm hover:shadow-md transition-all duration-300 border border-border/40 hover:border-border"
                            >
                              <Link href={`/knowledgebase/${article.id}`} className="block p-8">
                                <div className="flex flex-col md:flex-row gap-8">
                                  {article.featuredImage && (
                                    <div className="md:w-1/3">
                                      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted">
                                        <Image
                                          src={article.featuredImage}
                                          alt={article.title}
                                          fill
                                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-background/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                      </div>
                                    </div>
                                  )}
                                  <div className={`${article.featuredImage ? 'md:w-2/3' : 'w-full'}`}>
                                    <div className="flex items-center gap-2 mb-3">
                                      <Badge variant="outline" className="text-xs px-2 py-0.5">
                                        {article.category}
                                      </Badge>
                                      <span className="text-sm text-muted-foreground">
                                        {new Date(article.createdAt).toLocaleDateString()}
                                      </span>
                                    </div>
                                    
                                    <h3 className="text-xl font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                                      {article.title}
                                    </h3>
                                    
                                    <div className="flex items-center gap-2 mb-4">
                                      <div className="flex items-center">
                                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                                          <User className="h-3 w-3 text-primary" />
                                        </div>
                                        <span className="ml-2 text-sm text-muted-foreground">
                                          {article.author.name || article.author.email}
                                        </span>
                                      </div>
                                    </div>

                                    <div 
                                      className="text-muted-foreground mb-4 line-clamp-2"
                                      dangerouslySetInnerHTML={{
                                        __html: DOMPurify.sanitize(article.content.substring(0, 150) + '...')
                                      }}
                                    />

                                    <div className="flex flex-wrap gap-2 mb-4">
                                      {article.tags.map((tag) => (
                                        <Badge 
                                          key={tag.id} 
                                          variant="secondary" 
                                          className="text-xs px-2 py-0.5 hover:bg-secondary/80 transition-colors"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            setSelectedTag(tag.name);
                                          }}
                                        >
                                          <Tag className="mr-1 h-2.5 w-2.5" />
                                          {tag.name}
                                        </Badge>
                                      ))}
                                    </div>

                                    <Button 
                                      variant="ghost" 
                                      className="group/btn hover:bg-primary hover:text-primary-foreground p-0"
                                    >
                                      Weiterlesen
                                      <ChevronRight className="ml-1 h-4 w-4 group-hover/btn:translate-x-0.5 transition-transform" />
                                    </Button>
                                  </div>
                                </div>
                              </Link>
                            </motion.article>
                          ))
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}