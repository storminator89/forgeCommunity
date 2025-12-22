'use client'

import { useRef, useState, useEffect } from 'react';
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
import { isPageVisited } from './utils/visitedPages';
import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';

interface CourseContentsSidebarProps {
  contents: CourseContent[];
  selectedContentId: string | null;
  onContentSelect: (contentId: string) => void;
  onEditClick: (contentId: string) => void;
  onDeleteClick: (content: CourseContent) => void;
  isInlineEditing: string | null;
  inlineEditTitle: string;
  onInlineEditSubmit: (contentId: string, newTitle: string) => void;
  setIsInlineEditing: (contentId: string | null) => void;
  setInlineEditTitle: (title: string) => void;
  onMoveUp: (contentId: string) => void;
  onMoveDown: (contentId: string) => void;
  mainContentId: string | null;
  mainTopicIndex: number;
  courseId: string;
  courseName: string;
  isLoading: boolean;
  forceUpdate?: boolean;
  onSubContentSubmit: (title: string) => Promise<CourseContent | void>;
  onMainContentSelect?: (contentId: string | null) => void;
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
  forceUpdate,
  onSubContentSubmit,
  onMainContentSelect,
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
  const [mainContents, setMainContents] = useState<CourseContent[]>(contents || []);
  const [isGeneratingCertificate, setIsGeneratingCertificate] = useState(false);
  const [allTopicsCompleted, setAllTopicsCompleted] = useState(false);

  useEffect(() => {
    setMainContents(contents || []);
  }, [contents]);

  const checkCompletion = () => {
    // Check if there are any main topics with subtopics
    const hasTopicsWithSubtopics = contents.some(topic =>
      topic.subContents && topic.subContents.length > 0
    );

    if (hasTopicsWithSubtopics) {
      // Only consider topics with subtopics for completion
      return contents.every(mainTopic => {
        // Skip main topics without subtopics in this check
        if (!mainTopic.subContents || mainTopic.subContents.length === 0) {
          return true;
        }

        // Check if all subtopics are completed
        return mainTopic.subContents.every(subTopic =>
          isPageVisited(courseId, subTopic.id)
        );
      });
    } else {
      // If no topics have subtopics, check main topics directly
      return contents.every(mainTopic =>
        isPageVisited(courseId, mainTopic.id)
      );
    }
  };

  useEffect(() => {
    // Update allTopicsCompleted state
    const isCompleted = checkCompletion();
    if (isCompleted !== allTopicsCompleted) {
      setAllTopicsCompleted(isCompleted);
    }
  }, [contents, courseId, forceUpdate, allTopicsCompleted]);

  useEffect(() => {
    const handleVisitedPagesChange = (event: CustomEvent) => {
      const { courseId: changedCourseId } = event.detail;
      if (changedCourseId === courseId) {
        const isCompleted = checkCompletion();
        if (isCompleted !== allTopicsCompleted) {
          setAllTopicsCompleted(isCompleted);
        }
      }
    };

    // Add event listener
    window.addEventListener('visitedPagesChanged', handleVisitedPagesChange as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('visitedPagesChanged', handleVisitedPagesChange as EventListener);
    };
  }, [courseId, allTopicsCompleted, contents]);

  // Hinzufügen eines Event Listeners für die Sidebar-Aktualisierung
  useEffect(() => {
    const handleRefresh = (event: CustomEvent) => {
      const { mainContentId } = event.detail;
      // Neu laden der Inhalte für das Hauptthema
      const parent = mainContents.find(c => c.id === mainContentId);
      if (parent) {
        setMainContents(prev =>
          prev.map(c => c.id === mainContentId ? {
            ...c,
            subContents: (c.subContents || []).filter(sub =>
              sub.id !== selectedContentId
            )
          } : c)
        );
      }
    };

    window.addEventListener('refreshSidebar', handleRefresh as EventListener);
    return () => {
      window.removeEventListener('refreshSidebar', handleRefresh as EventListener);
    };
  }, [mainContents, selectedContentId]);

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

      // API-Aufruf zum Löschen
      const response = await fetch(`/api/courses/${courseId}/contents/${content.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete content');
      }

      // Update local state
      setMainContents(prev => prev.map(main => {
        if (main.id === content.parentId) {
          return {
            ...main,
            subContents: (main.subContents || []).filter(sub => sub.id !== content.id)
          };
        }
        return main;
      }));

      // Call the parent's delete handler
      onDeleteClick(content);

    } catch (error) {
      console.error('Error deleting content:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = async (contentId: string, newTitle: string) => {
    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${contentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        throw new Error('Failed to update content');
      }

      // Update local state for both main topics and subtopics
      setMainContents(prev =>
        prev.map(main => {
          if (main.id === contentId) {
            return { ...main, title: newTitle };
          }
          if (main.subContents) {
            return {
              ...main,
              subContents: main.subContents.map(sub =>
                sub.id === contentId ? { ...sub, title: newTitle } : sub
              )
            };
          }
          return main;
        })
      );
    } catch (error) {
      console.error('Error updating content:', error);
    }
  };

  const handleInlineEdit = async (contentId: string, newTitle: string) => {
    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${contentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        throw new Error('Failed to update title');
      }

      // Update local state
      setMainContents(prev =>
        prev.map(c =>
          c.id === contentId
            ? { ...c, title: newTitle }
            : c
        )
      );

      // Update parent state
      onEditClick(contentId);

    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const handleMainContentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMainContentTitle.trim()) return;

    try {
      setIsSubmitting(true);
      const response = await fetch(`/api/courses/${courseId}/contents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: newMainContentTitle,
          type: 'TEXT',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create main content');
      }

      const newContent = await response.json();
      setMainContents(prev => [...prev, newContent]);
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
      // Update local state immediately
      setMainContents(prev => {
        const updated = prev.map(main => {
          if (main.id === content.parentId) {
            // Wenn es ein Unterthema ist
            return {
              ...main,
              subContents: main.subContents?.filter(sub => sub.id !== content.id) || []
            };
          }
          return main;
        });
        return updated;
      });

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
      const newContent = await onSubContentSubmit(newSubtopicTitle);

      // Update local state immediately
      if (newContent) {
        const parentContent = mainContents.find(c => c.id === mainContentId);
        if (parentContent) {
          setMainContents(prev => prev.map(c =>
            c.id === mainContentId
              ? {
                ...c,
                subContents: [...(c.subContents || []), newContent]
              }
              : c
          ));
        }
      }

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
          {mainContents.map((content, index) => (
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
                    {editingContentId === content.id ? (
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
                        <span
                          className="font-medium text-sm cursor-pointer text-foreground/90 hover:text-primary transition-colors truncate"
                          onClick={() => {
                            setEditingContentId(content.id);
                            setEditingTitle(content.title);
                          }}
                        >
                          {content.title}
                        </span>
                        {content.subContents?.every(sub => isPageVisited(courseId, sub.id)) && content.subContents.length > 0 && (
                          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-500 px-1.5 py-0.5 bg-green-50 dark:bg-green-900/10 rounded text-xs font-medium flex-shrink-0">
                            <CheckCircle className="h-3 w-3" />
                          </div>
                        )}
                        {content.subContents?.some(sub => isPageVisited(courseId, sub.id)) &&
                          !content.subContents?.every(sub => isPageVisited(courseId, sub.id)) && (
                            <div className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium flex-shrink-0 bg-muted px-1.5 py-0.5 rounded">
                              {(() => {
                                const total = content.subContents?.length || 0;
                                const completed = content.subContents?.filter(sub => isPageVisited(courseId, sub.id)).length || 0;
                                const percentage = Math.round((completed / total) * 100);
                                return `${percentage}%`;
                              })()}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover/topic:opacity-100 transition-opacity duration-200 flex-shrink-0">
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
                </div>
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
                        onMoveUp={onMoveUp}
                        onMoveDown={onMoveDown}
                        mainContentId={content.id}
                        mainTopicIndex={index}
                        courseId={courseId}
                        isLoading={isLoading}
                      />
                    </div>
                  )}

                  <Dialog
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
                  </Dialog>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add new main topic button */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
        </Dialog>

        {/* Certificate button at the bottom of the sidebar */}
        {contents.length > 0 && (
          <div className="fixed bottom-0 left-0 w-full p-4 border-t border-border bg-background/95 backdrop-blur z-10" style={{ width: 'inherit' }}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={async () => {
                      try {
                        setIsGeneratingCertificate(true);
                        const response = await fetch(`/api/courses/${courseId}/certificate`, {
                          method: 'POST',
                        });

                        if (!response.ok) {
                          throw new Error('Failed to generate certificate');
                        }

                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${courseName.replace(/\s+/g, '_')}_Certificate.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                      } catch (error) {
                        console.error('Error generating certificate:', error);
                      } finally {
                        setIsGeneratingCertificate(false);
                      }
                    }}
                    className={cn(
                      "w-full transition-all duration-200",
                      allTopicsCompleted
                        ? "bg-green-600 hover:bg-green-700 text-white shadow-sm"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                    disabled={isGeneratingCertificate || !allTopicsCompleted}
                  >
                    {isGeneratingCertificate ? (
                      <>Generiere Zertifikat...</>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <Award className="w-4 h-4" />
                        <span>Zertifikat</span>
                      </div>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {allTopicsCompleted ? (
                    <p>Kurs abgeschlossen - Zertifikat herunterladen</p>
                  ) : (
                    <p>Schließen Sie alle Themen ab, um das Zertifikat freizuschalten</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    </div>
  );
}