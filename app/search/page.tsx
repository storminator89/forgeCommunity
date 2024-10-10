"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Book, Calendar, Users, MessageSquare } from 'lucide-react';

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

  const filteredResults = mockSearchResults.filter(result => 
    (activeTab === 'all' || result.type === activeTab) &&
    (result.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
     result.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const renderIcon = (type: string) => {
    switch(type) {
      case 'course': return <Book className="h-5 w-5" />;
      case 'event': return <Calendar className="h-5 w-5" />;
      case 'member': return <Users className="h-5 w-5" />;
      case 'post': return <MessageSquare className="h-5 w-5" />;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
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
                className="pl-10 pr-4 py-2 w-full"
              />
            </div>

            <Tabs defaultValue="all" onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="all">Alle</TabsTrigger>
                <TabsTrigger value="course">Kurse</TabsTrigger>
                <TabsTrigger value="event">Events</TabsTrigger>
                <TabsTrigger value="member">Mitglieder</TabsTrigger>
                <TabsTrigger value="post">Beiträge</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-6">
                {filteredResults.map((result) => (
                  <div key={result.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
                    <div className="flex items-center space-x-3">
                      {renderIcon(result.type)}
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{result.title}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{result.description}</p>
                        {result.date && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{result.date}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </TabsContent>

              {['course', 'event', 'member', 'post'].map((tab) => (
                <TabsContent key={tab} value={tab} className="mt-6">
                  {filteredResults.filter(result => result.type === tab).map((result) => (
                    <div key={result.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-4">
                      <div className="flex items-center space-x-3">
                        {renderIcon(result.type)}
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{result.title}</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-300">{result.description}</p>
                          {result.date && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{result.date}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
}