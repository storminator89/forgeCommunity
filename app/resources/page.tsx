'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Book, File, Video, Link as LinkIcon, Search, Plus, MoreVertical, Edit, Trash2, Share2, Copy, Check, ExternalLink, Filter, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useSession } from 'next-auth/react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useInView } from 'react-intersection-observer';
import { ResourcePreview } from "@/components/ResourcePreview";
import { cn } from "@/lib/utils";

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
  createdAt: string;
  updatedAt: string;
}

const categories = ["Web Development", "Data Science", "Design", "Mobile Development", "DevOps"];
const types = ["ARTICLE", "VIDEO", "EBOOK", "PODCAST", "COURSE"];
const ITEMS_PER_PAGE = 9;

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

  const fetchResources = useCallback(async (pageNumber = 1) => {
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
  }, [searchTerm]);

  const checkAdminStatus = useCallback(async () => {
    if (session?.user?.id) {
      try {
        const response = await axios.get(`/api/users/${session.user.id}/role`);
        setIsAdmin(response.data.role === 'ADMIN');
      } catch (error) {
        console.error('Fehler beim Prüfen des Admin-Status:', error);
      }
    }
  }, [session]);

  useEffect(() => {
    const initialFetch = async () => {
      await fetchResources();
      if (session?.user?.id) {
        await checkAdminStatus();
      }
    };
    initialFetch();
  }, [session, fetchResources, checkAdminStatus]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const nextPage = Math.floor(displayedResources.length / ITEMS_PER_PAGE) + 1;
    fetchResources(nextPage);
  }, [loading, hasMore, displayedResources.length, fetchResources]);

  useEffect(() => {
    if (inView && hasMore && !loading) {
      loadMore();
    }
  }, [inView, hasMore, loading, loadMore]);

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
        color: 'bg-blue-500', // Default value maintained for backend compatibility
      };

      const response = await axios.post('/api/resources', resourceToAdd);
      setDisplayedResources(prev => [response.data, ...prev]);
      setNewResource({
        title: '',
        type: 'ARTICLE',
        category: 'Web Development',
        url: '',
      });
      setIsDialogOpen(false);
      toast.success('Ressource erfolgreich hinzugefügt!');
    } catch (error: any) {
      console.error('Fehler beim Hinzufügen der Ressource:', error);
      toast.error('Fehler beim Hinzufügen der Ressource.');
    }
  };

  const handleDeleteResource = async (id: string) => {
    try {
      const response = await axios.delete(`/api/resources/${id}`);
      if (response.status === 200) {
        setDisplayedResources(prev => prev.filter(resource => resource.id !== id));
        toast.success('Ressource wurde erfolgreich gelöscht');
      }
    } catch (error: any) {
      console.error('Fehler beim Löschen der Ressource:', error);
      toast.error(error.response?.data?.message || 'Fehler beim Löschen der Ressource');
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

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(resource => resource.category === selectedCategory);
    }

    if (selectedType !== 'all') {
      filtered = filtered.filter(resource => resource.type === selectedType);
    }

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border z-10 sticky top-0">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center">
                <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={() => setIsSidebarOpen(true)}>
                  <Menu className="h-5 w-5" />
                </Button>
                <h2 className="text-xl font-semibold text-foreground tracking-tight">Ressourcen</h2>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <ToastContainer position="top-right" theme="colored" />
          <div className="max-w-[1600px] mx-auto p-4 sm:px-6 lg:px-8 py-8 space-y-6">

            {/* Toolbar */}
            <div className="flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center bg-card p-4 rounded-lg border border-border shadow-sm">
              <div className="flex-1 w-full xl:max-w-md relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  type="text"
                  placeholder="Ressourcen durchsuchen..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-full bg-background"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                <div className="flex items-center gap-2 flex-1 sm:flex-none">
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-full sm:w-[160px] bg-background">
                      <SelectValue placeholder="Kategorie" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Kategorien</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 flex-1 sm:flex-none">
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger className="w-full sm:w-[160px] bg-background">
                      <SelectValue placeholder="Typ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Typen</SelectItem>
                      {types.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 flex-1 sm:flex-none">
                  <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                    <SelectTrigger className="w-full sm:w-[160px] bg-background">
                      <SelectValue placeholder="Sortierung" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Neueste</SelectItem>
                      <SelectItem value="oldest">Älteste</SelectItem>
                      <SelectItem value="title">Titel (A-Z)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {session && (
                  <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="ml-auto flex-shrink-0">
                        <Plus className="mr-2 h-4 w-4" />
                        Neu
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                      <DialogHeader>
                        <DialogTitle>Neue Ressource hinzufügen</DialogTitle>
                        <DialogDescription>
                          Fügen Sie eine neue Ressource zur Bibliothek hinzu.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="title">Titel</Label>
                          <Input
                            id="title"
                            value={newResource.title}
                            onChange={(e) => setNewResource({ ...newResource, title: e.target.value })}
                            placeholder="z.B. Advanced React Patterns"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="type">Typ</Label>
                            <Select
                              value={newResource.type}
                              onValueChange={(value) => setNewResource({ ...newResource, type: value })}
                            >
                              <SelectTrigger id="type">
                                <SelectValue placeholder="Wählen" />
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
                              onValueChange={(value) => setNewResource({ ...newResource, category: value })}
                            >
                              <SelectTrigger id="category">
                                <SelectValue placeholder="Wählen" />
                              </SelectTrigger>
                              <SelectContent>
                                {categories.map((category) => (
                                  <SelectItem key={category} value={category}>{category}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="url">URL</Label>
                          <Input
                            id="url"
                            value={newResource.url}
                            onChange={(e) => setNewResource({ ...newResource, url: e.target.value })}
                            placeholder="https://..."
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleAddResource}>Hinzufügen</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {filteredAndSortedResources.map((resource) => (
                  <ResourceItem
                    key={resource.id}
                    resource={resource}
                    isAdmin={isAdmin}
                    currentUserId={session?.user?.id}
                    onDelete={handleDeleteResource}
                    onEdit={handleEditResource}
                  />
                ))}
              </AnimatePresence>
            </div>

            {/* States */}
            {!loading && filteredAndSortedResources.length === 0 && (
              <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg border-dashed border-border bg-muted/10">
                <Search className="h-10 w-10 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground">Keine Ressourcen gefunden</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Versuchen Sie, Ihre Suchbegriffe oder Filter anzupassen.
                </p>
                <Button
                  variant="link"
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategory('all');
                    setSelectedType('all');
                  }}
                  className="mt-2"
                >
                  Filter zurücksetzen
                </Button>
              </div>
            )}

            {hasMore && !loading && (
              <div ref={ref} className="h-10" />
            )}

            {loading && (
              <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Edit Dialog */}
      {editResource && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Ressource bearbeiten</DialogTitle>
              <DialogDescription>Aktualisieren Sie die Details der Ressource.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-title">Titel</Label>
                <Input
                  id="edit-title"
                  value={editResource.title}
                  onChange={(e) => setEditResource({ ...editResource, title: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-url">URL</Label>
                <Input
                  id="edit-url"
                  value={editResource.url}
                  onChange={(e) => setEditResource({ ...editResource, url: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Abbrechen</Button>
              <Button onClick={handleUpdateResource}>Aktualisieren</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ResourceItem({ resource, isAdmin, currentUserId, onDelete, onEdit }: {
  resource: Resource,
  isAdmin: boolean,
  currentUserId?: string,
  onDelete: (id: string) => void,
  onEdit: (r: Resource) => void
}) {
  const [copied, setCopied] = useState(false);

  const canModify = Boolean(isAdmin) || resource.author.id === currentUserId;

  const handleCopyLink = async () => {
    const shareUrl = `${window.location.origin}/resources/${resource.id}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link kopiert", { autoClose: 2000 });
  };

  const shareResource = (platform: string) => {
    const shareUrl = encodeURIComponent(`${window.location.origin}/resources/${resource.id}`);
    const shareTitle = encodeURIComponent(resource.title);

    const urls: Record<string, string> = {
      twitter: `https://twitter.com/intent/tweet?text=${shareTitle}&url=${shareUrl}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`,
    };

    window.open(urls[platform], '_blank');
  };

  const Icon = getIcon(resource.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      layout
    >
      <Card className="h-full flex flex-col group overflow-hidden border-border hover:border-primary/50 transition-all duration-300">
        <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary" className="text-xs font-normal">
                {resource.category}
              </Badge>
              <Badge variant="outline" className="text-xs font-normal text-muted-foreground border-border">
                {resource.type}
              </Badge>
            </div>
            <CardTitle className="text-lg font-semibold leading-tight line-clamp-2group-hover:text-primary transition-colors">
              <a href={resource.url} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-primary/30 underline-offset-4">
                {resource.title}
              </a>
            </CardTitle>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-muted-foreground">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Menü öffnen</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleCopyLink}>
                {copied ? <Check className="mr-2 h-4 w-4 text-green-500" /> : <Copy className="mr-2 h-4 w-4" />}
                Link kopieren
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => shareResource('twitter')}>Twitter</DropdownMenuItem>
              <DropdownMenuItem onClick={() => shareResource('linkedin')}>LinkedIn</DropdownMenuItem>
              <DropdownMenuSeparator />
              {canModify && (
                <>
                  <DropdownMenuItem onClick={() => onEdit(resource)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Bearbeiten
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDelete(resource.id)} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Löschen
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>

        <CardContent className="p-0 flex-1 relative bg-muted/20">
          <div className="aspect-video w-full overflow-hidden relative">
            <ResourcePreview url={resource.url} type={resource.type} />
          </div>
        </CardContent>

        <CardFooter className="p-4 pt-3 flex items-center justify-between border-t border-border bg-card">
          <div className="flex items-center text-sm text-muted-foreground">
            <span className="truncate max-w-[150px]">
              {resource.author.name || "Unbekannt"}
            </span>
          </div>
          <Button size="sm" variant="outline" className="gap-2 h-8" asChild>
            <a href={resource.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
              Öffnen
            </a>
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

function getIcon(type: ResourceType) {
  const props = { className: "h-4 w-4" };
  switch (type) {
    case ResourceType.ARTICLE: return <File {...props} />;
    case ResourceType.VIDEO: return <Video {...props} />;
    case ResourceType.EBOOK: return <Book {...props} />;
    case ResourceType.PODCAST: return <LinkIcon {...props} />;
    case ResourceType.COURSE: return <Book {...props} />;
    default: return <LinkIcon {...props} />;
  }
}

