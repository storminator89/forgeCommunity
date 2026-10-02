// app/showcases/page.tsx

"use client";

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Für Navigation
import Link from 'next/link'; // Für Links
import Image from 'next/image';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Briefcase, ThumbsUp, MessageSquare, ExternalLink, Filter, Plus, Edit, Trash, Upload, ZoomIn } from 'lucide-react';
import { motion, AnimatePresence } from '@/lib/motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSession } from 'next-auth/react';
import { Editor } from "@/components/Editor";
import { sanitizeTextPreview, sanitizeRichHtml } from '@/lib/sanitize-html';
import { getSafeHttpUrl } from '@/lib/security';


interface Tag {
  id: string;
  name: string;
}

interface Author {
  id: string;
  name: string;
  image?: string;
}

interface ProjectComment {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: Author;
}

interface LikeProject {
  id: string;
  createdAt: string;
  userId: string;
  projectId: string;
}

interface Project {
  id: string;
  title: string;
  description: string;
  category: string;
  link: string;
  imageUrl?: string;
  gradientFrom: string;
  gradientTo: string;
  createdAt: string;
  updatedAt: string;
  author: Author;
  tags: Tag[];
  likes: LikeProject[];
  comments: ProjectComment[];
}

async function loadProjects(signal: AbortSignal): Promise<Project[]> {
  const projects: Project[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`/api/projects?page=${page}`, { signal });
    if (!res.ok) throw new Error('Fehler beim Abrufen der Projekte.');
    const batch = (await res.json()) as Project[];
    projects.push(...batch);
    if (batch.length < 50) return projects;
  }
}

const defaultDescription = '';

export default function ProjectShowcase() {
  const { data: session } = useSession();
  const router = useRouter(); // Initialisieren des Routers
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [projects, setProjects] = useState<Project[]>([]);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const safeSelectedProjectLink = selectedProject ? getSafeHttpUrl(selectedProject.link) : null;
  const [newProject, setNewProject] = useState<{
    title: string,
    description: string,
    category: string,
    tags: string[],
    link: string,
    image: File | null,
  }>({
    title: '',
    description: defaultDescription,
    category: '',
    tags: [],
    link: '',
    image: null,
  });
  const [editProjectData, setEditProjectData] = useState<{
    title: string,
    description: string,
    category: string,
    tags: string[],
    link: string,
    image: File | null,
  }>({
    title: '',
    description: '',
    category: '',
    tags: [],
    link: '',
    image: null,
  });
  const [commentContent, setCommentContent] = useState('');
  const [currentTag, setCurrentTag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCommenting, setIsCommenting] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void loadProjects(controller.signal)
      .then((data) => {
        if (active) setProjects(data);
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        console.error('Error fetching projects:', error);
        setLoadError('Die Projekte konnten nicht geladen werden. Bitte lade die Seite erneut.');
      })
      .finally(() => { if (active) setIsLoading(false); });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  // Filter and sort projects
  const filteredProjects = projects.filter(project =>
    (activeTab === 'all' || project.tags.some(tag => tag.name.toLowerCase() === activeTab.toLowerCase())) &&
    (project.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.tags.some(tag => tag.name.toLowerCase().includes(searchTerm.toLowerCase())))
  ).sort((a, b) => {
    if (sortBy === 'mostLiked') return b.likes.length - a.likes.length;
    if (sortBy === 'mostCommented') return b.comments.length - a.comments.length;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // 'newest' as default
  });

  const categories = ['all', ...Array.from(new Set(projects.flatMap(project => project.tags.map(tag => tag.name))))];

  // Handle project submission
  const handleSubmitNewProject = async () => {
    if (!newProject.title || !newProject.description || !newProject.category || !newProject.link) {
      alert('Bitte fülle alle erforderlichen Felder aus.');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('title', newProject.title);
      formData.append('description', newProject.description);
      formData.append('category', newProject.category);
      formData.append('tags', newProject.tags.join(','));
      formData.append('link', newProject.link);
      if (newProject.image) {
        formData.append('image', newProject.image);
      }

      const res = await fetch('/api/projects', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Einreichen des Projekts.');
      }

      const createdProject: Project = await res.json();
      setProjects([createdProject, ...projects]);
      setIsSubmitDialogOpen(false);
      setNewProject({
        title: '',
        description: defaultDescription,
        category: '',
        tags: [],
        link: '',
        image: null,
      });
    } catch (error: any) {
      console.error('Error submitting project:', error);
      alert(error.message || 'Fehler beim Einreichen des Projekts.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle like
  const handleLike = async (projectId: string) => {
    if (!session) {
      alert('Bitte melde dich an, um zu liken.');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/like`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Liken des Projekts.');
      }

      // Aktualisiere das Projekt in der Liste
      const newLike: LikeProject = await res.json();
      setProjects(projects.map(project => {
        if (project.id === projectId) {
          return { ...project, likes: [...project.likes, newLike] };
        }
        return project;
      }));
    } catch (error: any) {
      console.error('Error liking project:', error);
      alert(error.message || 'Fehler beim Liken des Projekts.');
    }
  }

  // Handle unlike
  const handleUnlike = async (projectId: string) => {
    if (!session) {
      alert('Bitte melde dich an, um zu entliken.');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/like`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Entliken des Projekts.');
      }

      // Aktualisiere das Projekt in der Liste
      const removedLike: { id: string } = await res.json();
      setProjects(projects.map(project => {
        if (project.id === projectId) {
          return { ...project, likes: project.likes.filter(like => like.id !== removedLike.id) };
        }
        return project;
      }));
    } catch (error: any) {
      console.error('Error unliking project:', error);
      alert(error.message || 'Fehler beim Entliken des Projekts.');
    }
  }

  // Handle adding a comment
  const handleAddComment = async (projectId: string) => {
    if (isCommenting) return;
    if (!session) {
      alert('Bitte melde dich an, um einen Kommentar hinzuzufügen.');
      return;
    }

    if (!commentContent.trim()) {
      alert('Kommentar darf nicht leer sein.');
      return;
    }

    setIsCommenting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: commentContent }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Hinzufügen des Kommentars.');
      }

      const newComment: ProjectComment = await res.json();
      setSelectedProject((prev) => prev ? { ...prev, comments: [...prev.comments, newComment] } : prev);
      setProjects(prev => prev.map(project => project.id === projectId ? { ...project, comments: [...project.comments, newComment] } : project));
      setCommentContent('');
    } catch (error: any) {
      console.error('Error adding comment:', error);
      alert(error.message || 'Fehler beim Hinzufügen des Kommentars.');
    } finally {
      setIsCommenting(false);
    }
  }

  // Handle editing a project
  const handleOpenEditDialog = (project: Project) => {
    setProjectToEdit(project);
    setEditProjectData({
      title: project.title,
      description: project.description,
      category: project.category,
      tags: project.tags.map(tag => tag.name),
      link: project.link,
      image: null,
    });
    setIsEditDialogOpen(true);
  }

  const handleSubmitEditProject = async () => {
    if (!projectToEdit) return;

    const { title, description, category, tags, link, image } = editProjectData;

    if (!title || !description || !category || !link) {
      alert('Bitte fülle alle erforderlichen Felder aus.');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('category', category);
      formData.append('tags', tags.join(','));
      formData.append('link', link);
      if (image) {
        formData.append('image', image);
      }

      const res = await fetch(`/api/projects/${projectToEdit.id}`, {
        method: 'PUT',
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Bearbeiten des Projekts.');
      }

      const updatedProject: Project = await res.json();
      setProjects(projects.map(project => project.id === updatedProject.id ? updatedProject : project));
      setIsEditDialogOpen(false);
      setProjectToEdit(null);
    } catch (error: any) {
      console.error('Error editing project:', error);
      alert(error.message || 'Fehler beim Bearbeiten des Projekts.');
    }
  }

  // Handle deleting a project
  const handleOpenDeleteDialog = (project: Project) => {
    setProjectToDelete(project);
    setIsDeleteDialogOpen(true);
  }

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      const res = await fetch(`/api/projects/${projectToDelete.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Löschen des Projekts.');
      }

      // Entferne das Projekt aus der Liste
      setProjects(projects.filter(project => project.id !== projectToDelete.id));
      setIsDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error: any) {
      console.error('Error deleting project:', error);
      alert(error.message || 'Fehler beim Löschen des Projekts.');
    }
  }

  const handleAddTag = () => {
    if (!currentTag.trim()) return;
    setNewProject({ ...newProject, tags: [...newProject.tags, currentTag] });
    setCurrentTag('');
  }

  const handleDeleteClick = (e: React.MouseEvent, project: Project) => {
    e.preventDefault(); // Prevent navigation
    e.stopPropagation(); // Prevent event bubbling
    setProjectToDelete(project);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;

    try {
      const res = await fetch(`/api/projects/${projectToDelete.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Fehler beim Löschen des Projekts');
      }

      setProjects(projects.filter(p => p.id !== projectToDelete.id));
      setIsDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('Fehler beim Löschen des Projekts');
    }
  };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header improvements */}
        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center">
              <Briefcase className="mr-3 h-7 w-7" />
              Projekte-Showcase
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Suche nach Projekten…"
                  aria-label="Projekte durchsuchen"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full sm:w-64 rounded-full"
                />
              </div>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          {/* Filter and sort improvements */}
          <div className="bg-card rounded-xl border p-4 mb-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="flex h-auto flex-wrap justify-start gap-1">
                  {categories.map((category) => (
                    <TabsTrigger key={category} value={category} className="capitalize">
                      {category === 'all' ? 'Alle' : category}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Rasteransicht"
                    aria-pressed={viewMode === 'grid'}
                    onClick={() => setViewMode('grid')}
                    className={viewMode === 'grid' ? 'bg-primary/10' : ''}
                  >
                    <div className="grid grid-cols-2 gap-0.5">
                      <div className="w-1.5 h-1.5 rounded-sm bg-current" />
                      <div className="w-1.5 h-1.5 rounded-sm bg-current" />
                      <div className="w-1.5 h-1.5 rounded-sm bg-current" />
                      <div className="w-1.5 h-1.5 rounded-sm bg-current" />
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Listenansicht"
                    aria-pressed={viewMode === 'list'}
                    onClick={() => setViewMode('list')}
                    className={viewMode === 'list' ? 'bg-primary/10' : ''}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="w-4 h-0.5 rounded-sm bg-current" />
                      <div className="w-4 h-0.5 rounded-sm bg-current" />
                      <div className="w-4 h-0.5 rounded-sm bg-current" />
                    </div>
                  </Button>
                </div>
                <Filter className="h-5 w-5 text-muted-foreground" />
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[180px]" aria-label="Projekte sortieren nach">
                    <SelectValue placeholder="Sortieren nach" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Neueste</SelectItem>
                    <SelectItem value="mostLiked">Meist geliked</SelectItem>
                    <SelectItem value="mostCommented">Meist kommentiert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {session && (
            <Button
              onClick={() => setIsSubmitDialogOpen(true)}
              className="mb-6 flex items-center"
            >
              <Plus className="mr-2 h-4 w-4" /> Neues Projekt einreichen
            </Button>
          )}
          {isLoading ? (
            <div role="status" className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" aria-label="Projekte werden geladen">
              {[0, 1, 2].map(key => <div key={key} className="h-80 animate-pulse rounded-xl bg-muted" />)}
            </div>
          ) : loadError ? (
            <Card><CardContent role="alert" className="py-10 text-center"><p>{loadError}</p><Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>Erneut laden</Button></CardContent></Card>
          ) : filteredProjects.length === 0 ? (
            <Card><CardContent className="py-12 text-center"><Briefcase className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="text-lg font-semibold">Keine Projekte gefunden</h3><p className="mt-2 text-muted-foreground">Passe deine Suche an oder reiche ein Projekt ein.</p>{(searchTerm || activeTab !== 'all') && <Button variant="outline" className="mt-4" onClick={() => { setSearchTerm(''); setActiveTab('all'); }}>Filter zurücksetzen</Button>}</CardContent></Card>
          ) : null}
          <AnimatePresence>
            {viewMode === 'grid' ? (
              <motion.div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {filteredProjects.map((project) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                    className="group relative"
                  >
                    <div className="relative h-full">
                      <Card className="h-full transition-colors hover:border-primary/40">
                        {project.imageUrl && (
                          <CardHeader className="relative p-0 overflow-hidden rounded-t-xl">
                            <div className="relative h-48 overflow-hidden">
                              <Image src={project.imageUrl} alt={`${project.title} Vorschaubild`} className="w-full h-full object-cover" fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" />
                            </div>
                          </CardHeader>
                        )}
                        <CardContent className="p-5 space-y-4">
                          {project.tags.length > 0 && <div className="flex flex-wrap gap-2">{project.tags.map(tag => <Badge key={tag.id} variant="secondary">{tag.name}</Badge>)}</div>}
                          <div>
                            <CardTitle className="text-xl font-bold mb-2 line-clamp-1">
                              <Link href={`/projects/${project.id}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{project.title}</Link>
                            </CardTitle>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {sanitizeTextPreview(project.description, 180)}
                              </p>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border">
                            <div className="flex items-center space-x-3">
                              <Avatar >
                                <AvatarImage src={project.author.image || undefined} />
                                <AvatarFallback className="bg-muted text-muted-foreground">
                                  {project.author.name?.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="space-y-1">
                                <p className="text-sm font-medium leading-none">
                                  {project.author.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(project.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                className={`relative z-10 flex items-center space-x-1 rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors ${project.likes.some(like => like.userId === session?.user.id)
                                  ? 'text-blue-500'
                                  : 'text-muted-foreground hover:text-blue-500'
                                  }`}
                                aria-label={project.likes.some(like => like.userId === session?.user.id) ? 'Gefällt mir zurücknehmen' : 'Projekt gefällt mir'}
                                aria-pressed={project.likes.some(like => like.userId === session?.user.id)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation(); // Verhindert das Navigieren zur Detailseite
                                  const userLike = project.likes.find(like => like.userId === session?.user.id);
                                  if (userLike) {
                                    handleUnlike(project.id);
                                  } else {
                                    handleLike(project.id);
                                  }
                                }}
                              >
                                <ThumbsUp className="h-4 w-4" />
                                <span>{project.likes.length}</span>
                              </button>

                              <div className="flex items-center space-x-1 text-muted-foreground">
                                <MessageSquare className="h-4 w-4" />
                                <span>{project.comments.length}</span>
                              </div>
                              {session?.user?.id === project.author.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Projekt „${project.title}“ löschen`}
                                  className="relative z-10 text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20"
                                  onClick={(e) => handleDeleteClick(e, project)}
                                >
                                  <Trash className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                className="space-y-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {filteredProjects.map((project) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="relative h-full">
                      <Card className="transition-colors hover:border-primary/40">
                        <CardContent className="p-4">
                          <div className="flex items-start space-x-4">
                            {project.imageUrl && (
                              <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                                <Image src={project.imageUrl} alt={project.title} className="w-full h-full object-cover" fill sizes="64px" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-lg font-semibold text-foreground">
                                  <Link href={`/projects/${project.id}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{project.title}</Link>
                                </h3>
                                <div className="flex items-center space-x-2">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="flex items-center space-x-1 text-muted-foreground">
                                      <ThumbsUp className="h-4 w-4" />
                                      <span>{project.likes.length}</span>
                                    </span>
                                    <span className="flex items-center space-x-1 text-muted-foreground">
                                      <MessageSquare className="h-4 w-4" />
                                      <span>{project.comments.length}</span>
                                    </span>
                                  </div>
                                  {session?.user?.id === project.author.id && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Projekt „${project.title}“ löschen`}
                                  className="relative z-10 text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20"
                                      onClick={(e) => handleDeleteClick(e, project)}
                                    >
                                      <Trash className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                                  {sanitizeTextPreview(project.description, 180)}
                                </p>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center space-x-2">
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage src={project.author.image || undefined} />
                                    <AvatarFallback>
                                      {project.author.name?.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm text-muted-foreground">
                                    {project.author.name}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {project.tags.map(tag => (
                                    <Badge
                                      key={tag.id}
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      {tag.name}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Delete Confirmation Dialog */}
          <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Projekt löschen</DialogTitle>
                <p className="text-sm text-muted-foreground">
                  Bist du sicher, dass du dieses Projekt löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
                </p>
              </DialogHeader>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                  Abbrechen
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteConfirm}
                >
                  Löschen
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </main>
      </div>

      {/* Projekt-Details Dialog */}
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
        <DialogContent className="sm:max-w-[800px] max-h-[90dvh] p-0 overflow-y-auto">
          <div className={selectedProject?.imageUrl ? 'relative h-[300px]' : 'p-6 pb-0'}>
            {selectedProject?.imageUrl ? (
              <Image
                src={selectedProject.imageUrl}
                alt={selectedProject.title}
                className="w-full h-full object-cover"
                fill
                sizes="(max-width: 768px) 100vw, 800px"
              />
            ) : null}
            {selectedProject?.imageUrl && <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />}
            <DialogTitle className={`text-2xl font-semibold ${selectedProject?.imageUrl ? 'absolute bottom-6 left-6 right-6 text-white' : 'text-foreground'}`}>
              {selectedProject?.title}
            </DialogTitle>
          </div>

          <div className="p-6 space-y-6">
            <div className="prose dark:prose-invert max-w-none break-words" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(selectedProject?.description || '') }} />
            <div className="flex flex-wrap gap-2">
              {selectedProject?.tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="capitalize"
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedProject?.author.image || undefined} />
                  <AvatarFallback>{selectedProject?.author.name ? selectedProject.author.name.charAt(0) : 'U'}</AvatarFallback>
                </Avatar>
                <span className="text-md font-medium text-foreground">{selectedProject?.author.name}</span>
              </div>
              <div className="flex items-center space-x-6">
                <span className="flex items-center text-sm text-muted-foreground">
                  <ThumbsUp className="h-5 w-5 mr-1" />
                  {selectedProject?.likes.length}
                </span>
                <span className="flex items-center text-sm text-muted-foreground">
                  <MessageSquare className="h-5 w-5 mr-1" />
                  {selectedProject?.comments.length}
                </span>
              </div>
            </div>
            {/* Kommentare anzeigen */}
            <div className="mt-6">
              <h3 className="text-xl font-semibold mb-3">Kommentare</h3>
              {selectedProject?.comments.map(comment => (
                <div key={comment.id} className="mb-4 p-3 bg-muted rounded-lg">
                  <div className="flex items-center space-x-3 mb-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={comment.author.image || undefined} />
                      <AvatarFallback>{comment.author.name ? comment.author.name.charAt(0) : 'U'}</AvatarFallback>
                    </Avatar>
                    <div>
                      <span className="text-sm font-medium text-foreground">{comment.author.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{new Date(comment.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <p className="text-foreground dark:text-muted-foreground ml-11">{comment.content}</p>
                </div>
              ))}
            </div>
            {/* Kommentar hinzufügen */}
            {session && selectedProject && (
              <div className="mt-6">
                <h4 className="text-lg font-semibold mb-2">Einen Kommentar hinzufügen</h4>
                <Textarea
                  aria-label="Dein Kommentar zum Projekt"
                  placeholder="Dein Kommentar…"
                  className="w-full p-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-card dark:text-foreground"
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                />
                <Button className="mt-3 px-6 py-2" onClick={() => handleAddComment(selectedProject.id)} disabled={isCommenting || !commentContent.trim()}>{isCommenting ? 'Wird gesendet…' : 'Kommentar hinzufügen'}</Button>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-6">
            {safeSelectedProjectLink && (
              <Button asChild>
                <a href={safeSelectedProjectLink} target="_blank" rel="noopener noreferrer" className="flex items-center">
                  Projekt ansehen <ExternalLink className="ml-2 h-5 w-5" />
                </a>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Neues Projekt Einreichen Dialog */}
      {session && (
        <Dialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
          <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto p-6">
            <DialogHeader className="space-y-3 pb-4 border-b">
              <DialogTitle className="text-2xl font-bold">Neues Projekt einreichen</DialogTitle>
              <p className="text-muted-foreground text-sm">
                Titel, Beschreibung, Kategorie und Link sind erforderlich.
              </p>
            </DialogHeader>

            <form onSubmit={(e) => { e.preventDefault(); handleSubmitNewProject() }} className="space-y-8 pt-4">
              <div className="space-y-6">
                {/* Titel Section */}
                <div className="space-y-2">
                  <Label htmlFor="title" className="text-base font-semibold">
                    Titel <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="title"
                    value={newProject.title}
                    onChange={(e) => setNewProject({ ...newProject, title: e.target.value })}
                    placeholder="Projekttitel"
                    className="h-11"
                    required
                  />
                </div>

                {/* Description Section */}
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-base font-semibold">
                    Beschreibung <span className="text-red-500">*</span>
                  </Label>
                  <div className="min-h-[250px] relative border rounded-md">
                    <Editor
                      content={newProject.description}
                      onChange={(content: string) => setNewProject({ ...newProject, description: content })}
                      className="min-h-[200px]"
                    />
                  </div>
                </div>

                {/* Category and Tags Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Category Section */}
                  <div className="space-y-2">
                    <Label htmlFor="category" className="text-base font-semibold">
                      Kategorie <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={newProject.category}
                      onValueChange={(value) => setNewProject({ ...newProject, category: value })}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Wähle eine Kategorie" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Webentwicklung">Webentwicklung</SelectItem>
                        <SelectItem value="Mobile App Entwicklung">Mobile App Entwicklung</SelectItem>
                        <SelectItem value="Künstliche Intelligenz">Künstliche Intelligenz</SelectItem>
                        <SelectItem value="Machine Learning">Machine Learning</SelectItem>
                        <SelectItem value="Data Science">Data Science</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Tags Section */}
                  <div className="space-y-2">
                    <Label htmlFor="tags" className="text-base font-semibold">
                      Tags
                    </Label>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          id="tags"
                          value={currentTag}
                          onChange={(e) => setCurrentTag(e.target.value)}
                          placeholder="Tag eingeben und Enter drücken"
                          className="h-11"
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                        />
                        <Button
                          type="button"
                          aria-label="Tag hinzufügen"
                          onClick={handleAddTag}
                          variant="outline"
                          className="h-auto min-h-11 px-4 whitespace-normal"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {newProject.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="px-3 py-1 text-sm flex items-center gap-1 bg-secondary/30"
                          >
                            {tag}
                            <button
                              type="button"
                              aria-label={`Tag ${tag} entfernen`}
                              onClick={() => setNewProject({
                                ...newProject,
                                tags: newProject.tags.filter(t => t !== tag)
                              })}
                              className="hover:text-red-500 transition-colors"
                            >
                              ×
                            </button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Link and Image Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Link Section */}
                  <div className="space-y-2">
                    <Label htmlFor="link" className="text-base font-semibold">
                      Projekt-Link <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="link"
                      value={newProject.link}
                      onChange={(e) => setNewProject({ ...newProject, link: e.target.value })}
                      placeholder="https://..."
                      className="h-11"
                      required
                    />
                  </div>

                  {/* Image Section */}
                  <div className="space-y-2">
                    <Label htmlFor="image" className="text-base font-semibold">
                      Vorschaubild
                    </Label>
                    <div className="relative">
                      <Input
                        id="image"
                        type="file"
                        onChange={(e) => setNewProject({
                          ...newProject,
                          image: e.target.files ? e.target.files[0] : null
                        })}
                        accept="image/*"
                        className="h-11 cursor-pointer file:cursor-pointer file:mr-4"
                      />
                    </div>
                    {newProject.image && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Ausgewählt: {newProject.image.name}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsSubmitDialogOpen(false)}
                  className="h-auto min-h-11 px-4 whitespace-normal"
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-auto min-h-11 px-4 whitespace-normal"
                >
                  {isSubmitting ? (
                    <>
                      <span className="mr-2">Wird eingereicht...</span>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </>
                  ) : (
                    'Projekt einreichen'
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Projekt Bearbeiten Dialog */}
      {projectToEdit && (
        <Dialog open={isEditDialogOpen} onOpenChange={() => { setIsEditDialogOpen(false); setProjectToEdit(null); }}>
          <DialogContent className="sm:max-w-[625px] max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Projekt bearbeiten</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); handleSubmitEditProject() }} encType="multipart/form-data">
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-title" className="sm:text-right">
                    Titel
                  </Label>
                  <Input
                    id="edit-title"
                    value={editProjectData.title}
                    onChange={(e) => setEditProjectData({ ...editProjectData, title: e.target.value })}
                    className="sm:col-span-3"
                    placeholder="Projekt Titel"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-description" className="sm:text-right">
                    Beschreibung
                  </Label>
                  <Textarea
                    id="edit-description"
                    value={editProjectData.description}
                    onChange={(e) => setEditProjectData({ ...editProjectData, description: e.target.value })}
                    className="sm:col-span-3"
                    placeholder="Projekt Beschreibung"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-category" className="sm:text-right">
                    Kategorie
                  </Label>
                  <Input
                    id="edit-category"
                    value={editProjectData.category}
                    onChange={(e) => setEditProjectData({ ...editProjectData, category: e.target.value })}
                    className="sm:col-span-3"
                    placeholder="Projekt Kategorie"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-tags" className="sm:text-right">
                    Tags
                  </Label>
                  <Input
                    id="edit-tags"
                    value={editProjectData.tags.join(', ')}
                    onChange={(e) => setEditProjectData({ ...editProjectData, tags: e.target.value.split(',').map(tag => tag.trim()) })}
                    className="sm:col-span-3"
                    placeholder="Trennen Sie Tags mit Kommas"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-link" className="sm:text-right">
                    Projekt-Link
                  </Label>
                  <Input
                    id="edit-link"
                    value={editProjectData.link}
                    onChange={(e) => setEditProjectData({ ...editProjectData, link: e.target.value })}
                    className="sm:col-span-3"
                    placeholder="https://github.com/..."
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-image" className="sm:text-right">
                    Vorschaubild
                  </Label>
                  <div className="sm:col-span-3">
                    <label htmlFor="edit-image-upload" className="flex items-center justify-center w-full px-4 py-2 border border-border rounded-lg shadow-sm bg-card dark:bg-muted text-sm font-medium text-foreground hover:bg-accent">
                      <Upload className="mr-2 h-5 w-5 text-muted-foreground" />
                      {editProjectData.image ? editProjectData.image.name : 'Bild auswählen'}
                    </label>
                    <input
                      type="file"
                      id="edit-image-upload"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setEditProjectData({ ...editProjectData, image: file })
                        }
                      }}
                      className="sr-only"
                      aria-label="Vorschaubild auswählen"
                    />
                    {editProjectData.image && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Gewähltes Bild: {editProjectData.image.name}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit">Projekt aktualisieren</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Projekt Löschen Dialog */}
      {projectToDelete && (
        <Dialog open={isDeleteDialogOpen} onOpenChange={() => { setIsDeleteDialogOpen(false); setProjectToDelete(null); }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Projekt löschen</DialogTitle>
            </DialogHeader>
            <p>
              Bist du sicher, dass du das Projekt &quot;{projectToDelete.title}&quot; löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button variant="destructive" onClick={handleDeleteProject}>
                Löschen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}
