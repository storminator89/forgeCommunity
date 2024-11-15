'use client'

import { useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PlusCircle, FileText, Video, Music, Box, ChevronRight, Pen, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { ContentList } from './ContentList';
import { NewMainTopicDialog } from './NewMainTopicDialog';
import { NewSubTopicDialog } from './NewSubTopicDialog';
import { CourseContent } from './types';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

interface CourseContentsSidebarProps {
  mainContents: CourseContent[];
  selectedContentId: string | null;
  isTopicsSidebarOpen: boolean;
  setIsTopicsSidebarOpen: (isOpen: boolean) => void;
  onAddSubContent: (mainContentId: string | null) => void;
  onDeleteContent: (content: CourseContent) => Promise<void>;
  onEditContent: (content: CourseContent) => void;
  onContentSelect: (id: string) => void;
  onContentDrop: (draggedId: string, targetId: string, position: "before" | "after" | "inside") => Promise<void>;
  onInlineEditSubmit: (contentId: string, newTitle: string) => void;
  setIsInlineEditing: (id: string | null) => void;
  setInlineEditTitle: (title: string) => void;
  onMainContentSubmit: (title: string) => Promise<void>;
  onSubContentSubmit: (title: string) => Promise<void>;
  setNewMainContentTitle: (title: string) => void;
  newMainContentTitle: string;
  startResizing: (e: React.MouseEvent) => void;
  onMoveSubContentUp?: (mainContentId: string, subContentId: string) => Promise<void>;
  onMoveSubContentDown?: (mainContentId: string, subContentId: string) => Promise<void>;
  setMainContents: React.Dispatch<React.SetStateAction<CourseContent[]>>;
}

export function CourseContentsSidebar({
  mainContents,
  selectedContentId,
  isTopicsSidebarOpen,
  setIsTopicsSidebarOpen,
  onAddSubContent,
  onDeleteContent,
  onEditContent,
  onContentSelect,
  onContentDrop,
  onInlineEditSubmit,
  setIsInlineEditing,
  setInlineEditTitle,
  onMainContentSubmit,
  onSubContentSubmit,
  setNewMainContentTitle,
  newMainContentTitle,
  startResizing,
  onMoveSubContentUp,
  onMoveSubContentDown,
  setMainContents,
}: CourseContentsSidebarProps) {
  const router = useRouter();
  const params = useParams();
  const [newSubtopicTitle, setNewSubtopicTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentMainContentId, setCurrentMainContentId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

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
      onDeleteContent(content);

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
        const firstContent = mainContents[0];
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

  return (
    <div
      style={{ 
        width: isTopicsSidebarOpen ? '400px' : '0px',
        minWidth: isTopicsSidebarOpen ? '400px' : '0px',
        maxWidth: isTopicsSidebarOpen ? '500px' : '0px',
      }}
      className="bg-white dark:bg-gray-800 overflow-y-auto border-r border-gray-200 dark:border-gray-700 transition-all duration-300 ease-in-out relative flex-shrink-0"
    >
      <div className={`p-4 ${isTopicsSidebarOpen ? 'block' : 'hidden'}`}>
        <h3 className="text-lg font-semibold mb-4">Lernpfad</h3>
        <div className="space-y-4">
          {mainContents.map((content) => (
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
                              const response = await fetch(`/api/courses/${params.courseId}/contents/${content.id}`, {
                                method: 'DELETE',
                              });

                              if (!response.ok) {
                                throw new Error('Failed to delete content');
                              }

                              // Update local state by removing the deleted content
                              setMainContents(prev => prev.filter(c => c.id !== content.id));
                              
                              // Call the onDeleteContent prop to notify parent
                              onDeleteContent(content);
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
                    <div className="ml-6 space-y-1 mt-2 transition-all duration-300 ease-in-out">
                      {content.subContents.map((subContent) => (
                        <div
                          key={subContent.id}
                          onClick={() => onContentSelect(subContent.id)}
                          className={cn(
                            "p-2 rounded-md cursor-pointer flex items-center space-x-2 group relative",
                            "transition-all duration-200 ease-in-out",
                            "hover:bg-accent/80 hover:translate-x-1",
                            selectedContentId === subContent.id ? "bg-accent shadow-sm" : "hover:shadow-sm",
                            "border border-transparent hover:border-accent/50"
                          )}
                        >
                          <div className="flex items-center space-x-2 flex-1 min-w-0">
                            {subContent.type === 'TEXT' && <FileText className="h-4 w-4 text-primary/70 shrink-0" />}
                            {subContent.type === 'VIDEO' && <Video className="h-4 w-4 text-primary/70 shrink-0" />}
                            {subContent.type === 'AUDIO' && <Music className="h-4 w-4 text-primary/70 shrink-0" />}
                            {subContent.type === 'H5P' && <Box className="h-4 w-4 text-primary/70 shrink-0" />}
                            {editingContentId === subContent.id ? (
                              <Input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onInlineEditSubmit(subContent.id, editingTitle);
                                    setEditingContentId(null);
                                    setEditingTitle("");
                                  } else if (e.key === 'Escape') {
                                    setEditingContentId(null);
                                    setEditingTitle("");
                                  }
                                }}
                                onBlur={() => {
                                  setEditingContentId(null);
                                  setEditingTitle("");
                                }}
                                className="flex-1 h-7 text-sm bg-transparent focus-visible:ring-1 focus-visible:ring-primary"
                                autoFocus
                              />
                            ) : (
                              <span className="flex-1 text-sm truncate">{subContent.title}</span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1 absolute right-2 bg-background/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200 ease-in-out px-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 hover:bg-accent/50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onMoveSubContentUp) {
                                  onMoveSubContentUp(content.id, subContent.id);
                                }
                              }}
                            >
                              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 hover:bg-accent/50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onMoveSubContentDown) {
                                  onMoveSubContentDown(content.id, subContent.id);
                                }
                              }}
                            >
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                            </Button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingContentId(subContent.id);
                                setEditingTitle(subContent.title);
                              }}
                              className="p-1 rounded-sm hover:bg-accent/50"
                            >
                              <Pen className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                            </button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1 rounded-sm hover:bg-accent/50"
                                  disabled={isDeleting}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                                </button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Inhalt löschen</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Möchten Sie diesen Inhalt wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
                                    Abbrechen
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(subContent);
                                    }}
                                    className="bg-destructive hover:bg-destructive/90"
                                    disabled={isDeleting}
                                  >
                                    {isDeleting ? 'Wird gelöscht...' : 'Löschen'}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <Dialog 
                    open={currentMainContentId === content.id} 
                    onOpenChange={(open) => {
                      if (!open) {
                        setCurrentMainContentId(null);
                        setNewSubtopicTitle("");
                      } else {
                        onAddSubContent(content.id);
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCurrentMainContentId(content.id)}
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
                            setCurrentMainContentId(null);
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
                              setCurrentMainContentId(null);
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

            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newMainContentTitle.trim()) return;
              
              setIsSubmitting(true);
              try {
                await onMainContentSubmit(newMainContentTitle);
                setIsDialogOpen(false);
              } catch (error) {
                console.error('Error creating main topic:', error);
              } finally {
                setIsSubmitting(false);
              }
            }} className="space-y-4">
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
      </div>
    </div>
  );
}