'use client';

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Book, File, Video, Link, Search, Plus, Menu, Edit, Share2, Copy, Check, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useInView } from 'react-intersection-observer';
import { ResourcePreview } from "@/components/ResourcePreview";
import clsx from 'clsx';

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

const shareResource = async (resource: Resource, platform: string) => {
  const shareUrl = encodeURIComponent(`${window.location.origin}/resources/${resource.id}`);
  const shareTitle = encodeURIComponent(resource.title);
  
  const shareUrls = {
    twitter: `https://twitter.com/intent/tweet?text=${shareTitle}&url=${shareUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`,
  };

  window.open(shareUrls[platform as keyof typeof shareUrls], '_blank');
};

export default function ResourceLibrary() {
  const { data: session } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
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
  const [currentPage, setCurrentPage] = useState(1);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editResource, setEditResource] = useState<Resource | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [displayedResources, setDisplayedResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');
  
  const { ref, inView } = useInView({
    threshold: 0,
  });

  useEffect(() => {
    const initialFetch = async () => {
      await fetchResources();
      if (session?.user?.id) {
        await checkAdminStatus();
      }
    };
    initialFetch();
  }, [session]);  // Abhängigkeit von session hinzugefügt

  useEffect(() => {
    if (inView && hasMore && !loading) {
      loadMore();
    }
  }, [inView, hasMore, loading]);

  const fetchResources = async (pageNumber = 1) => {
    try {
      setLoading(true);
      const response = await axios.get('/api/resources', {
        params: {
          page: pageNumber,
          limit: ITEMS_PER_PAGE,
          search: searchTerm
        }
      });
      
      if (pageNumber === 1) {
        setDisplayedResources(response.data.resources);
      } else {
        // Füge nur neue, eindeutige Ressourcen hinzu
        setDisplayedResources(prev => {
          const existingIds = new Set(prev.map(r => r.id));
          const newResources = response.data.resources.filter(
            (resource: Resource) => !existingIds.has(resource.id)
          );
          return [...prev, ...newResources];
        });
      }
      
      setHasMore(response.data.hasMore);
    } catch (error) {
      console.error('Fehler beim Abrufen der Ressourcen:', error);
      toast.error('Fehler beim Abrufen der Ressourcen.');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (loading || !hasMore) return;
    
    const nextPage = Math.floor(displayedResources.length / ITEMS_PER_PAGE) + 1;
    fetchResources(nextPage);
  };

  const handleSearchInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  useEffect(() => {
    const debouncedSearch = setTimeout(() => {
      setPage(1);
      setDisplayedResources([]);
      setHasMore(true);
      fetchResources(1);
    }, 300);

    return () => clearTimeout(debouncedSearch);
  }, [searchTerm]);

  const checkAdminStatus = async () => {
    if (session?.user?.id) {
      try {
        const response = await axios.get(`/api/users/${session.user.id}/role`);
        setIsAdmin(response.data.role === 'ADMIN');
      } catch (error) {
        console.error('Fehler beim Prüfen des Admin-Status:', error);
      }
    }
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
      // Füge neue Ressource am Anfang der displayedResources hinzu
      setDisplayedResources(prev => [response.data, ...prev]);
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
    if (window.confirm('Möchtest du diese Ressource wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
      try {
        const response = await axios.delete(`/api/resources/${id}`);
        if (response.status === 200) {
          setDisplayedResources(prev => prev.filter(resource => resource.id !== id));
          toast.success('Ressource wurde erfolgreich gelöscht', {
            position: "top-right",
            autoClose: 3000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
          });
        }
      } catch (error: any) {
        console.error('Fehler beim Löschen der Ressource:', error);
        toast.error(error.response?.data?.message || 'Fehler beim Löschen der Ressource', {
          position: "top-right",
          autoClose: 5000,
        });
      }
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
      const response = await axios.put(`/api/resources/${editResource.id}`, {
        title: editResource.title,
        url: editResource.url,
      });

      // Aktualisiere die Ressource in displayedResources
      setDisplayedResources(prev => 
        prev.map(resource => 
          resource.id === editResource.id ? response.data : resource
        )
      );
      setIsEditDialogOpen(false);
      toast.success('Ressource erfolgreich aktualisiert!');
    } catch (error: any) {
      console.error('Fehler beim Aktualisieren der Ressource:', error);
      toast.error('Fehler beim Aktualisieren der Ressource.');
    }
  };

  const filteredAndSortedResources = useMemo(() => {
    let filtered = [...displayedResources];
    
    // Kategorie-Filter
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(resource => resource.category === selectedCategory);
    }
    
    // Typ-Filter
    if (selectedType !== 'all') {
      filtered = filtered.filter(resource => resource.type === selectedType);
    }
    
    // Sortierung
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'oldest':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  }, [displayedResources, selectedCategory, selectedType, sortBy]);

  const totalPages = Math.ceil(filteredAndSortedResources.length / ITEMS_PER_PAGE);
  const paginatedResources = filteredAndSortedResources.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center">
                <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={() => setIsSidebarOpen(true)}>
                  <Menu className="h-6 w-6" />
                </Button>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Ressourcen-Bibliothek</h2>
              </div>
              <div className="flex items-center justify-between gap-4">
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <ToastContainer />
          <div className="max-w-[1600px] mx-auto space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm">
              <div className="flex-1 w-full md:w-auto max-w-2xl">
                <div className="relative group">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 group-hover:text-blue-500 transition-colors duration-200" />
                  <Input
                    type="text"
                    placeholder="Suche nach Ressourcen..."
                    value={searchTerm}
                    onChange={handleSearchInput}
                    className="pl-10 pr-4 py-2 w-full border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white transition-all duration-200 hover:border-blue-500/50"
                  />
                </div>
              </div>
              {session && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg shadow-lg hover:shadow-blue-500/25 transition-all duration-200 min-w-[200px]">
                      <Plus className="mr-2 h-5 w-5" />
                      Ressource hinzufügen
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden">
                    <DialogHeader className="p-6 pb-2">
                      <DialogTitle className="text-xl font-semibold">Neue Ressource hinzufügen</DialogTitle>
                    </DialogHeader>
                    <div className="px-6 py-4 space-y-4">
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
                    </div>
                    <div className="border-t border-gray-100 dark:border-gray-700 p-6 bg-gray-50 dark:bg-gray-800/50">
                      <Button 
                        onClick={handleAddResource} 
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 rounded-lg shadow-lg hover:shadow-blue-500/25 transition-all duration-200"
                      >
                        Ressource hinzufügen
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>

            {/* Filter-Leiste */}
            <div className="flex flex-wrap gap-4 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm">
              <div className="flex items-center space-x-3">
                <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Kategorie:</Label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Alle Kategorien" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Kategorien</SelectItem>
                    {categories.map(category => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-3">
                <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Typ:</Label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Alle Typen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Typen</SelectItem>
                    {types.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-3 ml-auto">
                <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Sortierung:</Label>
                <Select value={sortBy} onValueChange={(value: 'newest' | 'oldest' | 'title') => setSortBy(value)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Sortieren nach" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Neueste zuerst</SelectItem>
                    <SelectItem value="oldest">Älteste zuerst</SelectItem>
                    <SelectItem value="title">Nach Titel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Aktive Filter anzeigen */}
            {(selectedCategory !== 'all' || selectedType !== 'all') && (
              <div className="flex flex-wrap gap-2">
                {selectedCategory !== 'all' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedCategory('all')}
                    className="flex items-center space-x-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                  >
                    <span>{selectedCategory}</span>
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {selectedType !== 'all' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedType('all')}
                    className="flex items-center space-x-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800"
                  >
                    <span>{selectedType}</span>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}

            <div className="mt-6">
              <ResourceGrid 
                resources={filteredAndSortedResources}
                onDelete={handleDeleteResource} 
                onEdit={handleEditResource}
                isAdmin={isAdmin}
                currentUserId={session?.user?.id}
              />
              {hasMore && !loading && (
                <div ref={ref} className="h-10" /> // Unsichtbarer Trigger für Intersection Observer
              )}
              {loading && (
                <div className="flex justify-center p-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              )}
            </div>
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

function ResourceGrid({ resources, onDelete, onEdit, isAdmin, currentUserId }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyLink = async (resource: Resource) => {
    const shareUrl = `${window.location.origin}/resources/${resource.id}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedId(resource.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const canModifyResource = (resource: Resource) => {
    return Boolean(isAdmin) || resource.author.id === currentUserId;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6">
      <AnimatePresence>
        {resources.map(resource => (
          <motion.div
            key={resource.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="group overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 rounded-xl bg-white dark:bg-gray-800/90 border border-gray-100 dark:border-gray-700/50">
              <div className={`${resource.color} rounded-t-xl flex items-center justify-between p-6 transition-transform duration-300 group-hover:scale-[1.01]`}>
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
                    {getIcon(resource.type)}
                  </div>
                  <h3 className="text-2xl font-semibold text-white dark:text-gray-200 truncate">{resource.title}</h3>
                </div>
                {canModifyResource(resource) && (
                  <div className="flex space-x-2">
                    <Button
                      variant="ghost"
                      onClick={() => onEdit(resource)}
                      className="text-white/90 hover:text-white dark:text-gray-200 hover:bg-white/10 transition-colors duration-200"
                      aria-label="Ressource bearbeiten"
                    >
                      <Edit className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => onDelete(resource.id)}
                      className="text-white/90 hover:text-white dark:text-gray-200 hover:bg-red-500/20 transition-colors duration-200"
                      aria-label="Ressource löschen"
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </div>
                )}
              </div>
              
              <ResourcePreview url={resource.url} type={resource.type} />

              <CardContent className="p-6 border-t border-gray-100 dark:border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                  <span className="inline-flex items-center px-3 py-1 text-xs font-medium text-white bg-gray-700 rounded-full">
                    {resource.category}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    von {resource.author.name || resource.author.email}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <a 
                    href={resource.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="flex-1 inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200 font-medium"
                  >
                    <Link className="mr-2 h-5 w-5" />
                    Ressource öffnen
                  </a>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="icon"
                        className="hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem 
                        onClick={() => shareResource(resource, 'twitter')}
                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <svg className="h-4 w-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                        </svg>
                        Auf Twitter teilen
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => shareResource(resource, 'linkedin')}
                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <svg className="h-4 w-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                        Auf LinkedIn teilen
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => shareResource(resource, 'facebook')}
                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <svg className="h-4 w-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                        Auf Facebook teilen
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleCopyLink(resource)}
                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <div className="flex items-center w-full">
                          {copiedId === resource.id ? (
                            <>
                              <Check className="h-4 w-4 mr-2 text-green-500" />
                              <span className="text-green-500">Link kopiert!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4 mr-2" />
                              <span>Link kopieren</span>
                            </>
                          )}
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
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
