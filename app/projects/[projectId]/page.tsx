"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: project reading · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, MessageSquare, ExternalLink, Edit, Trash, Share2, Calendar, User, Tag, ArrowLeft } from 'lucide-react';
import { useSession } from '@/lib/sites-auth/react';
import type { Session } from '@/lib/sites-auth/server';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import Image from 'next/image';
import { sanitizeRichHtml } from '@/lib/sanitize-html';
import { getSafeHttpUrl } from '@/lib/security';
import { PlainTextLinks } from '@/components/plain-text-links';


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

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, status } = useSession();
  const session = status === 'authenticated' ? data : null;
  return <ProjectDetailForViewer key={JSON.stringify([projectId, session?.user?.id ?? null])} projectId={projectId} session={session} />;
}

function ProjectDetailForViewer({ projectId, session }: { projectId: string; session: Session | null }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [commentDraft, setCommentDraft] = useState({ text: '', revision: 0 });
  const newComment = commentDraft.text;
  const [isLiked, setIsLiked] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isLiking, setIsLiking] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const likeRequest = useRef(false);
  const commentRequest = useRef(false);
  const commentViewActive = useRef(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const editRequest = useRef(false);
  const editViewActive = useRef(false);
  const editDialogOpen = useRef(false);
  const editDialogGeneration = useRef(0);
  const editDraftReady = useRef(false);
  const editDraftRevision = useRef(0);
  const editImageInput = useRef<HTMLInputElement>(null);
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
  const safeProjectLink = project ? getSafeHttpUrl(project.link) : null;

  useEffect(() => {
    commentViewActive.current = true;
    return () => { commentViewActive.current = false; };
  }, []);

  useEffect(() => {
    editViewActive.current = true;
    return () => { editViewActive.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const fetchProject = async () => {
      if (!projectId) return;
      setIsLoading(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Projekt nicht gefunden.');
        const data: Project = await res.json();
        if (controller.signal.aborted) return;
        setProject(data);
        setLoadError(null);
        setLoadedForId(projectId);
        setComments(data.comments || []);
        setIsLiked(data.likes?.some(like => like.userId === session?.user?.id) || false);
        setIsLoading(false);

        // Load every comment page after initializing the project, so a faster
        // comments request cannot be overwritten by the limited project preview.
        try {
          const allComments: ProjectComment[] = [];
          for (let page = 1; ; page++) {
            const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments?page=${page}`, { signal: controller.signal });
            if (!response.ok) throw new Error('Fehler beim Laden der Kommentare.');
            const batch: ProjectComment[] = await response.json();
            allComments.push(...batch);
            if (batch.length < 50) break;
          }
          if (controller.signal.aborted) return;
          setComments(current => [
            ...allComments,
            ...current.filter(comment => !allComments.some(loaded => loaded.id === comment.id)),
          ]);
        } catch (error) {
          if (!controller.signal.aborted) console.error('Error fetching comments:', error);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Error fetching project:', error);
        setProject(null);
        setLoadError(error instanceof Error ? error.message : 'Projekt konnte nicht geladen werden.');
        setLoadedForId(projectId);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void fetchProject();
    return () => controller.abort();
  }, [projectId, retryKey, session?.user?.id]);

  const handleLike = async () => {
    if (likeRequest.current) return;
    if (!session || !project) {
      alert('Bitte melde dich an, um zu liken.');
      return;
    }

    likeRequest.current = true;
    setIsLiking(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/like`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Liken des Projekts.');
      }

      // Aktualisiere das Projekt in der Liste
      const result = await res.json();
      setProject(prev => prev ? {
        ...prev,
        likes: isLiked ? prev.likes.filter(like => like.userId !== session.user.id) : [...prev.likes, result as LikeProject],
      } : prev);
      setIsLiked(!isLiked);
    } catch (error: any) {
      console.error('Error liking project:', error);
      alert(error.message || 'Fehler beim Liken des Projekts.');
    } finally {
      likeRequest.current = false;
      setIsLiking(false);
    }
  }

  const handleComment = async () => {
    if (!commentViewActive.current || commentRequest.current) return;
    if (!session || !project) {
      alert('Bitte melde dich an, um einen Kommentar hinzuzufügen.');
      return;
    }

    const submittedDraft = commentDraft;
    if (!submittedDraft.text.trim()) {
      alert('Kommentar darf nicht leer sein.');
      return;
    }

    commentRequest.current = true;
    setIsCommenting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: submittedDraft.text }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Fehler beim Hinzufügen des Kommentars.');
      }

      const addedComment: ProjectComment = await res.json();
      if (!commentViewActive.current) return;

      // Update both comments and project state
      setComments(prev => [...prev, addedComment]);
      setProject(prev => prev ? {
        ...prev,
        comments: [...prev.comments, addedComment]
      } : prev);

      // Keep anything typed since this POST began, even if the person edited
      // back to identical text. Only the submitted revision may be cleared.
      setCommentDraft(current => current.revision === submittedDraft.revision
        ? { text: '', revision: current.revision + 1 } : current);
    } catch (error: any) {
      if (!commentViewActive.current) return;
      console.error('Error adding comment:', error);
      alert(error.message || 'Fehler beim Hinzufügen des Kommentars.');
    } finally {
      commentRequest.current = false;
      if (commentViewActive.current) setIsCommenting(false);
    }
  }

  const handleOpenEditDialog = () => {
    if (!project) return;
    // Pending Close/Reopen (or a failure while closed) keeps the actual draft.
    if (!editDraftReady.current) {
      setEditProjectData({
        title: project.title,
        description: project.description,
        category: project.category,
        tags: project.tags.map(tag => tag.name),
        link: project.link,
        image: null,
      });
      editDraftRevision.current += 1;
      editDraftReady.current = true;
      setEditError(null);
      setEditNotice(null);
    }
    editDialogGeneration.current += 1;
    editDialogOpen.current = true;
    setIsEditDialogOpen(true);
  };

  const handleEditDialogOpenChange = (open: boolean) => {
    if (open) { handleOpenEditDialog(); return; }
    editDialogGeneration.current += 1;
    editDialogOpen.current = false;
    setIsEditDialogOpen(false);
    if (!editRequest.current) {
      editDraftReady.current = false;
      setEditError(null);
      setEditNotice(null);
    }
  };

  const updateEditProjectData = (update: (draft: typeof editProjectData) => typeof editProjectData) => {
    if (editRequest.current) return;
    editDraftRevision.current += 1;
    setEditProjectData(update);
    setEditError(null);
    setEditNotice(null);
  };

  const handleOpenDeleteDialog = () => {
    if (!project) return;
    setIsDeleteDialogOpen(true);
  };

  const handleSubmitEditProject = async () => {
    if (!editViewActive.current || editRequest.current || !project) return;

    const submittedDraft = { ...editProjectData, tags: [...editProjectData.tags] };
    const submittedRevision = editDraftRevision.current;
    const submittedGeneration = editDialogGeneration.current;
    const targetId = project.id;
    const { title, description, category, tags, link, image } = submittedDraft;

    if (!title || !description || !category || !link) {
      setEditError('Bitte fülle alle erforderlichen Felder aus.');
      return;
    }

    editRequest.current = true;
    setIsSavingProject(true);
    setEditError(null);
    setEditNotice(null);
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

      const res = await fetch(`/api/projects/${targetId}`, {
        method: 'PUT',
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(typeof errorData.error === 'string' ? errorData.error : 'Fehler beim Bearbeiten des Projekts.');
      }

      const updatedProject: Project = await res.json();
      if (!editViewActive.current) return;
      setProject(current => current?.id === targetId ? updatedProject : current);
      const unchangedDraft = editDraftRevision.current === submittedRevision;
      // A saved File is no longer a pending replacement. Never clear a newer one.
      if (unchangedDraft) {
        setEditProjectData(current => ({ ...current, image: null }));
        if (editImageInput.current) editImageInput.current.value = '';
      }
      if (unchangedDraft && editDialogGeneration.current === submittedGeneration && editDialogOpen.current) {
        editDraftReady.current = false;
        editDialogOpen.current = false;
        setIsEditDialogOpen(false);
      } else if (editDialogOpen.current) {
        setEditNotice(unchangedDraft ? 'Änderungen gespeichert.' : 'Gespeichert. Neuere Änderungen sind noch offen.');
      } else if (unchangedDraft) {
        editDraftReady.current = false;
      }
    } catch (error: any) {
      if (!editViewActive.current) return;
      console.error('Error updating project:', error);
      setEditError(error instanceof Error ? error.message : 'Fehler beim Aktualisieren des Projekts.');
    } finally {
      editRequest.current = false;
      if (editViewActive.current) setIsSavingProject(false);
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
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
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
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <div className="app-header-title"><Button asChild variant="ghost" size="sm"><Link href="/showcases" aria-label="Zur Projektübersicht"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zurück</Link></Button></div>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            {isLoading || loadedForId !== projectId ? <><h1 className="sr-only">Projekt</h1><PageState kind="loading" title="Projekt wird geladen" /></> : !project ? <><h1 className="sr-only">Projekt</h1><PageState kind="error" title="Projekt nicht verfügbar" description={loadError || 'Das Projekt konnte nicht geladen werden oder wurde entfernt.'} action={<div className="flex flex-wrap justify-center gap-2"><Button type="button" variant="outline" onClick={() => { setIsLoading(true); setRetryKey(value => value + 1); }}>Erneut versuchen</Button><Button asChild variant="outline"><Link href="/showcases">Zur Übersicht</Link></Button></div>} /></> : (
              <article className="space-y-6">
                {/* Project Header */}
                <div className="fc-surface p-4 sm:p-6 lg:p-8">

                  <div className="flex min-w-0 flex-col gap-5">
                    <div className="min-w-0">
                      <h1 className="min-w-0 text-[clamp(1.75rem,1.25rem+1.5vw,2.5rem)] font-semibold leading-[1.15] tracking-[-0.035em] [overflow-wrap:anywhere]">{project.title}</h1>
                      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                        <div className="flex min-w-0 items-start">
                          <Calendar className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {new Date(project.createdAt).toLocaleDateString('de-DE', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-start">
                          <User className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0 [overflow-wrap:anywhere]">{project.author?.name || 'Anonym'}</span>
                        </div>
                        <div className="flex min-w-0 items-start">
                          <Tag className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0 [overflow-wrap:anywhere]">{project.category}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border pt-4">
                      {session?.user?.id === project.author.id && (
                        <>
                          <Button variant="outline" size="sm" className="min-h-11" onClick={handleOpenEditDialog}><Edit className="mr-2 h-4 w-4" />Bearbeiten</Button>
                          <Button variant="outline" size="sm" className="min-h-11 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleOpenDeleteDialog}><Trash className="mr-2 h-4 w-4" />Löschen</Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex min-h-11 items-center"
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
                <div className="mx-auto max-w-[76ch] space-y-5">
                  {/* Description */}
                  <div className="fc-surface p-6 sm:p-8 prose prose-neutral dark:prose-invert max-w-none break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
                    <div
                      className="[&>h2]:text-2xl [&>h2]:font-bold [&>h2]:text-foreground [&>h2]:mt-8 [&>h2]:mb-4
                                 [&>p]:text-muted-foreground [&>p]:leading-relaxed [&>p]:mb-4
                                 [&>ul]:list-disc [&>ul]:pl-6 [&>ul]:mb-4 [&>ul]:text-muted-foreground
                                 [&>li]:mb-2
                                 [&_strong]:text-foreground [&_strong]:font-semibold
                                 [&_em]:text-muted-foreground [&_em]:italic
                                 [&>h2]:flex [&>h2]:items-center [&>h2]:gap-2
                                 [&>*:first-child]:mt-0"
                      dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(project.description) }}
                    />
                  </div>

                  {/* Tags */}
                  <div className="fc-surface space-y-3 p-6">
                    <h2 className="text-lg font-semibold text-foreground">Tags</h2>
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
                  <div className="fc-surface space-y-3 p-6">
                    <h2 className="text-lg font-semibold text-foreground">Projekt-Link</h2>
                    {safeProjectLink && (
                      <a
                        href={safeProjectLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 break-all text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        {safeProjectLink}
                      </a>
                    )}
                  </div>

                  {/* Interactions Section */}
                  <div className="fc-surface p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                      <h2 className="text-xl font-semibold tracking-tight">
                        Kommentare
                      </h2>
                      <div className="flex items-center space-x-4">
                        <Button
                          variant={isLiked ? "default" : "outline"}
                          size="sm"
                          aria-label={isLiked ? 'Gefällt mir zurücknehmen' : 'Projekt gefällt mir'}
                          aria-pressed={isLiked}
                          disabled={isLiking}
                          onClick={handleLike}
                          className="flex items-center space-x-2"
                        >
                          <ThumbsUp className="w-4 h-4" />
                          <span>{project.likes.length}</span>
                        </Button>
                      </div>
                    </div>

                    {/* Comments Section */}
                    <div id="comments" className="space-y-6 scroll-mt-6">
                      {session && (
                        <div className="space-y-4">
                          <Textarea
                            aria-label="Dein Kommentar zum Projekt"
                            placeholder="Teile deine Gedanken…"
                            value={newComment}
                            onChange={(event) => {
                              const text = event.target.value;
                              setCommentDraft(current => ({ text, revision: current.revision + 1 }));
                            }}
                            className="min-h-[100px] bg-background"
                          />
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              onClick={handleComment}
                              disabled={isCommenting || !newComment.trim()}
                            >
                              {isCommenting ? 'Wird gesendet…' : 'Kommentieren'}
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="divide-y">
                        {comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="py-5"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={comment.author.image} />
                                <AvatarFallback>{comment.author.name?.[0] || 'U'}</AvatarFallback>
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
                            <p className="text-foreground break-words whitespace-pre-wrap [overflow-wrap:anywhere]"><PlainTextLinks text={comment.content} /></p>
                          </div>
                        ))}
                        {comments.length === 0 && <p className="py-5 text-sm text-muted-foreground">Noch keine Kommentare.</p>}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            )}
          </div>
        </main>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={handleEditDialogOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto" aria-busy={isSavingProject}>
          <DialogHeader>
            <DialogTitle>Projekt bearbeiten</DialogTitle>
            <DialogDescription>Titel, Beschreibung, Kategorie und Link sind erforderlich.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={isSavingProject} className="min-w-0 space-y-4 border-0 p-0">
            <div>
              <Label htmlFor="title">Titel</Label>
              <Input
                id="title"
                value={editProjectData.title}
                onChange={(e) => { const title = e.target.value; updateEditProjectData(prev => ({ ...prev, title })); }}
              />
            </div>
            <div>
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                value={editProjectData.description}
                onChange={(e) => { const description = e.target.value; updateEditProjectData(prev => ({ ...prev, description })); }}
              />
            </div>
            <div>
              <Label htmlFor="category">Kategorie</Label>
              <Input
                id="category"
                value={editProjectData.category}
                onChange={(e) => { const category = e.target.value; updateEditProjectData(prev => ({ ...prev, category })); }}
              />
            </div>
            <div>
              <Label htmlFor="tags">Tags (kommagetrennt)</Label>
              <Input
                id="tags"
                value={editProjectData.tags.join(', ')}
                onChange={(e) => { const tags = e.target.value.split(',').map(tag => tag.trim()); updateEditProjectData(prev => ({ ...prev, tags })); }}
              />
            </div>
            <div>
              <Label htmlFor="link">Link</Label>
              <Input
                id="link"
                value={editProjectData.link}
                onChange={(e) => { const link = e.target.value; updateEditProjectData(prev => ({ ...prev, link })); }}
              />
            </div>
            <div>
              <Label htmlFor="image">Bild</Label>
              <Input
                id="image"
                type="file"
                accept="image/*"
                ref={editImageInput}
                aria-describedby={editProjectData.image ? 'project-edit-image-name' : undefined}
                onChange={(e) => { const image = e.target.files?.[0] || null; updateEditProjectData(prev => ({ ...prev, image })); }}
              />
              {editProjectData.image && <p id="project-edit-image-name" className="mt-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">Ausgewählt: {editProjectData.image.name}</p>}
            </div>
          </fieldset>
          {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
          {editNotice && <p role="status" className="text-sm text-muted-foreground">{editNotice}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleEditDialogOpenChange(false)}>
              {isSavingProject ? 'Schließen' : 'Abbrechen'}
            </Button>
            <Button type="button" onClick={handleSubmitEditProject} disabled={isSavingProject}>
              {isSavingProject ? 'Wird gespeichert…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
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
    </AppShell>
  );
}
