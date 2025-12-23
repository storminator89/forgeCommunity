"use client";

import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, MessageSquare, ExternalLink, Edit, Trash, Upload, Share2, Calendar, User, Tag } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import Image from 'next/image';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


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
  coverImage?: string;
  gradientFrom: string;
  gradientTo: string;
  createdAt: string;
  updatedAt: string;
  author: Author;
  tags: Tag[];
  likes: LikeProject[];
  comments: ProjectComment[];
}

export default function ProjectDetail(props: { params: Promise<{ projectId: string }> }) {
  const router = useRouter();
  const params = useParams();
  const { data: session } = useSession();
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isLiked, setIsLiked] = useState(false);

  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
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

  useEffect(() => {
    const fetchProject = async () => {
      if (!params?.projectId) {
        console.error("Kein projectId gefunden in der URL.");
        return;
      }
      try {
        const res = await fetch(`/api/projects/${params.projectId}`);
        if (!res.ok) {
          throw new Error('Projekt nicht gefunden.');
        }
        const data: Project = await res.json();
        setProject(data);
        // Set initial comments from project data
        setComments(data.comments || []);
        // Check if user has liked the project
        setIsLiked(data.likes?.some(like => like.userId === session?.user?.id) || false);
      } catch (error) {
        console.error('Error fetching project:', error);
        router.push('/showcases'); // Navigiere zurück zur Projektliste bei Fehler
      }
    }

    fetchProject();
  }, [params, router, session?.user?.id]);

  // Separate effect for loading comments
  useEffect(() => {
    const fetchComments = async () => {
      if (!params?.projectId) return;

      try {
        const res = await fetch(`/api/projects/${params.projectId}/comments`);
        if (!res.ok) {
          throw new Error('Fehler beim Laden der Kommentare.');
        }
        const data: ProjectComment[] = await res.json();
        setComments(data);
      } catch (error) {
        console.error('Error fetching comments:', error);
      }
    };

    fetchComments();
  }, [params?.projectId]);

  const handleLike = async () => {
    if (!session || !project) {
      alert('Bitte melde dich an, um zu liken.');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${project.id}/like`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Liken des Projekts.');
      }

      // Aktualisiere das Projekt in der Liste
      const newLike: LikeProject = await res.json();
      setProject(prev => prev ? { ...prev, likes: [...prev.likes, newLike] } : prev);
      setIsLiked(true);
    } catch (error: any) {
      console.error('Error liking project:', error);
      alert(error.message || 'Fehler beim Liken des Projekts.');
    }
  }

  const handleComment = async () => {
    if (!session || !project) {
      alert('Bitte melde dich an, um einen Kommentar hinzuzufügen.');
      return;
    }

    if (!newComment.trim()) {
      alert('Kommentar darf nicht leer sein.');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${project.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: newComment }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Hinzufügen des Kommentars.');
      }

      const addedComment: ProjectComment = await res.json();

      // Update both comments and project state
      setComments(prev => [...prev, addedComment]);
      setProject(prev => prev ? {
        ...prev,
        comments: [...prev.comments, addedComment]
      } : prev);

      setNewComment('');
    } catch (error: any) {
      console.error('Error adding comment:', error);
      alert(error.message || 'Fehler beim Hinzufügen des Kommentars.');
    }
  }

  const handleOpenEditDialog = () => {
    if (!project) return;
    setEditProjectData({
      title: project.title,
      description: project.description,
      category: project.category,
      tags: project.tags.map(tag => tag.name),
      link: project.link,
      image: null,
    });
    setIsEditDialogOpen(true);
  };

  const handleOpenDeleteDialog = () => {
    if (!project) return;
    setIsDeleteDialogOpen(true);
  };

  const handleSubmitEditProject = async () => {
    if (!project) return;

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

      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Bearbeiten des Projekts.');
      }

      const updatedProject: Project = await res.json();
      setProject(updatedProject);
      setIsEditDialogOpen(false);
    } catch (error: any) {
      console.error('Error updating project:', error);
      alert(error.message || 'Fehler beim Aktualisieren des Projekts.');
    }
  };

  const handleDeleteProject = async () => {
    if (!project) return;

    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Löschen des Projekts.');
      }

      router.push('/showcases');
    } catch (error: any) {
      console.error('Error deleting project:', error);
      alert(error.message || 'Fehler beim Löschen des Projekts.');
    }
  };

  const handleShare = async () => {
    if (!project) return;

    const shareData = {
      title: project.title,
      text: project.description,
      url: window.location.href
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        // Use Web Share API if available
        await navigator.share(shareData);
      } else {
        // Fallback to copying URL
        await navigator.clipboard.writeText(window.location.href);
        alert('Link wurde in die Zwischenablage kopiert!');
      }
    } catch (error) {
      console.error('Error sharing:', error);
      // If clipboard fails, show the URL to manually copy
      alert('Du kannst diese URL teilen: ' + window.location.href);
    }
  };



  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-card shadow-sm z-10 sticky top-0 border-b">
          <div className="container mx-auto px-6 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center">
                <div className="bg-primary/10 p-2 rounded-lg mr-3">
                  <Tag className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-foreground">Projekt-Detail</h1>
                  <p className="text-sm text-muted-foreground">Projektinformationen und Updates</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </div>
        </header>

        {/* Main scrollable content */}
        <div className="flex-1 overflow-y-auto bg-background">
          <AnimatePresence>
            {project && (
              <div className="container mx-auto py-6 px-4 max-w-5xl">
                {/* Project Header */}
                <div className="flex flex-col space-y-4 mb-8">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h1 className="text-4xl font-bold text-foreground mb-4">{project.title}</h1>
                      <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 mr-2" />
                          <span>
                            {new Date(project.createdAt).toLocaleDateString('de-DE', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <User className="w-4 h-4 mr-2" />
                          <span>{project.author?.name || 'Anonym'}</span>
                        </div>
                        <div className="flex items-center">
                          <Tag className="w-4 h-4 mr-2" />
                          <span>{project.category}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center"
                        onClick={() => handleShare()}
                      >
                        <Share2 className="w-4 h-4 mr-2" />
                        Teilen
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Project Image */}
                {project.imageUrl && (
                  <div className="mb-8 rounded-lg overflow-hidden bg-muted">
                    <Image
                      src={project.imageUrl}
                      alt={project.title}
                      width={1200}
                      height={600}
                      className="w-full object-cover"
                      priority
                    />
                  </div>
                )}

                {/* Project Content */}
                <div className="space-y-8">
                  {/* Description */}
                  <div className="prose dark:prose-invert prose-slate max-w-none">
                    <div
                      className="[&>h2]:text-2xl [&>h2]:font-bold [&>h2]:text-foreground [&>h2]:mt-8 [&>h2]:mb-4
                                 [&>p]:text-muted-foreground [&>p]:leading-relaxed [&>p]:mb-4
                                 [&>ul]:list-disc [&>ul]:pl-6 [&>ul]:mb-4 [&>ul]:text-muted-foreground
                                 [&>li]:mb-2
                                 [&_strong]:text-foreground [&_strong]:font-semibold
                                 [&_em]:text-muted-foreground [&_em]:italic
                                 [&>h2]:flex [&>h2]:items-center [&>h2]:gap-2
                                 [&>*:first-child]:mt-0"
                      dangerouslySetInnerHTML={{ __html: project.description }}
                    />
                  </div>

                  {/* Tags */}
                  <div className="space-y-3 pt-4 border-t">
                    <h3 className="text-lg font-semibold text-foreground">Tags</h3>
                    <div className="flex flex-wrap gap-2">
                      {project.tags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="secondary"
                          className="px-3 py-1.5 text-sm bg-secondary/50 hover:bg-secondary/70 transition-colors"
                        >
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Project Link */}
                  <div className="space-y-3 pt-4 border-t">
                    <h3 className="text-lg font-semibold text-foreground">Projekt Link</h3>
                    <a
                      href={project.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-primary hover:text-primary/80 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      {project.link}
                    </a>
                  </div>

                  {/* Interactions Section */}
                  <div className="pt-8 mt-8 border-t">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-2xl font-bold text-foreground">
                        Community Feedback
                      </h3>
                      <div className="flex items-center space-x-4">
                        <Button
                          variant={isLiked ? "default" : "outline"}
                          size="sm"
                          onClick={handleLike}
                          className="flex items-center space-x-2"
                        >
                          <ThumbsUp className="w-4 h-4" />
                          <span>{project.likes.length}</span>
                        </Button>
                      </div>
                    </div>

                    {/* Comments Section */}
                    <div className="space-y-6">
                      {session && (
                        <div className="space-y-4">
                          <Textarea
                            placeholder="Teile deine Gedanken..."
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            className="min-h-[100px] bg-background"
                          />
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              onClick={handleComment}
                              disabled={!newComment.trim()}
                            >
                              Kommentieren
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-4">
                        {project.comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="p-4 rounded-lg border bg-card"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={comment.author.image} />
                                <AvatarFallback>{comment.author.name[0]}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-foreground">{comment.author.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {new Date(comment.createdAt).toLocaleDateString('de-DE', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                  })}
                                </p>
                              </div>
                            </div>
                            <p className="text-foreground">{comment.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Projekt bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeite die Details deines Projekts. Klicke auf Speichern, wenn du fertig bist.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Titel</Label>
              <Input
                id="title"
                value={editProjectData.title}
                onChange={(e) => setEditProjectData(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                value={editProjectData.description}
                onChange={(e) => setEditProjectData(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="category">Kategorie</Label>
              <Input
                id="category"
                value={editProjectData.category}
                onChange={(e) => setEditProjectData(prev => ({ ...prev, category: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="tags">Tags (kommagetrennt)</Label>
              <Input
                id="tags"
                value={editProjectData.tags.join(', ')}
                onChange={(e) => setEditProjectData(prev => ({ ...prev, tags: e.target.value.split(',').map(tag => tag.trim()) }))}
              />
            </div>
            <div>
              <Label htmlFor="link">Link</Label>
              <Input
                id="link"
                value={editProjectData.link}
                onChange={(e) => setEditProjectData(prev => ({ ...prev, link: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="image">Bild</Label>
              <Input
                id="image"
                type="file"
                accept="image/*"
                onChange={(e) => setEditProjectData(prev => ({ ...prev, image: e.target.files?.[0] || null }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSubmitEditProject}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Projekt löschen</DialogTitle>
            <DialogDescription>
              Bist du sicher, dass du dieses Projekt löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={handleDeleteProject}>
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
