'use client'

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PlusCircle, FileText, Video, Music, Box, ChevronRight, Pen, Trash2, ChevronUp, ChevronDown, Award } from 'lucide-react';
import { ContentList } from './ContentList';
import { NewMainTopicDialog } from './NewMainTopicDialog';
import { NewSubTopicDialog } from './NewSubTopicDialog';
import { CourseContent } from './types';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { CourseProgressState } from './hooks/useCourseProgress';
import { CourseProgress } from './components/CourseProgress';
import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';

interface CourseContentsSidebarProps {
  contents: CourseContent[];
  selectedContentId: string | null;
  onContentSelect: (contentId: string) => void;
  onEditClick: (contentId: string) => void;
  onDeleteClick: (content: CourseContent) => Promise<void> | void;
  isInlineEditing: string | null;
  inlineEditTitle: string;
  onInlineEditSubmit: (contentId: string, newTitle: string) => Promise<void> | void;
  setIsInlineEditing: (contentId: string | null) => void;
  setInlineEditTitle: (title: string) => void;
  onMoveUp: (contentId: string) => void;
  onMoveDown: (contentId: string) => void;
  mainContentId: string | null;
  mainTopicIndex: number;
  courseId: string;
  courseName: string;
  isLoading: boolean;
  canManage: boolean;
  progress: CourseProgressState | null;
  progressLoading: boolean;
  progressError: string | null;
  onProgressRetry: () => void;
  savingContentId: string | null;
  onMainContentSubmit?: (title: string) => Promise<CourseContent | void>;
  onSubContentSubmit: (title: string) => Promise<CourseContent | void>;
  onMainContentSelect?: (contentId: string | null) => void;
  onVisitedToggle: (contentId: string) => void;
}

export function CourseContentsSidebar({
  contents,
  selectedContentId,
  onContentSelect,
  onEditClick,
  onDeleteClick,
  isInlineEditing,
  inlineEditTitle,
  onInlineEditSubmit,
  setIsInlineEditing,
  setInlineEditTitle,
  onMoveUp,
  onMoveDown,
  mainContentId,
  mainTopicIndex,
  courseId,
  courseName,
  isLoading,
  canManage,
  progress,
  progressLoading,
  progressError,
  onProgressRetry,
  savingContentId,
  onMainContentSubmit,
  onSubContentSubmit,
  onMainContentSelect,
  onVisitedToggle,
}: CourseContentsSidebarProps) {
  const router = useRouter();
  const params = useParams();
  const [newSubtopicTitle, setNewSubtopicTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [newMainContentTitle, setNewMainContentTitle] = useState("");
  const completedIds = new Set(progress?.completedContentIds || []);
  const requiredIds = new Set(progress?.requiredContentIds || []);
  const learningIds = new Set(progress?.learningContentIds || []);
  const topicProgress = (content: CourseContent): { completed: number; total: number } => {
    const descendants = (node: CourseContent): CourseContent[] => [node, ...(node.subContents || []).flatMap(descendants)];
    const required = descendants(content).filter(node => requiredIds.has(node.id));
    return { completed: required.filter(node => completedIds.has(node.id)).length, total: required.length };
  };

  const toggleTopic = (topicId: string) => {
    const newExpanded = new Set(expandedTopics);
    if (newExpanded.has(topicId)) {
      newExpanded.delete(topicId);
    } else {
      newExpanded.add(topicId);
    }
    setExpandedTopics(newExpanded);
  };

  const handleDelete = async (content: CourseContent) => {
    try {
      setIsDeleting(true);
      await onDeleteClick(content);

    } catch (error) {
      console.error('Error deleting content:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleInlineEdit = async (contentId: string, newTitle: string) => {
    try {
      await onInlineEditSubmit(contentId, newTitle);

    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const handleMainContentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMainContentTitle.trim()) return;

    try {
      setIsSubmitting(true);
      if (!onMainContentSubmit) {
        throw new Error('Main content creation is unavailable');
      }
      await onMainContentSubmit(newMainContentTitle.trim());
      setNewMainContentTitle("");
      setIsDialogOpen(false); // Close the dialog after successful submission
    } catch (error) {
      console.error('Error creating main content:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteContent = async (content: CourseContent) => {
    try {
      // Rufe den übergebenen onDeleteClick Handler auf
      await onDeleteClick(content);

    } catch (error) {
      console.error('Error handling content deletion:', error);
    }
  };

  const handleSubContentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtopicTitle.trim()) return;

    try {
      setIsSubmitting(true);
      await onSubContentSubmit(newSubtopicTitle);

      setNewSubtopicTitle("");
      onMainContentSelect?.(null);

      // Automatically expand the parent topic
      if (mainContentId) {
        setExpandedTopics(prev => new Set(prev).add(mainContentId));
      }
    } catch (error) {
      console.error('Error creating subtopic:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  if (!contents) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p>No content available</p>
      </div>
    );
  }

  return (
    <div className="bg-muted/10 h-full flex flex-col">
      <div className="p-4 border-b border-border bg-background/50">
        <h3 className="font-semibold text-lg text-foreground tracking-tight line-clamp-1" title={courseName}>
          {courseName || 'Lade Kurs...'}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">Inhaltsverzeichnis</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-3">
          {contents.map((content, index) => (
            <div key={content.id} className="group relative rounded-md overflow-hidden transition-all duration-200">
              <div className={cn(
                "flex items-center justify-between p-2 rounded-md hover:bg-accent group/topic transition-colors",
                expandedTopics.has(content.id) && "bg-accent/50"
              )}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleTopic(content.id)}
                    aria-label={`${expandedTopics.has(content.id) ? 'Einklappen' : 'Ausklappen'}: ${content.title}`}
                    className="h-6 w-6 shrink-0 hover:bg-background/80"
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform duration-200 text-muted-foreground",
                        expandedTopics.has(content.id) ? "rotate-90" : ""
                      )}
                    />
                  </Button>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {canManage && editingContentId === content.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleInlineEdit(content.id, editingTitle);
                          setEditingContentId(null);
                        }}
                        className="flex-1 min-w-0"
                      >
                        <Input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => {
                            if (editingTitle.trim() !== '') {
                              handleInlineEdit(content.id, editingTitle);
                            }
                            setEditingContentId(null);
                          }}
                          className="h-7 text-sm"
                          autoFocus
                        />
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2 w-full">
                        <button
                          type="button"
                          className="font-medium text-sm text-left text-foreground/90 hover:text-primary transition-colors truncate"
                          onClick={() => onContentSelect(content.id)}
                          aria-current={selectedContentId === content.id ? 'page' : undefined}
                        >
                          {content.title}
                        </button>
                        {topicProgress(content).total > 0 && (
                          <span className="flex-shrink-0 text-xs text-muted-foreground" aria-label={`Fortschritt ${content.title}`}>
                            {topicProgress(content).completed === topicProgress(content).total
                              ? <CheckCircle className="h-3 w-3 text-green-600" aria-label="Abgeschlossen" />
                              : `${topicProgress(content).completed}/${topicProgress(content).total}`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {canManage && <div className="flex items-center gap-1 opacity-0 group-hover/topic:opacity-100 focus-within:opacity-100 transition-opacity duration-200 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-background"
                    onClick={() => {
                      setEditingContentId(content.id);
                      setEditingTitle(content.title);
                    }}
                  >
                    <Pen className="h-3 w-3 text-muted-foreground" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hauptthema löschen</AlertDialogTitle>
                        <AlertDialogDescription>
                          Möchten Sie dieses Hauptthema wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(content)}
                          disabled={isDeleting}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          {isDeleting ? "Wird gelöscht..." : "Löschen"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>}
              </div>

              {expandedTopics.has(content.id) && (
                <div className="pl-4 pr-1 pb-2 pt-1">
                  {content.subContents && content.subContents.length > 0 && (
                    <div className="relative pl-4 border-l border-border/40 ml-3 space-y-1">
                      <ContentList
                        contents={content.subContents}
                        selectedContentId={selectedContentId}
                        onContentSelect={onContentSelect}
                        onEditClick={onEditClick}
                        onDeleteClick={handleDeleteContent}
                        isInlineEditing={isInlineEditing}
                        inlineEditTitle={inlineEditTitle}
                        onInlineEditSubmit={onInlineEditSubmit}
                        setIsInlineEditing={setIsInlineEditing}
                        setInlineEditTitle={setInlineEditTitle}
                        onMoveUp={(_parentId, contentId) => onMoveUp(contentId)}
                        onMoveDown={(_parentId, contentId) => onMoveDown(contentId)}
                        mainContentId={content.id}
                        mainTopicIndex={index}
                        courseId={courseId}
                        isLoading={isLoading}
                        onVisitedToggle={onVisitedToggle}
                        canManage={canManage}
                        completedIds={completedIds}
                        learningIds={learningIds}
                        progressDisabled={progressLoading || !!savingContentId || !progress || !!progress.enrollment.completedAt}
                      />
                    </div>
                  )}

                  {canManage && <Dialog
                    open={mainContentId === content.id}
                    onOpenChange={(open) => {
                      if (!open) {
                        onMainContentSelect?.(null);
                        setNewSubtopicTitle("");
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onMainContentSelect?.(content.id)}
                        className="w-full mt-2 ml-4 text-xs h-7 justify-start text-muted-foreground hover:text-primary px-2"
                      >
                        <PlusCircle className="h-3 w-3 mr-2" />
                        <span>Inhalt hinzufügen</span>
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Neues Unterthema erstellen</DialogTitle>
                        <DialogDescription>
                          Geben Sie einen Titel für das neue Unterthema ein.
                        </DialogDescription>
                      </DialogHeader>

                      <form onSubmit={handleSubContentSubmit} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="title">Titel</Label>
                          <Input
                            id="title"
                            value={newSubtopicTitle}
                            onChange={(e) => setNewSubtopicTitle(e.target.value)}
                            placeholder="Titel des Unterthemas"
                          />
                        </div>

                        <DialogFooter>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              onMainContentSelect?.(null);
                              setNewSubtopicTitle("");
                            }}
                          >
                            Abbrechen
                          </Button>
                          <Button
                            type="submit"
                            disabled={!newSubtopicTitle.trim() || isSubmitting}
                          >
                            {isSubmitting ? "Wird erstellt..." : "Erstellen"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add new main topic button */}
        {canManage && <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button
              onClick={() => setIsDialogOpen(true)}
              variant="outline"
              className="w-full border-dashed border-border hover:border-primary/50 text-muted-foreground hover:bg-accent"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Neues Kapitel
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Neues Kapitel</DialogTitle>
              <DialogDescription>
                Geben Sie einen Titel für das neue Kapitel ein.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleMainContentSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mainTitle">Titel</Label>
                <Input
                  id="mainTitle"
                  value={newMainContentTitle}
                  onChange={(e) => setNewMainContentTitle(e.target.value)}
                  placeholder="Titel des Kapitels"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  disabled={!newMainContentTitle || newMainContentTitle.length === 0 || isSubmitting}
                >
                  {isSubmitting ? "Wird erstellt..." : "Erstellen"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}

      </div>
      {(progress || progressLoading || progressError) && <CourseProgress
        progress={progress}
        isLoading={progressLoading}
        error={progressError}
        onRetry={onProgressRetry}
        courseId={courseId}
        courseName={courseName}
      />}
    </div>
  );
}
