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
  onSubContentSubmit: (title: string) => Promise<void>;
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
      const response = await fetch(`/api/courses/${params.courseId}/contents/${content.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete content');
      }

      // Update parent's state
      onDeleteClick(content);

      // Update local state immediately
      setMainContents(prev => {
        // If deleting a main content
        if (!content.parentId) {
          return prev.filter(c => c.id !== content.id);
        }
        
        // If deleting a subcontent
        return prev.map(main => {
          if (main.subContents) {
            return {
              ...main,
              subContents: main.subContents.filter(sub => sub.id !== content.id)
            };
          }
          return main;
        });
      });

      // If the deleted content was selected, select the first available content
      if (selectedContentId === content.id) {
        const firstContent = contents[0];
        if (firstContent) {
          onContentSelect(firstContent.id);
        }
      }
    } catch (error) {
      console.error('Error deleting content:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string, position: "before" | "after" | "inside") => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    onContentDrop(draggedId, targetId, position);
  };

  const handleInlineEdit = async (contentId: string, newTitle: string) => {
    try {
      await onInlineEditSubmit(contentId, newTitle);
      setEditingContentId(null);
      setEditingTitle('');
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
    <div
      className="bg-white dark:bg-gray-800 overflow-y-auto border-r border-gray-200 dark:border-gray-700 transition-all duration-300 ease-in-out relative flex-shrink-0"
    >
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4">{courseName || 'Loading course...'}</h3>
        <div className="space-y-4">
          {mainContents.map((content, index) => (
            <div key={content.id} className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center flex-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleTopic(content.id)}
                    className="h-6 w-6"
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform duration-200",
                        expandedTopics.has(content.id) ? "rotate-90" : ""
                      )}
                    />
                  </Button>
                  {editingContentId === content.id ? (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          const response = await fetch(`/api/courses/${params.courseId}/contents/${content.id}`, {
                            method: 'PUT',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              title: editingTitle,
                            }),
                          });

                          if (!response.ok) {
                            throw new Error('Failed to update title');
                          }

                          // Update local state
                          setMainContents(prev =>
                            prev.map(c =>
                              c.id === content.id
                                ? { ...c, title: editingTitle }
                                : c
                            )
                          );

                          setEditingContentId(null);
                          setEditingTitle('');
                          onInlineEditSubmit(content.id, editingTitle);
                        } catch (error) {
                          console.error('Error updating title:', error);
                        }
                      }}
                      className="flex-1"
                    >
                      <Input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => {
                          setEditingContentId(null);
                          setEditingTitle('');
                        }}
                        className="h-6 py-1 px-2 text-sm"
                        autoFocus
                      />
                    </form>
                  ) : (
                    <span className="font-semibold ml-1">{content.title}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setEditingContentId(content.id);
                      setEditingTitle(content.title);
                    }}
                  >
                    <Pen className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                      >
                        <Trash2 className="h-4 w-4" />
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
                          onClick={async () => {
                            try {
                              await handleDelete(content);
                            } catch (error) {
                              console.error('Error deleting content:', error);
                            }
                          }}
                        >
                          Löschen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              {expandedTopics.has(content.id) && (
                <>
                  {content.subContents && content.subContents.length > 0 && (
                    <div className="ml-6 space-y-1 mt-2">
                      <ContentList
                        contents={content.subContents}
                        selectedContentId={selectedContentId}
                        onContentSelect={onContentSelect}
                        onEditClick={onEditClick}
                        onDeleteClick={onDeleteClick}
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
                        courseName={courseName}
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
                        className="w-full flex items-center justify-center text-muted-foreground hover:text-foreground group border border-dashed border-gray-300 dark:border-gray-600 rounded-md py-2 mt-2"
                      >
                        <PlusCircle className="h-4 w-4 mr-2 group-hover:text-primary" />
                        Unterthema hinzufügen
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Neues Unterthema erstellen</DialogTitle>
                        <DialogDescription>
                          Geben Sie einen Titel für das neue Unterthema ein.
                        </DialogDescription>
                      </DialogHeader>

                      <form onSubmit={(e) => {
                        e.preventDefault();
                        if (!newSubtopicTitle.trim()) return;
                        
                        setIsSubmitting(true);
                        onSubContentSubmit(newSubtopicTitle)
                          .then(() => {
                            setNewSubtopicTitle("");
                            onMainContentSelect?.(null);
                          })
                          .catch((error) => {
                            console.error('Error creating subtopic:', error);
                          })
                          .finally(() => {
                            setIsSubmitting(false);
                          });
                      }} className="space-y-4">
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
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add new main topic button */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              onClick={() => setIsDialogOpen(true)} 
              className="mt-4 w-full flex items-center"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Neues Hauptthema
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neues Hauptthema</DialogTitle>
              <DialogDescription>
                Geben Sie einen Titel für das neue Hauptthema ein.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleMainContentSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mainTitle">Titel</Label>
                <Input
                  id="mainTitle"
                  value={newMainContentTitle}
                  onChange={(e) => setNewMainContentTitle(e.target.value)}
                  placeholder="Titel des Hauptthemas"
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
          <div className="mt-8 pt-4 border-t">
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
                    className="w-full gap-2 bg-green-500 hover:bg-green-600"
                    disabled={isGeneratingCertificate || !allTopicsCompleted}
                  >
                    {isGeneratingCertificate ? (
                      <>Generiere Zertifikat...</>
                    ) : (
                      <>
                        <Award className="w-4 h-4" />
                        Zertifikat herunterladen
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {allTopicsCompleted ? (
                    <p>Herzlichen Glückwunsch! Sie haben den Kurs erfolgreich abgeschlossen.</p>
                  ) : (
                    <div className="max-w-xs">
                      <p className="font-semibold mb-1">Kurs noch nicht abgeschlossen</p>
                      <p className="text-sm text-gray-500">Um das Zertifikat freizuschalten, müssen Sie alle Themen des Kurses abschließen. Markieren Sie die Themen als abgeschlossen, indem Sie auf den Kreis neben jedem Thema klicken.</p>
                    </div>
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