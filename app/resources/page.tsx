"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Book, File, Video, Link, Search, Plus, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const resourcesData = [
  { id: 1, title: "Einführung in React", type: "Article", category: "Web Development", author: "John Doe", url: "https://example.com/react-intro", color: "bg-blue-500" },
  { id: 2, title: "Machine Learning Basics", type: "Video", category: "Data Science", author: "Jane Smith", url: "https://example.com/ml-basics", color: "bg-green-500" },
  { id: 3, title: "UX Design Principles", type: "E-Book", category: "Design", author: "Alex Johnson", url: "https://example.com/ux-design-ebook", color: "bg-purple-500" },
  // Add more mock resources as needed
];

const categories = ["Web Development", "Data Science", "Design", "Mobile Development", "DevOps"];
const types = ["Article", "Video", "E-Book", "Podcast", "Course"];

export default function ResourceLibrary() {
  const [resources, setResources] = useState(resourcesData);
  const [searchTerm, setSearchTerm] = useState('');
  const [newResource, setNewResource] = useState({ title: '', type: 'Article', category: 'Web Development', author: '', url: '', color: 'bg-gray-500' });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleSearch = (event) => {
    setSearchTerm(event.target.value);
  };

  const handleAddResource = () => {
    const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500', 'bg-yellow-500'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    setResources([...resources, { ...newResource, id: resources.length + 1, color: randomColor }]);
    setNewResource({ title: '', type: 'Article', category: 'Web Development', author: '', url: '', color: 'bg-gray-500' });
    setIsDialogOpen(false);
  };

  const filteredResources = resources.filter(resource => 
    resource.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    resource.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
    resource.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={() => setIsSidebarOpen(true)}>
                <Menu className="h-6 w-6" />
              </Button>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Ressourcen-Bibliothek</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0 md:space-x-4">
              <div className="flex-1 w-full md:w-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Suche nach Ressourcen..."
                    value={searchTerm}
                    onChange={handleSearch}
                    className="pl-10 pr-4 py-2 w-full"
                  />
                </div>
              </div>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Ressource hinzufügen
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Neue Ressource hinzufügen</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="title">Titel</Label>
                      <Input
                        id="title"
                        value={newResource.title}
                        onChange={(e) => setNewResource({...newResource, title: e.target.value})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="type">Typ</Label>
                      <Select
                        value={newResource.type}
                        onValueChange={(value) => setNewResource({...newResource, type: value})}
                      >
                        <SelectTrigger id="type">
                          <SelectValue placeholder="Wähle einen Typ" />
                        </SelectTrigger>
                        <SelectContent>
                          {types.map((type) => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="category">Kategorie</Label>
                      <Select
                        value={newResource.category}
                        onValueChange={(value) => setNewResource({...newResource, category: value})}
                      >
                        <SelectTrigger id="category">
                          <SelectValue placeholder="Wähle eine Kategorie" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category} value={category}>{category}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="author">Autor</Label>
                      <Input
                        id="author"
                        value={newResource.author}
                        onChange={(e) => setNewResource({...newResource, author: e.target.value})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="url">URL</Label>
                      <Input
                        id="url"
                        value={newResource.url}
                        onChange={(e) => setNewResource({...newResource, url: e.target.value})}
                      />
                    </div>
                  </div>
                  <Button onClick={handleAddResource}>Hinzufügen</Button>
                </DialogContent>
              </Dialog>
            </div>
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="all">Alle</TabsTrigger>
                <TabsTrigger value="articles">Artikel</TabsTrigger>
                <TabsTrigger value="videos">Videos</TabsTrigger>
                <TabsTrigger value="ebooks">E-Books</TabsTrigger>
                <TabsTrigger value="others">Andere</TabsTrigger>
              </TabsList>
              <TabsContent value="all">
                <ResourceGrid resources={filteredResources} />
              </TabsContent>
              <TabsContent value="articles">
                <ResourceGrid resources={filteredResources.filter(r => r.type === 'Article')} />
              </TabsContent>
              <TabsContent value="videos">
                <ResourceGrid resources={filteredResources.filter(r => r.type === 'Video')} />
              </TabsContent>
              <TabsContent value="ebooks">
                <ResourceGrid resources={filteredResources.filter(r => r.type === 'E-Book')} />
              </TabsContent>
              <TabsContent value="others">
                <ResourceGrid resources={filteredResources.filter(r => !['Article', 'Video', 'E-Book'].includes(r.type))} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
}

function ResourceGrid({ resources }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <AnimatePresence>
        {resources.map(resource => (
          <motion.div
            key={resource.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="overflow-hidden">
              <div className={`h-32 ${resource.color}`} />
              <CardHeader className="flex flex-row items-center space-x-4">
                {getIcon(resource.type)}
                <CardTitle>{resource.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">von {resource.author}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{resource.category}</p>
                <a href={resource.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-blue-600 hover:underline">
                  Ressource öffnen
                </a>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function getIcon(type) {
  switch(type) {
    case 'Article': return <File className="h-6 w-6" />;
    case 'Video': return <Video className="h-6 w-6" />;
    case 'E-Book': return <Book className="h-6 w-6" />;
    default: return <Link className="h-6 w-6" />;
  }
}