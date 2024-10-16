// app/projects/[projectId]/page.tsx

"use client";

import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, MessageSquare, ExternalLink, Edit, Trash, Upload } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle"; 
import { UserNav } from "@/components/user-nav"; 

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

export default function ProjectDetail() {
  const params = useParams();
  const projectId = params?.projectId;
  const { data: session } = useSession();
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [commentContent, setCommentContent] = useState('');
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
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
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  // Debugging: Überprüfen, ob projectId korrekt ist
  useEffect(() => {
    console.log("Project ID:", projectId);
  }, [projectId]);

  // Fetch project details
  const fetchProject = async () => {
    if (!projectId) {
      console.error("Kein projectId gefunden in der URL.");
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) {
        throw new Error('Projekt nicht gefunden.');
      }
      const data: Project = await res.json();
      setProject(data);
    } catch (error: any) {
      console.error('Error fetching project:', error);
      alert('Fehler beim Abrufen des Projekts.');
      router.push('/showcases'); // Navigiere zurück zur Projektliste bei Fehler
    }
  }

  useEffect(() => {
    fetchProject();
  }, [projectId]);

  // Handle adding a comment
  const handleAddComment = async () => {
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
      setProject(prev => prev ? { ...prev, comments: [...prev.comments, newComment] } : prev);
      setCommentContent('');
    } catch (error: any) {
      console.error('Error adding comment:', error);
      alert(error.message || 'Fehler beim Hinzufügen des Kommentars.');
    }
  }

  // Handle editing a project
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
  }

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
  }

  // Handle deleting a project
  const handleOpenDeleteDialog = () => {
    if (!project) return;
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

      // Navigiere zurück zur Projektliste
      router.push('/showcases');
    } catch (error: any) {
      console.error('Error deleting project:', error);
      alert(error.message || 'Fehler beim Löschen des Projekts.');
    }
  }

  // Handle like
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
    } catch (error: any) {
      console.error('Error liking project:', error);
      alert(error.message || 'Fehler beim Liken des Projekts.');
    }
  }

  // Handle unlike
  const handleUnlike = async () => {
    if (!session || !project) {
      alert('Bitte melde dich an, um zu entliken.');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${project.id}/like`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Entliken des Projekts.');
      }

      // Aktualisiere das Projekt in der Liste
      const removedLike: { id: string } = await res.json();
      setProject(prev => prev ? { ...prev, likes: prev.likes.filter(like => like.id !== removedLike.id) } : prev);
    } catch (error: any) {
      console.error('Error unliking project:', error);
      alert(error.message || 'Fehler beim Entliken des Projekts.');
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Sidebar */}
      <Sidebar />

      {/* Hauptinhalt */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Projekt-Detail</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        {/* Hauptinhalt */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {project ? (
            <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              {/* Projektbild */}
              <div className="relative">
                {project.imageUrl ? (
                  <img
                    src={project.imageUrl}
                    alt={`${project.title} Vorschaubild`}
                    className="w-full h-64 object-cover rounded-lg"
                  />
                ) : (
                  <div
                    className="w-full h-64 rounded-lg"
                    style={{
                      background: `linear-gradient(135deg, ${project.gradientFrom}, ${project.gradientTo})`,
                    }}
                  />
                )}
                <Badge className="absolute top-2 left-2" variant="secondary">
                  {project.tags.map(tag => tag.name).join(', ')}
                </Badge>
              </div>

              {/* Projektinformationen */}
              <h1 className="text-3xl font-bold mt-4 text-gray-800 dark:text-white">{project.title}</h1>
              <p className="mt-2 text-gray-600 dark:text-gray-300">{project.description}</p>
              <p className="mt-2 text-gray-600 dark:text-gray-300"><strong>Kategorie:</strong> {project.category}</p>
              <p className="mt-2 text-gray-600 dark:text-gray-300"><strong>Link:</strong> <a href={project.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{project.link}</a></p>

              {/* Autorinformationen */}
              <div className="mt-4 flex items-center space-x-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={project.author.image || undefined} />
                  <AvatarFallback>{project.author.name ? project.author.name.charAt(0) : 'U'}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{project.author.name}</span>
              </div>

              {/* Likes und Kommentare */}
              <div className="mt-4 flex items-center space-x-4">
                <button
                  className={`flex items-center text-sm ${project.likes.some(like => like.userId === session?.user.id) ? 'text-blue-500' : 'text-gray-500 hover:text-blue-500'}`}
                  onClick={project.likes.some(like => like.userId === session?.user.id) ? handleUnlike : handleLike}
                >
                  <ThumbsUp className="h-5 w-5 mr-1" />
                  {project.likes.length}
                </button>
                <span className="flex items-center text-sm text-gray-500">
                  <MessageSquare className="h-5 w-5 mr-1" />
                  {project.comments.length}
                </span>
              </div>

              {/* Aktionen: Bearbeiten und Löschen */}
              {session?.user.id === project.author.id && (
                <div className="mt-6 flex space-x-2">
                  <Button onClick={handleOpenEditDialog} variant="outline" className="flex items-center space-x-1">
                    <Edit className="h-4 w-4" /> <span>Bearbeiten</span>
                  </Button>
                  <Button onClick={handleOpenDeleteDialog} variant="destructive" className="flex items-center space-x-1">
                    <Trash className="h-4 w-4" /> <span>Löschen</span>
                  </Button>
                </div>
              )}

              {/* Kommentare */}
              <div className="mt-8">
                <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-4">Kommentare</h2>
                {project.comments.length > 0 ? (
                  project.comments.map(comment => (
                    <div key={comment.id} className="mb-4">
                      <div className="flex items-center space-x-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={comment.author?.image || undefined} />
                          <AvatarFallback>{comment.author?.name ? comment.author.name.charAt(0) : 'U'}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{comment.author?.name || 'Unbekannt'}</span>
                        <span className="text-xs text-gray-500">{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 ml-8">{comment.content}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">Keine Kommentare vorhanden.</p>
                )}

                {/* Kommentar hinzufügen */}
                {session && (
                  <div className="mt-6">
                    <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">Einen Kommentar hinzufügen</h3>
                    <Textarea
                      placeholder="Dein Kommentar..."
                      className="w-full"
                      value={commentContent}
                      onChange={(e) => setCommentContent(e.target.value)}
                    />
                    <Button className="mt-2" onClick={handleAddComment}>
                      Kommentar hinzufügen
                    </Button>
                  </div>
                )}
              </div>

              {/* Bearbeiten Dialog */}
              <Dialog open={isEditDialogOpen} onOpenChange={() => { setIsEditDialogOpen(false); setEditProjectData({ title: '', description: '', category: '', tags: [], link: '', image: null }); }}>
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
                              const file = e.target.files?.[0];
                              if (file) {
                                setEditProjectData({ ...editProjectData, image: file });
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
                    <DialogFooter>
                      <Button type="submit">Projekt aktualisieren</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              {/* Löschen Dialog */}
              {projectToDelete && (
                <Dialog open={isDeleteDialogOpen} onOpenChange={() => { setIsDeleteDialogOpen(false); setProjectToDelete(null); }}>
                  <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                      <DialogTitle>Projekt löschen</DialogTitle>
                    </DialogHeader>
                    <DialogDescription>
                      Bist du sicher, dass du das Projekt "<strong>{projectToDelete.title}</strong>" löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
                    </DialogDescription>
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
              )}
            </div>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400">Projekt wird geladen...</p>
          )}
        </main>
      </div>
    </div>
  );
}
