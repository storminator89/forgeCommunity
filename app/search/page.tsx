"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Book, Calendar, Users, MessageSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from "@/components/ui/badge";

interface SearchResult {
  id: string;
  title: string;
  description: string;
  type: 'course' | 'event' | 'member' | 'post';
  date?: string;
}

const mockSearchResults: SearchResult[] = [
  { id: '1', title: 'Einführung in React', description: 'Lerne die Grundlagen von React', type: 'course' },
  { id: '2', title: 'Webentwicklung Workshop', description: 'Ein ganztägiger Workshop zu modernen Webentwicklungstechniken.', type: 'event', date: '2024-11-15' },
  { id: '3', title: 'Max Mustermann', description: 'Entwickler aus Berlin', type: 'member' },
  { id: '4', title: 'Wie optimiere ich meine React-App?', description: 'Diskussion über Performanceoptimierung in React', type: 'post' },
  // Fügen Sie hier weitere Mock-Ergebnisse hinzu
];

export default function SearchPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filteredResults = mockSearchResults.filter(result => 
    (activeTab === 'all' || result.type === activeTab) &&
    (result.title.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
     result.description.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
  );

  const renderIcon = (type: string) => {
    switch(type) {
      case 'course': return <Book className="h-5 w-5 text-blue-500" />;
      case 'event': return <Calendar className="h-5 w-5 text-green-500" />;
      case 'member': return <Users className="h-5 w-5 text-purple-500" />;
      case 'post': return <MessageSquare className="h-5 w-5 text-yellow-500" />;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white ml-12 lg:ml-0">Suche</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                placeholder="Suche nach Kursen, Events, Mitgliedern oder Beiträgen"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-10 py-2 w-full rounded-full shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2"
                  onClick={() => setSearchTerm('')}
                >
                  <X className="h-4 w-4 text-gray-400" />
                </Button>
              )}
            </div>

            <Tabs defaultValue="all" onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full justify-start mb-4 bg-white dark:bg-gray-800 p-1 rounded-lg shadow-sm">
                <TabsTrigger value="all" className="flex-1">Alle</TabsTrigger>
                <TabsTrigger value="course" className="flex-1">Kurse</TabsTrigger>
                <TabsTrigger value="event" className="flex-1">Events</TabsTrigger>
                <TabsTrigger value="member" className="flex-1">Mitglieder</TabsTrigger>
                <TabsTrigger value="post" className="flex-1">Beiträge</TabsTrigger>
              </TabsList>

              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <TabsContent value={activeTab} className="mt-6">
                    {filteredResults.length === 0 ? (
                      <div className="text-center py-10">
                        <Search className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Keine Ergebnisse gefunden</h3>
                        <p className="text-gray-500 dark:text-gray-400">Versuchen Sie es mit anderen Suchbegriffen oder wählen Sie eine andere Kategorie.</p>
                      </div>
                    ) : (
                      filteredResults.map((result) => (
                        <motion.div
                          key={result.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          transition={{ duration: 0.2 }}
                          className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md mb-4 hover:shadow-lg transition-shadow duration-200"
                        >
                          <div className="flex items-center space-x-3">
                            {renderIcon(result.type)}
                            <div className="flex-grow">
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{result.title}</h3>
                              <p className="text-sm text-gray-600 dark:text-gray-300">{result.description}</p>
                              <div className="flex items-center mt-2">
                                <Badge variant="secondary" className="mr-2">
                                  {result.type}
                                </Badge>
                                {result.date && <span className="text-xs text-gray-500 dark:text-gray-400">{result.date}</span>}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </TabsContent>
                </motion.div>
              </AnimatePresence>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
}