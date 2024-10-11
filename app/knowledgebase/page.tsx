"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Book, Plus, ChevronRight, Calendar, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

interface Article {
  id: number;
  title: string;
  content: string;
  category: string;
  author: string;
  createdAt: string;
  tags: string[];
}

const articlesData: Article[] = [
  {
    id: 1,
    title: "Getting Started with React",
    content: "React is a popular JavaScript library for building user interfaces. This guide covers the basics of React, including components, props, and state. We'll walk you through setting up your first React project and creating a simple application.",
    category: "Frontend",
    author: "Alice Johnson",
    createdAt: "2023-06-15",
    tags: ["React", "JavaScript", "Web Development"]
  },
  {
    id: 2,
    title: "Introduction to Machine Learning",
    content: "Machine Learning is a subset of AI that focuses on developing algorithms that learn from data. This article introduces key concepts like supervised and unsupervised learning, and discusses popular ML algorithms and their applications.",
    category: "Data Science",
    author: "Bob Smith",
    createdAt: "2023-06-10",
    tags: ["Machine Learning", "AI", "Data Science"]
  },
  {
    id: 3,
    title: "Best Practices for API Design",
    content: "Designing effective APIs is crucial for creating robust and user-friendly software. This article covers best practices including consistency, proper documentation, versioning, security, and performance optimization for API design.",
    category: "Backend",
    author: "Carol Williams",
    createdAt: "2023-06-05",
    tags: ["API", "Backend", "Web Development"]
  },
];

export default function KnowledgeBase() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [isAddArticleDialogOpen, setIsAddArticleDialogOpen] = useState(false);
  const [newArticle, setNewArticle] = useState<Partial<Article>>({
    title: '',
    content: '',
    category: '',
    tags: [],
  });

  const categories = ['All', ...new Set(articlesData.map(article => article.category))];

  const filteredArticles = articlesData.filter(article =>
    (selectedCategory === 'All' || article.category === selectedCategory) &&
    (article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
     article.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
     article.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  const handleAddArticle = () => {
    console.log("New article:", newArticle);
    setIsAddArticleDialogOpen(false);
    setNewArticle({ title: '', content: '', category: '', tags: [] });
  };

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
            <Tabs defaultValue="All" className="w-full" onValueChange={setSelectedCategory}>
              <ScrollArea className="w-full whitespace-nowrap">
                <TabsList>
                  {categories.map((category) => (
                    <TabsTrigger key={category} value={category} className="capitalize">
                      {category}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </ScrollArea>
            </Tabs>
            <Button onClick={() => setIsAddArticleDialogOpen(true)} className="ml-4">
              <Plus className="mr-2 h-4 w-4" /> Neuer Artikel
            </Button>
          </div>
          <ScrollArea className="h-[calc(100vh-200px)]">
            <AnimatePresence>
              <motion.div 
                className="space-y-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {filteredArticles.map((article) => (
                  <motion.article
                    key={article.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300"
                  >
                    <h3 className="text-2xl font-bold mb-2 text-gray-800 dark:text-white">{article.title}</h3>
                    <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-4">
                      <User className="mr-2 h-4 w-4" />
                      <span className="mr-4">{article.author}</span>
                      <Calendar className="mr-2 h-4 w-4" />
                      <span>{article.createdAt}</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-300 mb-4">
                      {article.content}
                    </p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {article.tags.map((tag, index) => (
                        <Badge key={index} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                    <Button variant="link" onClick={() => setSelectedArticle(article)}>
                      Weiterlesen <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Separator className="my-4" />
                  </motion.article>
                ))}
              </motion.div>
            </AnimatePresence>
          </ScrollArea>
        </main>
      </div>
      <Dialog open={!!selectedArticle} onOpenChange={() => setSelectedArticle(null)}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedArticle?.title}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-4">
            <User className="mr-2 h-4 w-4" />
            <span className="mr-4">{selectedArticle?.author}</span>
            <Calendar className="mr-2 h-4 w-4" />
            <span>{selectedArticle?.createdAt}</span>
          </div>
          <div className="mt-2 text-gray-600 dark:text-gray-300 whitespace-pre-line">
            {selectedArticle?.content}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {selectedArticle?.tags.map((tag, index) => (
              <Badge key={index} variant="secondary">{tag}</Badge>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isAddArticleDialogOpen} onOpenChange={setIsAddArticleDialogOpen}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle>Neuen Artikel hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="title" className="text-right">
                Titel
              </Label>
              <Input
                id="title"
                value={newArticle.title}
                onChange={(e) => setNewArticle({...newArticle, title: e.target.value})}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="content" className="text-right">
                Inhalt
              </Label>
              <Textarea
                id="content"
                value={newArticle.content}
                onChange={(e) => setNewArticle({...newArticle, content: e.target.value})}
                className="col-span-3"
                rows={10}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="category" className="text-right">
                Kategorie
              </Label>
              <Input
                id="category"
                value={newArticle.category}
                onChange={(e) => setNewArticle({...newArticle, category: e.target.value})}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="tags" className="text-right">
                Tags
              </Label>
              <Input
                id="tags"
                value={newArticle.tags?.join(', ')}
                onChange={(e) => setNewArticle({...newArticle, tags: e.target.value.split(',').map(tag => tag.trim())})}
                className="col-span-3"
                placeholder="Trennen Sie Tags mit Kommas"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" onClick={handleAddArticle}>Artikel hinzufügen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}