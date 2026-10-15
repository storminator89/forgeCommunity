// app/showcases/page.tsx

"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: project showcase directory · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ThumbsUp, MessageSquare, Plus, Edit, Trash, LayoutGrid, List, ArrowUpRight, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import { Editor } from "@/components/Editor";
import { sanitizeTextPreview } from '@/lib/sanitize-html';


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
  const { data, status } = useSession();
  const session = status === 'authenticated' ? data : null;
  return <ProjectShowcaseForViewer key={session?.user?.id ?? 'anonymous'} session={session} />;
}

function ProjectShowcaseForViewer({ session }: { session: Session | null }) {
  const [searchTerm, setSearchTerm] = useState('');
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
    link: string,
    image: File | null,
  }>({
    title: '',
    description: '',
    category: '',
    link: '',
    image: null,
  });
  const [editTagsText, setEditTagsText] = useState('');
  const [currentTag, setCurrentTag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [retryKey, setRetryKey] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [pendingLikeId, setPendingLikeId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void loadProjects(controller.signal)
      .then((data) => {
        if (active) { setProjects(data); setLoadError(null); }
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
  }, [retryKey]);

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
    if (isSubmitting) return;
    if (!newProject.title.trim() || !sanitizeTextPreview(newProject.description, 100000).trim() || !newProject.category || !newProject.link.trim()) {
      setCreateError('Bitte fülle alle erforderlichen Felder aus.');
      return;
    }

    setCreateError(null);
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
      setProjects(previous => [createdProject, ...previous]);
      setIsSubmitDialogOpen(false);
      setNewProject({
        title: '',
        description: defaultDescription,
        category: '',
        tags: [],
        link: '',
        image: null,
      });
      setCurrentTag('');
    } catch (error: any) {
      console.error('Error submitting project:', error);
      setCreateError(error.message || 'Fehler beim Einreichen des Projekts.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle like
  const handleLike = async (projectId: string) => {
    if (!session) {
      setLikeError('Bitte melde dich an, um Projekte zu liken.');
      return;
    }
    if (pendingLikeId) return;

    setLikeError(null);
    setPendingLikeId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/like`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Liken des Projekts.');
      }

      // Aktualisiere das Projekt in der Liste
      const newLike: LikeProject | { message: string } = await res.json();
      setProjects(previous => previous.map(project => {
        if (project.id === projectId) {
          if ('id' in newLike) return { ...project, likes: [...project.likes.filter(like => like.userId !== session.user.id), newLike] };
          return { ...project, likes: project.likes.filter(like => like.userId !== session.user.id) };
        }
        return project;
      }));
    } catch (error: any) {
      console.error('Error liking project:', error);
      setLikeError(error.message || 'Fehler beim Liken des Projekts.');
    } finally {
      setPendingLikeId(null);
    }
  }

  // Handle unlike
  const handleUnlike = async (projectId: string) => {
    if (!session) {
      setLikeError('Bitte melde dich an, um Projekte zu liken.');
      return;
    }
    if (pendingLikeId) return;

    setLikeError(null);
    setPendingLikeId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/like`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Entliken des Projekts.');
      }

      // Aktualisiere das Projekt in der Liste
      // DELETE returns a message, so use the current member's ID instead of expecting a like ID.
      setProjects(previous => previous.map(project => {
        if (project.id === projectId) {
          return { ...project, likes: project.likes.filter(like => like.userId !== session.user.id) };
        }
        return project;
      }));
    } catch (error: any) {
      console.error('Error unliking project:', error);
      setLikeError(error.message || 'Fehler beim Entliken des Projekts.');
    } finally {
      setPendingLikeId(null);
    }
  }

  // Handle editing a project
  const handleOpenEditDialog = (project: Project) => {
    setEditError(null);
    setProjectToEdit(project);
    setEditTagsText(project.tags.map(tag => tag.name).join(', '));
    setEditProjectData({
      title: project.title,
      description: project.description,
      category: project.category,
      link: project.link,
      image: null,
    });
    setIsEditDialogOpen(true);
  }

  const handleSubmitEditProject = async () => {
    if (!projectToEdit || isEditing) return;

    const { title, description, category, link, image } = editProjectData;
    const tags = Array.from(new Set(editTagsText.split(',').map(tag => tag.trim()).filter(Boolean)));

    if (!title.trim() || !sanitizeTextPreview(description, 100000).trim() || !category.trim() || !link.trim()) {
      setEditError('Bitte fülle alle erforderlichen Felder aus.');
      return;
    }
    if (tags.length > 20 || tags.some(tag => tag.length > 60)) {
      setEditError('Bitte verwende höchstens 20 Tags mit je maximal 60 Zeichen.');
      return;
    }

    setEditError(null);
    setIsEditing(true);
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
      setProjects(previous => previous.map(project => project.id === updatedProject.id ? updatedProject : project));
      setIsEditDialogOpen(false);
      setProjectToEdit(null);
    } catch (error: any) {
      console.error('Error editing project:', error);
      setEditError(error.message || 'Fehler beim Bearbeiten des Projekts.');
    } finally {
      setIsEditing(false);
    }
  }

  // Handle deleting a project
  const handleDeleteProject = async () => {
    if (!projectToDelete || isDeleting) return;

    setDeleteError(null);
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectToDelete.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Löschen des Projekts.');
      }

      // Entferne das Projekt aus der Liste
      setProjects(previous => previous.filter(project => project.id !== projectToDelete.id));
      setIsDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error: any) {
      console.error('Error deleting project:', error);
      setDeleteError(error.message || 'Fehler beim Löschen des Projekts.');
    } finally {
      setIsDeleting(false);
    }
  }

  const handleAddTag = () => {
    const tag = currentTag.trim();
    if (!tag || newProject.tags.some(item => item.toLocaleLowerCase('de-DE') === tag.toLocaleLowerCase('de-DE')) || newProject.tags.length >= 20) return;
    setNewProject(previous => ({ ...previous, tags: [...previous.tags, tag] }));
    setCurrentTag('');
  }

  const hasFilters = Boolean(searchTerm || activeTab !== 'all');
  const clearFilters = () => { setSearchTerm(''); setActiveTab('all'); };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader><div className="flex min-w-0 items-center justify-between gap-3"><h1 className="min-w-0 truncate">Projekte</h1><div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <div className="flex flex-wrap items-end justify-between gap-5 border-b pb-7"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Community / Projekte</p><p className="mt-2 max-w-[55ch] text-base leading-relaxed text-muted-foreground">Entdecke Arbeiten, Ideen und Erfahrungen aus der Community.</p></div>{session && <Button type="button" onClick={() => setIsSubmitDialogOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />Projekt einreichen</Button>}</div>

            <section aria-label="Projekte filtern" className="grid min-w-0 gap-4 border-b py-7 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
              <div className="min-w-0"><Label htmlFor="showcase-search" className="mb-2 block">Projekte suchen</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="showcase-search" type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Titel, Beschreibung oder Tag" className="pl-10" /></div></div>
              <div className="min-w-0"><Label htmlFor="showcase-sort" className="mb-2 block">Sortieren nach</Label><Select value={sortBy} onValueChange={setSortBy}><SelectTrigger id="showcase-sort"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Neueste</SelectItem><SelectItem value="mostLiked">Meiste Likes</SelectItem><SelectItem value="mostCommented">Meiste Kommentare</SelectItem></SelectContent></Select></div>
              <div role="group" aria-label="Ansicht wählen" className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" aria-label="Rasteransicht" aria-pressed={viewMode === 'grid'} className={viewMode === 'grid' ? 'bg-accent text-foreground' : undefined} onClick={() => setViewMode('grid')}><LayoutGrid className="h-4 w-4" aria-hidden="true" /></Button><Button type="button" variant="outline" size="icon" aria-label="Listenansicht" aria-pressed={viewMode === 'list'} className={viewMode === 'list' ? 'bg-accent text-foreground' : undefined} onClick={() => setViewMode('list')}><List className="h-4 w-4" aria-hidden="true" /></Button></div>
            </section>

            <div role="group" aria-label="Projekt-Tag wählen" className="flex flex-wrap gap-2 border-b py-5">{categories.map(category => <button key={category} type="button" aria-pressed={activeTab === category} onClick={() => setActiveTab(category)} className={'min-h-11 max-w-full rounded-[10px] border px-3 py-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [overflow-wrap:anywhere] ' + (activeTab === category ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}>{category === 'all' ? 'Alle Tags' : category}</button>)}</div>

            <section aria-labelledby="showcase-results-title" className="pt-7"><div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-4"><h2 id="showcase-results-title" className="text-xl font-semibold tracking-tight">Projekte entdecken</h2><p role="status" className="text-sm tabular-nums text-muted-foreground">{isLoading ? 'Wird geladen…' : loadError ? 'Nicht verfügbar' : `${filteredProjects.length} ${filteredProjects.length === 1 ? 'Projekt' : 'Projekte'}`}</p></div>
              {likeError && <p role="alert" className="mt-5 rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{likeError} {!session && <Link href="/login?callbackUrl=%2Fshowcases" className="font-semibold underline underline-offset-2">Zur Anmeldung</Link>}</p>}
              {isLoading ? <div className="mt-6"><PageState kind="loading" title="Projekte werden geladen" /></div> : loadError ? <div className="mt-6"><PageState kind="error" title="Projekte konnten nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<Button type="button" variant="outline" onClick={() => { setIsLoading(true); setLoadError(null); setRetryKey(value => value + 1); }}>Erneut versuchen</Button>} /></div> : filteredProjects.length === 0 ? <div className="mt-6"><PageState title={hasFilters ? 'Keine Projekte gefunden' : 'Noch keine Projekte'} description={hasFilters ? 'Versuche andere Suchbegriffe oder Tags.' : 'Sobald Projekte eingereicht werden, findest du sie hier.'} action={hasFilters ? <Button type="button" variant="outline" onClick={clearFilters}>Filter zurücksetzen</Button> : session ? <Button type="button" onClick={() => setIsSubmitDialogOpen(true)}>Erstes Projekt einreichen</Button> : undefined} /></div> :
                <ul className={viewMode === 'grid' ? 'grid min-w-0 gap-x-7 gap-y-3 md:grid-cols-2 xl:grid-cols-3' : 'divide-y'}>{filteredProjects.map(project => {
                  const liked = project.likes.some(like => like.userId === session?.user?.id);
                  return <li key={project.id} className={'min-w-0 border-t py-6 ' + (viewMode === 'list' ? 'sm:flex sm:items-start sm:gap-6' : '')}>
                    {project.imageUrl && <div className={'relative mb-5 aspect-video min-w-0 overflow-hidden rounded-[10px] bg-muted ' + (viewMode === 'list' ? 'sm:mb-0 sm:h-28 sm:w-44 sm:shrink-0' : '')}><Image src={project.imageUrl} alt="" fill sizes={viewMode === 'grid' ? '(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw' : '(max-width: 640px) 100vw, 176px'} className="object-cover" /></div>}
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="min-w-0 break-words font-semibold uppercase tracking-[0.08em] text-foreground [overflow-wrap:anywhere]">{project.category}</span><time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleDateString('de-DE')}</time></div><h3 className="mt-2 min-w-0 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]"><Link href={`/projects/${project.id}`} className="hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{project.title}</Link></h3><p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{sanitizeTextPreview(project.description, 180)}</p>
                      {project.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{project.tags.map(tag => <Badge key={tag.id} variant="secondary" className="max-w-full break-all">{tag.name}</Badge>)}</div>}
                      <div className="mt-5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4"><Avatar className="h-8 w-8 shrink-0"><AvatarImage src={project.author.image || undefined} alt="" /><AvatarFallback>{project.author.name?.[0] || 'U'}</AvatarFallback></Avatar><Link href={`/profile/${project.author.id}`} className="min-w-0 max-w-full break-words text-sm text-muted-foreground hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [overflow-wrap:anywhere]">{project.author.name || 'Unbekannt'}</Link><div className="flex flex-wrap items-center gap-1 sm:ml-auto"><Button type="button" variant="ghost" size="sm" aria-label={liked ? 'Gefällt mir zurücknehmen' : 'Projekt gefällt mir'} aria-pressed={liked} disabled={pendingLikeId === project.id} onClick={() => void (liked ? handleUnlike(project.id) : handleLike(project.id))}><ThumbsUp className="h-4 w-4" aria-hidden="true" />{project.likes.length}</Button><Button asChild variant="ghost" size="sm"><Link href={`/projects/${project.id}#comments`} aria-label={`${project.comments.length} Kommentare zu ${project.title}`}><MessageSquare className="h-4 w-4" aria-hidden="true" />{project.comments.length}</Link></Button></div></div>
                      <div className="mt-4 flex flex-wrap items-center gap-2"><Button asChild variant="outline" size="sm"><Link href={`/projects/${project.id}`}>Details <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button>{session?.user?.id === project.author.id && <><Button type="button" variant="ghost" size="sm" onClick={() => handleOpenEditDialog(project)}><Edit className="h-4 w-4" aria-hidden="true" />Bearbeiten</Button><Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => { setDeleteError(null); setProjectToDelete(project); setIsDeleteDialogOpen(true); }}><Trash className="h-4 w-4" aria-hidden="true" />Löschen</Button></>}</div>
                    </div>
                  </li>;
                })}</ul>}
            </section>
          </div>
        </main>
      </div>

      {/* Neues Projekt Einreichen Dialog */}
      {session && (
        <Dialog open={isSubmitDialogOpen} onOpenChange={(open) => { if (isSubmitting && !open) return; setIsSubmitDialogOpen(open); if (!open) setCreateError(null); }}>
          <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto p-6">
            <DialogHeader className="space-y-3 pb-4 border-b">
              <DialogTitle className="text-2xl font-bold">Neues Projekt einreichen</DialogTitle>
              <DialogDescription>
                Titel, Beschreibung, Kategorie und Link sind erforderlich.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={(e) => { e.preventDefault(); void handleSubmitNewProject(); }} aria-busy={isSubmitting} className="space-y-8 pt-4">
              {createError && <p role="alert" className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{createError}</p>}
              <div className="space-y-6">
                {/* Titel Section */}
                <div className="space-y-2">
                  <Label htmlFor="title" className="text-base font-semibold">
                    Titel <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="title"
                    value={newProject.title}
                    onChange={(e) => setNewProject({ ...newProject, title: e.target.value })}
                    placeholder="Projekttitel"
                    className="h-11"
                    maxLength={300}
                    required
                  />
                </div>

                {/* Description Section */}
                <div className="space-y-2">
                  <p id="showcase-description-label" className="text-base font-semibold">
                    Beschreibung <span className="text-destructive" aria-hidden="true">*</span>
                  </p>
                  <div role="group" aria-labelledby="showcase-description-label" className="relative min-h-[250px] rounded-[10px] border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
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
                      Kategorie <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <Select
                      value={newProject.category}
                      onValueChange={(value) => setNewProject({ ...newProject, category: value })}
                    >
                      <SelectTrigger id="category" aria-required="true" className="h-11">
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
                      <div className="flex min-w-0 gap-2">
                        <Input
                          id="tags"
                          value={currentTag}
                          onChange={(e) => setCurrentTag(e.target.value)}
                          placeholder="Tag eingeben und Enter drücken"
                          className="h-11 min-w-0 flex-1"
                          maxLength={60}
                          disabled={newProject.tags.length >= 20}
                          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                        />
                        <Button
                          type="button"
                          aria-label="Tag hinzufügen"
                          onClick={handleAddTag}
                          disabled={!currentTag.trim() || newProject.tags.length >= 20}
                          variant="outline"
                          size="icon"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {newProject.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            aria-label={`Tag ${tag} entfernen`}
                            onClick={() => setNewProject(previous => ({ ...previous, tags: previous.tags.filter(item => item !== tag) }))}
                            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[10px] bg-secondary px-3 py-2 text-sm text-secondary-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <span className="min-w-0 break-all">{tag}</span><X className="h-4 w-4 shrink-0" aria-hidden="true" />
                          </button>
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
                      Projekt-Link <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <Input
                      id="link"
                      type="url"
                      value={newProject.link}
                      onChange={(e) => setNewProject({ ...newProject, link: e.target.value })}
                      placeholder="https://..."
                      className="h-11"
                      maxLength={2048}
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
              <div className="flex flex-wrap justify-end gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setIsSubmitDialogOpen(false); setCreateError(null); }}
                  disabled={isSubmitting}
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <span className="mr-2">Wird eingereicht...</span>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" aria-hidden="true" />
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
        <Dialog open={isEditDialogOpen} onOpenChange={(open) => { if (isEditing && !open) return; setIsEditDialogOpen(open); if (!open) { setProjectToEdit(null); setEditError(null); } }}>
          <DialogContent className="sm:max-w-[625px] max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Projekt bearbeiten</DialogTitle>
              <DialogDescription>Aktualisiere dein Projekt und speichere deine Änderungen.</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); void handleSubmitEditProject(); }} encType="multipart/form-data" aria-busy={isEditing}>
              {editError && <p role="alert" className="mt-4 rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{editError}</p>}
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
                    maxLength={300}
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <p id="edit-description-label" className="text-sm font-medium sm:text-right">
                    Beschreibung
                  </p>
                  <div role="group" aria-labelledby="edit-description-label" className="min-w-0 rounded-[10px] border border-input sm:col-span-3 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"><Editor content={editProjectData.description} onChange={description => setEditProjectData(previous => ({ ...previous, description }))} className="min-h-[180px]" /></div>
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
                    maxLength={100}
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-tags" className="sm:text-right">
                    Tags
                  </Label>
                  <Input
                    id="edit-tags"
                    value={editTagsText}
                    onChange={(e) => setEditTagsText(e.target.value)}
                    className="sm:col-span-3"
                    placeholder="Trennen Sie Tags mit Kommas"
                    aria-describedby="edit-tags-hint"
                  />
                  <p id="edit-tags-hint" className="text-xs text-muted-foreground sm:col-start-2">Mit Kommas trennen, maximal 20 Tags.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-link" className="sm:text-right">
                    Projekt-Link
                  </Label>
                  <Input
                    id="edit-link"
                    type="url"
                    value={editProjectData.link}
                    onChange={(e) => setEditProjectData({ ...editProjectData, link: e.target.value })}
                    className="sm:col-span-3"
                    placeholder="https://github.com/..."
                    maxLength={2048}
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 sm:gap-4">
                  <Label htmlFor="edit-image-upload" className="sm:text-right">
                    Vorschaubild
                  </Label>
                  <div className="sm:col-span-3">
                    <Input
                      type="file"
                      id="edit-image-upload"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setEditProjectData({ ...editProjectData, image: file })
                        }
                      }}
                      className="h-11 cursor-pointer file:mr-4 file:cursor-pointer"
                    />
                    {editProjectData.image && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Gewähltes Bild: {editProjectData.image.name}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => { setIsEditDialogOpen(false); setProjectToEdit(null); setEditError(null); }} disabled={isEditing}>Abbrechen</Button>
                <Button type="submit" disabled={isEditing}>{isEditing ? 'Wird gespeichert…' : 'Projekt aktualisieren'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Projekt Löschen Dialog */}
      {projectToDelete && (
        <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => { if (isDeleting && !open) return; setIsDeleteDialogOpen(open); if (!open) { setProjectToDelete(null); setDeleteError(null); } }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Projekt löschen</DialogTitle>
              <DialogDescription>Bestätige das Löschen dieses Projekts.</DialogDescription>
            </DialogHeader>
            <p>
              Bist du sicher, dass du das Projekt &quot;{projectToDelete.title}&quot; löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            {deleteError && <p role="alert" className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{deleteError}</p>}
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => { setIsDeleteDialogOpen(false); setProjectToDelete(null); setDeleteError(null); }} disabled={isDeleting}>
                Abbrechen
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDeleteProject()} disabled={isDeleting}>
                {isDeleting ? 'Wird gelöscht…' : 'Projekt löschen'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}
