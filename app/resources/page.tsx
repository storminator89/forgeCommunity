'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Book, File, Video, Link, Search, Plus, Menu, Edit } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

enum ResourceType {
  ARTICLE = 'ARTICLE',
  VIDEO = 'VIDEO',
  EBOOK = 'EBOOK',
  PODCAST = 'PODCAST',
  COURSE = 'COURSE',
}

interface User {
  id: string;
  name: string | null;
  email: string;
}

interface Resource {
  id: string;
  title: string;
  type: ResourceType;
  category: string;
  author: User;
  url: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

const categories = ["Web Development", "Data Science", "Design", "Mobile Development", "DevOps"];
const types = ["ARTICLE", "VIDEO", "EBOOK", "PODCAST", "COURSE"];

const ITEMS_PER_PAGE = 9; // Anzahl der Ressourcen pro Seite

export default function ResourceLibrary() {
  const { data: session } = useSession();
  const [resources, setResources] = useState<Resource[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [newResource, setNewResource] = useState({
    title: '',
    type: 'ARTICLE',
    category: 'Web Development',
    url: '',
    color: 'bg-blue-500',
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editResource, setEditResource] = useState<Resource | null>(null);

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    try {
      const response = await axios.get('/api/resources');
      setResources(response.data);
    } catch (error) {
      console.error('Fehler beim Abrufen der Ressourcen:', error);
      toast.error('Fehler beim Abrufen der Ressourcen.');
    }
  };

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    setCurrentPage(1); // Zurück zur ersten Seite bei neuer Suche
  };

  const handleAddResource = async () => {
    if (!newResource.title || !newResource.url) {
      toast.error('Titel und URL sind erforderlich.');
      return;
    }

    try {
      const resourceToAdd = {
        title: newResource.title,
        type: newResource.type,
        category: newResource.category,
        url: newResource.url,
        color: newResource.color,
      };

      const response = await axios.post('/api/resources', resourceToAdd);
      setResources([response.data, ...resources]);
      setNewResource({
        title: '',
        type: 'ARTICLE',
        category: 'Web Development',
        url: '',
        color: 'bg-blue-500',
      });
      setIsDialogOpen(false);
      toast.success('Ressource erfolgreich hinzugefügt!');
    } catch (error: any) {
      console.error('Fehler beim Hinzufügen der Ressource:', error);
      toast.error('Fehler beim Hinzufügen der Ressource.');
    }
  };

  const handleDeleteResource = async (id: string) => {
    if (!confirm('Bist du sicher, dass du diese Ressource löschen möchtest?')) {
      return;
    }

    try {
      await axios.delete(`/api/resources/${id}`);
      setResources(resources.filter(resource => resource.id !== id));
      toast.success('Ressource erfolgreich gelöscht!');
    } catch (error) {
      console.error('Fehler beim Löschen der Ressource:', error);
      toast.error('Fehler beim Löschen der Ressource.');
    }
  };

  const handleEditResource = (resource: Resource) => {
    setEditResource(resource);
    setIsEditDialogOpen(true);
  };

  const handleUpdateResource = async () => {
    if (!editResource?.title || !editResource?.url) {
      toast.error('Titel und URL sind erforderlich.');
      return;
    }

    try {
      const response = await axios.put(`/api/resources`, {
        id: editResource.id,
        title: editResource.title,
        url: editResource.url,
      });

      setResources(resources.map(resource => resource.id === editResource.id ? response.data : resource));
      setIsEditDialogOpen(false);
      toast.success('Ressource erfolgreich aktualisiert!');
    } catch (error: any) {
      console.error('Fehler beim Aktualisieren der Ressource:', error);
      toast.error('Fehler beim Aktualisieren der Ressource.');
    }
  };

  const filteredResources = resources.filter(resource => 
    resource.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (resource.author.name && resource.author.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    resource.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredResources.length / ITEMS_PER_PAGE);
  const paginatedResources = filteredResources.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

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
          <ToastContainer />
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
                    className="pl-10 pr-4 py-2 w-full border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              </div>
              {session && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="flex items-center bg-blue-600 hover:bg-blue-700 text-white">
                      <Plus className="mr-2 h-4 w-4" />
                      Ressource hinzufügen
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-semibold">Neue Ressource hinzufügen</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="title" className="text-gray-700 dark:text-gray-300">Titel</Label>
                        <Input
                          id="title"
                          value={newResource.title}
                          onChange={(e) => setNewResource({ ...newResource, title: e.target.value })}
                          className="dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="type" className="text-gray-700 dark:text-gray-300">Typ</Label>
                        <Select
                          value={newResource.type}
                          onValueChange={(value) => setNewResource({ ...newResource, type: value })}
                        >
                          <SelectTrigger id="type" className="dark:bg-gray-700">
                            <SelectValue placeholder="Wähle einen Typ" />
                          </SelectTrigger>
                          <SelectContent className="dark:bg-gray-700">
                            {types.map((type) => (
                              <SelectItem key={type} value={type} className="dark:text-gray-200">
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="category" className="text-gray-700 dark:text-gray-300">Kategorie</Label>
                        <Select
                          value={newResource.category}
                          onValueChange={(value) => setNewResource({ ...newResource, category: value })}
                        >
                          <SelectTrigger id="category" className="dark:bg-gray-700">
                            <SelectValue placeholder="Wähle eine Kategorie" />
                          </SelectTrigger>
                          <SelectContent className="dark:bg-gray-700">
                            {categories.map((category) => (
                              <SelectItem key={category} value={category} className="dark:text-gray-200">
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="url" className="text-gray-700 dark:text-gray-300">URL</Label>
                        <Input
                          id="url"
                          value={newResource.url}
                          onChange={(e) => setNewResource({ ...newResource, url: e.target.value })}
                          className="dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="color" className="text-gray-700 dark:text-gray-300">Farbe</Label>
                        <Select
                          value={newResource.color}
                          onValueChange={(value) => setNewResource({ ...newResource, color: value })}
                        >
                          <SelectTrigger id="color" className="dark:bg-gray-700">
                            <SelectValue placeholder="Wähle eine Farbe" />
                          </SelectTrigger>
                          <SelectContent className="dark:bg-gray-700">
                            <SelectItem value="bg-blue-500" className="dark:text-gray-200">Blau</SelectItem>
                            <SelectItem value="bg-green-500" className="dark:text-gray-200">Grün</SelectItem>
                            <SelectItem value="bg-purple-500" className="dark:text-gray-200">Lila</SelectItem>
                            <SelectItem value="bg-red-500" className="dark:text-gray-200">Rot</SelectItem>
                            <SelectItem value="bg-yellow-500" className="dark:text-gray-200">Gelb</SelectItem>
                            <SelectItem value="bg-gray-500" className="dark:text-gray-200">Grau</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button onClick={handleAddResource} className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white">
                      Hinzufügen
                    </Button>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            <Tabs defaultValue="all" value={selectedTab} onValueChange={setSelectedTab} className="w-full">
              <TabsList className="grid w-full grid-cols-5 bg-white dark:bg-gray-800 rounded-lg p-1 shadow">
                <TabsTrigger value="all" className="text-gray-700 dark:text-gray-300">Alle</TabsTrigger>
                <TabsTrigger value="articles" className="text-gray-700 dark:text-gray-300">Artikel</TabsTrigger>
                <TabsTrigger value="videos" className="text-gray-700 dark:text-gray-300">Videos</TabsTrigger>
                <TabsTrigger value="ebooks" className="text-gray-700 dark:text-gray-300">E-Books</TabsTrigger>
                <TabsTrigger value="others" className="text-gray-700 dark:text-gray-300">Andere</TabsTrigger>
              </TabsList>
              <TabsContent value="all">
                <ResourceGrid resources={paginatedResources} onDelete={handleDeleteResource} onEdit={handleEditResource} />
              </TabsContent>
              <TabsContent value="articles">
                <ResourceGrid resources={paginatedResources.filter(r => r.type === 'ARTICLE')} onDelete={handleDeleteResource} onEdit={handleEditResource} />
              </TabsContent>
              <TabsContent value="videos">
                <ResourceGrid resources={paginatedResources.filter(r => r.type === 'VIDEO')} onDelete={handleDeleteResource} onEdit={handleEditResource} />
              </TabsContent>
              <TabsContent value="ebooks">
                <ResourceGrid resources={paginatedResources.filter(r => r.type === 'EBOOK')} onDelete={handleDeleteResource} onEdit={handleEditResource} />
              </TabsContent>
              <TabsContent value="others">
                <ResourceGrid resources={paginatedResources.filter(r => !['ARTICLE', 'VIDEO', 'EBOOK'].includes(r.type))} onDelete={handleDeleteResource} onEdit={handleEditResource} />
              </TabsContent>
            </Tabs>
            {totalPages > 1 && (
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
            )}
          </div>
        </main>
      </div>
      {editResource && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">Ressource bearbeiten</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-title" className="text-gray-700 dark:text-gray-300">Titel</Label>
                <Input
                  id="edit-title"
                  value={editResource.title}
                  onChange={(e) => setEditResource({ ...editResource, title: e.target.value })}
                  className="dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-url" className="text-gray-700 dark:text-gray-300">URL</Label>
                <Input
                  id="edit-url"
                  value={editResource.url}
                  onChange={(e) => setEditResource({ ...editResource, url: e.target.value })}
                  className="dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
            <Button onClick={handleUpdateResource} className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white">
              Aktualisieren
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ResourceGrid({ resources, onDelete, onEdit }: { resources: Resource[]; onDelete: (id: string) => void; onEdit: (resource: Resource) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
      <AnimatePresence>
        {resources.map(resource => (
          <motion.div
            key={resource.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="overflow-hidden shadow-lg hover:shadow-2xl transition-shadow duration-300 rounded-lg bg-white dark:bg-gray-800">
              <div className={`h-32 ${resource.color} rounded-t-lg flex items-center justify-between p-4`}>
                <div className="flex items-center space-x-2">
                  {getIcon(resource.type)}
                  <h3 className="text-xl font-semibold text-white dark:text-gray-200">{resource.title}</h3>
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="ghost"
                    onClick={() => onEdit(resource)}
                    className="text-white dark:text-gray-200 hover:text-yellow-500 transition-colors duration-200"
                    aria-label="Ressource bearbeiten"
                  >
                    <Edit className="h-6 w-6" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onDelete(resource.id)}
                    className="text-white dark:text-gray-200 hover:text-red-500 transition-colors duration-200"
                    aria-label="Ressource löschen"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </Button>
                </div>
              </div>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="inline-block px-3 py-1 text-xs font-semibold text-white bg-gray-700 rounded-full">
                    {resource.category}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-400">von {resource.author.name || resource.author.email}</p>
                <a href={resource.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200">
                  <Link className="mr-2 h-5 w-5" />
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

function getIcon(type: ResourceType) {
  const iconClass = "h-6 w-6 text-white dark:text-gray-200";
  switch(type) {
    case ResourceType.ARTICLE: return <File className={iconClass} />;
    case ResourceType.VIDEO: return <Video className={iconClass} />;
    case ResourceType.EBOOK: return <Book className={iconClass} />;
    case ResourceType.PODCAST: return <Link className={iconClass} />;
    case ResourceType.COURSE: return <Book className={iconClass} />;
    default: return <Link className={iconClass} />;
  }
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const pages = [];

  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }

  return (
    <div className="flex justify-center mt-6 space-x-2">
      <Button
        variant="ghost"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="disabled:opacity-50"
        aria-label="Vorherige Seite"
      >
        Zurück
      </Button>
      {pages.map(page => (
        <Button
          key={page}
          variant={page === currentPage ? "primary" : "ghost"}
          onClick={() => onPageChange(page)}
          className={page === currentPage ? "bg-blue-600 text-white" : ""}
          aria-label={`Seite ${page}`}
        >
          {page}
        </Button>
      ))}
      <Button
        variant="ghost"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="disabled:opacity-50"
        aria-label="Nächste Seite"
      >
        Weiter
      </Button>
    </div>
  );
}
