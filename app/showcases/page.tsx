// app/showcases/page.tsx

"use client";

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
import { motion, AnimatePresence } from 'framer-motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSession } from 'next-auth/react';
import { Editor } from "@/components/Editor";
import { SanitizedHtml } from '@/components/SanitizedHtml';

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

const defaultDescription = `<h2>🎯 Projektziel</h2>
<p>Beschreibe kurz das Hauptziel deines Projekts...</p>

<h2>💡 Besondere Features</h2>
<ul>
<li>Feature 1: ...</li>
<li>Feature 2: ...</li>
<li>Feature 3: ...</li>
</ul>

<h2>🛠️ Technologie-Stack</h2>
<ul>
<li>Frontend: ...</li>
<li>Backend: ...</li>
<li>Datenbank: ...</li>
<li>Weitere Tools: ...</li>
</ul>

<h2>🌟 Was macht dein Projekt besonders?</h2>
<p>Erkläre, was dein Projekt von anderen abhebt...</p>

<h2>🔜 Nächste Schritte</h2>
<p>Welche Features oder Verbesserungen sind als nächstes geplant?</p>`;

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
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Fetch all projects
  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) {
        throw new Error('Fehler beim Abrufen der Projekte.');
      }
      const data: Project[] = await res.json();
      setProjects(data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  }

  useEffect(() => {
    fetchProjects();
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
    if (!session) {
      alert('Bitte melde dich an, um einen Kommentar hinzuzufügen.');
      return;
    }

    if (!commentContent.trim()) {
      alert('Kommentar darf nicht leer sein.');
      return;
    }

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
      setCommentContent('');
    } catch (error: any) {
      console.error('Error adding comment:', error);
      alert(error.message || 'Fehler beim Hinzufügen des Kommentars.');
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
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header improvements */}
        <header className="bg-white/80 backdrop-blur-sm dark:bg-gray-800/80 shadow-lg z-10 sticky top-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 ml-12 lg:ml-0 flex items-center">
              <Briefcase className="mr-3 h-7 w-7" />
              Projekte-Showcase
            </h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Suche nach Projekten..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-64 rounded-full"
                />
              </div>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {/* Filter and sort improvements */}
          <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 mb-6 shadow-sm">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList>
                  {categories.map((category) => (
                    <TabsTrigger key={category} value={category} className="capitalize">
                      {category}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="icon"
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
                <Filter className="h-5 w-5 text-gray-500" />
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[180px]">
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
                    <Link href={`/projects/${project.id}`}>
                      <Card className="h-full transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
                        <CardHeader className="relative p-0 overflow-hidden rounded-t-xl">
                          {project.imageUrl ? (
                            <div className="relative h-48 overflow-hidden">
                              <Image
                                src={project.imageUrl}
                                alt={`${project.title} Vorschaubild`}
                                className="w-full h-full object-cover transform transition-transform duration-500 group-hover:scale-110"
                                fill
                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            </div>
                          ) : (
                            <div
                              className="h-48 transform transition-transform duration-500 group-hover:scale-110"
                              style={{
                                background: `linear-gradient(135deg, ${project.gradientFrom}, ${project.gradientTo})`,
                              }}
                            />
                          )}
                          <div className="absolute top-2 right-2 flex gap-2">
                            {project.tags.map(tag => (
                              <Badge
                                key={tag.id}
                                variant="secondary"
                                className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm shadow-sm"
                              >
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                        </CardHeader>

                        <CardContent className="p-5 space-y-4">
                          <div>
                            <CardTitle className="text-xl font-bold mb-2 line-clamp-1">
                              {project.title}
                            </CardTitle>
                            <SanitizedHtml
                              html={project.description}
                              className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 prose dark:prose-invert"
                            />
                          </div>

                          <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                            <div className="flex items-center space-x-3">
                              <Avatar className="ring-2 ring-white dark:ring-gray-800">
                                <AvatarImage src={project.author.image || undefined} />
                                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500">
                                  {project.author.name?.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="space-y-1">
                                <p className="text-sm font-medium leading-none">
                                  {project.author.name}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {new Date(project.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-4">
                              <button
                                className={`flex items-center space-x-1 transition-colors ${project.likes.some(like => like.userId === session?.user.id)
                                  ? 'text-blue-500'
                                  : 'text-gray-500 hover:text-blue-500'
                                  }`}
                                onClick={(e) => {
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

                              <div className="flex items-center space-x-1 text-gray-500">
                                <MessageSquare className="h-4 w-4" />
                                <span>{project.comments.length}</span>
                              </div>
                              {session?.user?.id === project.author.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20"
                                  onClick={(e) => handleDeleteClick(e, project)}
                                >
                                  <Trash className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
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
                    <Link href={`/projects/${project.id}`}>
                      <Card className="transform transition-all duration-300 hover:shadow-lg bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
                        <CardContent className="p-4">
                          <div className="flex items-start space-x-4">
                            <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                              {project.imageUrl ? (
                                <Image
                                  src={project.imageUrl}
                                  alt={project.title}
                                  className="w-full h-full object-cover"
                                  fill
                                  sizes="64px"
                                />
                              ) : (
                                <div
                                  className="w-full h-full"
                                  style={{
                                    background: `linear-gradient(135deg, ${project.gradientFrom}, ${project.gradientTo})`,
                                  }}
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                  {project.title}
                                </h3>
                                <div className="flex items-center space-x-2">
                                  <div className="flex items-center space-x-4">
                                    <span className="flex items-center space-x-1 text-gray-500">
                                      <ThumbsUp className="h-4 w-4" />
                                      <span>{project.likes.length}</span>
                                    </span>
                                    <span className="flex items-center space-x-1 text-gray-500">
                                      <MessageSquare className="h-4 w-4" />
                                      <span>{project.comments.length}</span>
                                    </span>
                                  </div>
                                  {session?.user?.id === project.author.id && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20"
                                      onClick={(e) => handleDeleteClick(e, project)}
                                    >
                                      <Trash className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <SanitizedHtml
                                html={project.description}
                                className="mt-1 text-sm text-gray-600 dark:text-gray-300 line-clamp-2 prose dark:prose-invert"
                              />
                              <div className="mt-2 flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage src={project.author.image || undefined} />
                                    <AvatarFallback>
                                      {project.author.name?.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm text-gray-500">
                                    {project.author.name}
                                  </span>
                                </div>
                                <div className="flex gap-2">
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
                    </Link>
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
        <DialogContent className="sm:max-w-[800px] p-0 overflow-hidden">
          <div className="relative h-[300px]">
            {selectedProject?.imageUrl ? (
              <Image
                src={selectedProject.imageUrl}
                alt={selectedProject.title}
                className="w-full h-full object-cover"
                fill
                sizes="(max-width: 768px) 100vw, 800px"
              />
            ) : (
              <div
                className="w-full h-full"
                style={{
                  background: selectedProject
                    ? `linear-gradient(135deg, ${selectedProject.gradientFrom}, ${selectedProject.gradientTo})`
                    : '',
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
            <DialogTitle className="absolute bottom-6 left-6 text-3xl font-bold text-white">
              {selectedProject?.title}
            </DialogTitle>
          </div>

          <div className="p-6 space-y-6">
            <p className="text-gray-700 dark:text-gray-300">{selectedProject?.description}</p>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedProject?.author.image || undefined} />
                  <AvatarFallback>{selectedProject?.author.name ? selectedProject.author.name.charAt(0) : 'U'}</AvatarFallback>
                </Avatar>
                <span className="text-md font-medium text-gray-800 dark:text-gray-200">{selectedProject?.author.name}</span>
              </div>
              <div className="flex items-center space-x-6">
                <span className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                  <ThumbsUp className="h-5 w-5 mr-1" />
                  {selectedProject?.likes.length}
                </span>
                <span className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                  <MessageSquare className="h-5 w-5 mr-1" />
                  {selectedProject?.comments.length}
                </span>
              </div>
            </div>
            {/* Kommentare anzeigen */}
            <div className="mt-6">
              <h3 className="text-xl font-semibold mb-3">Kommentare</h3>
              {selectedProject?.comments.map(comment => (
                <div key={comment.id} className="mb-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <div className="flex items-center space-x-3 mb-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={comment.author.image || undefined} />
                      <AvatarFallback>{comment.author.name ? comment.author.name.charAt(0) : 'U'}</AvatarFallback>
                    </Avatar>
                    <div>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{comment.author.name}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{new Date(comment.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <p className="text-gray-700 dark:text-gray-300 ml-11">{comment.content}</p>
                </div>
              ))}
            </div>
            {/* Kommentar hinzufügen */}
            {session && selectedProject && (
              <div className="mt-6">
                <h4 className="text-lg font-semibold mb-2">Einen Kommentar hinzufügen</h4>
                <Textarea
                  placeholder="Dein Kommentar..."
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                />
                <Button className="mt-3 px-6 py-2">Kommentar hinzufügen</Button>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-6">
            <Button asChild>
              <a href={selectedProject?.link} target="_blank" rel="noopener noreferrer" className="flex items-center">
                Projekt ansehen <ExternalLink className="ml-2 h-5 w-5" />
              </a>
            </Button>
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
                Teile dein Projekt mit der Community. Fülle alle erforderlichen Felder aus und stelle sicher,
                dass deine Projektbeschreibung aussagekräftig ist.
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
                    placeholder="Ein aussagekräftiger Titel für dein Projekt"
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
                          onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                        />
                        <Button
                          type="button"
                          onClick={handleAddTag}
                          variant="outline"
                          className="h-11 px-6"
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
                  className="h-11 px-6"
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-11 px-8"
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
          <DialogContent className="sm:max-w-[625px]">
            <DialogHeader>
              <DialogTitle>Projekt bearbeiten</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); handleSubmitEditProject() }} encType="multipart/form-data">
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-title" className="text-right">
                    Titel
                  </Label>
                  <Input
                    id="edit-title"
                    value={editProjectData.title}
                    onChange={(e) => setEditProjectData({ ...editProjectData, title: e.target.value })}
                    className="col-span-3"
                    placeholder="Projekt Titel"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-description" className="text-right">
                    Beschreibung
                  </Label>
                  <Textarea
                    id="edit-description"
                    value={editProjectData.description}
                    onChange={(e) => setEditProjectData({ ...editProjectData, description: e.target.value })}
                    className="col-span-3"
                    placeholder="Projekt Beschreibung"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-category" className="text-right">
                    Kategorie
                  </Label>
                  <Input
                    id="edit-category"
                    value={editProjectData.category}
                    onChange={(e) => setEditProjectData({ ...editProjectData, category: e.target.value })}
                    className="col-span-3"
                    placeholder="Projekt Kategorie"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-tags" className="text-right">
                    Tags
                  </Label>
                  <Input
                    id="edit-tags"
                    value={editProjectData.tags.join(', ')}
                    onChange={(e) => setEditProjectData({ ...editProjectData, tags: e.target.value.split(',').map(tag => tag.trim()) })}
                    className="col-span-3"
                    placeholder="Trennen Sie Tags mit Kommas"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-link" className="text-right">
                    Projekt-Link
                  </Label>
                  <Input
                    id="edit-link"
                    value={editProjectData.link}
                    onChange={(e) => setEditProjectData({ ...editProjectData, link: e.target.value })}
                    className="col-span-3"
                    placeholder="https://github.com/..."
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="edit-image" className="text-right">
                    Vorschaubild
                  </Label>
                  <div className="col-span-3">
                    <label htmlFor="edit-image-upload" className="flex items-center justify-center w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm bg-white dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none">
                      <Upload className="mr-2 h-5 w-5 text-gray-400" />
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
                      className="hidden"
                    />
                    {editProjectData.image && (
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
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
    </div>
  );
}
