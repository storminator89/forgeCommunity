'use client'

import { CourseContent } from './types';
import { Button } from "@/components/ui/button";
import { Edit, Trash2, ChevronUp, ChevronDown, Check, Circle, BookOpen, Download, Award } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { isPageVisited, togglePageVisited, getVisitedPages } from './utils/visitedPages';
import { useState, useMemo, useEffect } from 'react';
import { cn } from "@/lib/utils";
import { generateCertificate, CertificateData } from './utils/generateCertificate';
import { useSession } from 'next-auth/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CourseProgress } from './components/CourseProgress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

interface ContentListProps {
  contents: CourseContent[];
  selectedContentId: string | null;
  onContentSelect: (id: string) => void;
  onEditClick: (content: CourseContent) => void;
  onDeleteClick: (content: CourseContent) => void;
  isInlineEditing: string | null;
  inlineEditTitle: string;
  onInlineEditSubmit: (contentId: string, newTitle: string) => Promise<void>;
  setIsInlineEditing: (id: string | null) => void;
  setInlineEditTitle: (title: string) => void;
  onMoveUp?: (mainContentId: string, subContentId: string) => Promise<void>;
  onMoveDown?: (mainContentId: string, subContentId: string) => Promise<void>;
  mainContentId?: string;
  mainTopicIndex?: number;
  courseId: string;
  courseName: string;
  onVisitedToggle?: (contentId: string) => void;
  onCompletionChange?: (isCompleted: boolean) => void;
}

export function ContentList({
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
  onVisitedToggle,
  onCompletionChange,
}: ContentListProps) {
  const [forceUpdate, setForceUpdate] = useState({});
  const [isGeneratingCertificate, setIsGeneratingCertificate] = useState(false);
  const { data: session } = useSession();

  useEffect(() => {
    if (!courseName) {
      console.log('No course name available');
      return;
    }
    console.log('ContentList received courseName:', courseName);
  }, [courseName]);

  // Ensure contents is never undefined
  const safeContents = contents || [];

  // Check if all main topics and subtopics are completed
  const allTopicsCompleted = useMemo(() => {
    // Debug: Log visited pages
    const visitedPages = getVisitedPages(courseId);
    console.log('\nAll visited pages:', visitedPages);

    // First check if there are any main topics with subtopics
    const hasTopicsWithSubtopics = safeContents.some(topic => 
      topic.subContents && topic.subContents.length > 0
    );

    // If we have main topics with subtopics, we MUST check them
    if (hasTopicsWithSubtopics) {
      // Only consider topics with subtopics for completion
      const isCompleted = safeContents.every(mainTopic => {
        console.log('\nChecking main topic:', mainTopic.title);
        
        // Skip main topics without subtopics in this check
        if (!mainTopic.subContents || mainTopic.subContents.length === 0) {
          console.log(`Skipping main topic ${mainTopic.title} - no subtopics`);
          return true;
        }

        // Check if all subtopics are completed
        const subtopicsCompleted = mainTopic.subContents.every(subTopic => {
          const isCompleted = isPageVisited(courseId, subTopic.id);
          console.log(`Subtopic ${subTopic.title} (${subTopic.id}): ${isCompleted ? 'completed' : 'not completed'}`);
          return isCompleted;
        });

        console.log(`Main topic ${mainTopic.title}: ${subtopicsCompleted ? 'all subtopics completed' : 'not all subtopics completed'}`);
        return subtopicsCompleted;
      });

      console.log('\nFinal result - All topics with subtopics completed:', isCompleted);
      return isCompleted;
    } else {
      // If no topics have subtopics, check main topics directly
      const isCompleted = safeContents.every(mainTopic => {
        const topicCompleted = isPageVisited(courseId, mainTopic.id);
        console.log(`Main topic ${mainTopic.title} (${mainTopic.id}): ${topicCompleted ? 'completed' : 'not completed'}`);
        return topicCompleted;
      });

      console.log('\nFinal result - All single topics completed:', isCompleted);
      return isCompleted;
    }
  }, [safeContents, courseId, forceUpdate]);

  useEffect(() => {
    if (onCompletionChange) {
      onCompletionChange(allTopicsCompleted);
    }
  }, [allTopicsCompleted, onCompletionChange]);

  const handleVisitedToggle = (e: React.MouseEvent, contentId: string) => {
    e.stopPropagation();
    togglePageVisited(courseId, contentId);
    setForceUpdate({}); // Force update to recalculate completion status
    
    // Notify parent components about the change
    if (onVisitedToggle) {
      onVisitedToggle(contentId);
    }
    if (onCompletionChange) {
      const newCompletionStatus = isPageVisited(courseId, contentId);
      onCompletionChange(newCompletionStatus);
    }
  };

  const handleCertificateDownload = async () => {
    if (!session?.user?.name) {
      console.error('No user name available');
      return;
    }
    
    if (!courseName) {
      console.error('No course name available');
      return;
    }
    
    try {
      console.log('Generating certificate with data:', {
        userName: session.user.name,
        courseName,
        completionDate: new Date(),
        courseId,
      });
      
      setIsGeneratingCertificate(true);
      const certificateData: CertificateData = {
        userName: session.user.name,
        courseName,
        completionDate: new Date(),
        courseId,
      };
      
      const blob = await generateCertificate(certificateData);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${courseName.replace(/\s+/g, '-')}-Zertifikat.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating certificate:', error);
    } finally {
      setIsGeneratingCertificate(false);
    }
  };

  const handleDelete = async (content: CourseContent) => {
    try {
      console.log('ContentList: Starting delete operation for subcontent:', content);
      const response = await fetch(`/api/courses/${courseId}/contents/${content.id}`, {
        method: 'DELETE',
      });

      console.log('Delete response status:', response.status);
      const responseData = await response.json();
      console.log('Delete response data:', responseData);

      if (!response.ok) {
        throw new Error(`Failed to delete content: ${responseData.error || 'Unknown error'}`);
      }

      // Sofortige UI-Aktualisierung durch Aufruf des Parent-Handlers
      await onDeleteClick(content);

      // Dialog schließen (falls offen)
      const dialog = document.querySelector('[role="alertdialog"]');
      if (dialog) {
        const closeButton = dialog.querySelector('button[data-state="closed"]');
        closeButton?.click();
      }

      // Parent aktualisieren und neu rendern
      if (mainContentId) {
        window.dispatchEvent(new CustomEvent('refreshSidebar', {
          detail: { mainContentId }
        }));
      }

    } catch (error) {
      console.error('Error in ContentList delete handler:', error);
    }
  };

  const handleMoveContent = async (direction: 'up' | 'down', content: CourseContent) => {
    if (!mainContentId) return;

    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${content.id}/reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          direction,
          mainContentId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update order');
      }

      // Rest der UI-Aktualisierung bleibt gleich
      if (direction === 'up') {
        onMoveUp?.(mainContentId, content.id);
      } else {
        onMoveDown?.(mainContentId, content.id);
      }

    } catch (error) {
      console.error('Error updating content order:', error);
    }
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        {safeContents.map((content, index) => (
          <li
            key={content.id}
            className={cn(
              "relative",
              selectedContentId === content.id && "bg-muted"
            )}
            onClick={() => onContentSelect(content.id)}
          >
            <div className="p-2 flex items-center group/item hover:bg-accent hover:text-accent-foreground">
              {/* Visited/Progress indicator */}
              <button
                onClick={(e) => handleVisitedToggle(e, content.id)}
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 relative group/check",
                  isPageVisited(courseId, content.id) 
                    ? "bg-green-500/10 text-green-500 hover:bg-green-500/20" 
                    : "bg-gray-100 dark:bg-gray-800 text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                {isPageVisited(courseId, content.id) ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <BookOpen className="w-4 h-4" />
                )}
              </button>

              {/* Content title with inline editing */}
              {isInlineEditing === content.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onInlineEditSubmit(content.id, inlineEditTitle);
                  }}
                  className="flex-1 ml-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Input
                    type="text"
                    value={inlineEditTitle}
                    onChange={(e) => setInlineEditTitle(e.target.value)}
                    onBlur={() => {
                      if (inlineEditTitle.trim() !== '') {
                        onInlineEditSubmit(content.id, inlineEditTitle);
                      }
                      setIsInlineEditing(null);
                    }}
                    className="h-7 py-1 px-2 text-sm"
                    autoFocus
                  />
                </form>
              ) : (
                <span className="flex-1 ml-2">{content.title}</span>
              )}

              {/* Action buttons */}
              <div className="opacity-0 group-hover/item:opacity-100 transition-opacity duration-200 flex items-center gap-1">
                {/* Move up/down buttons if provided */}
                {onMoveUp && onMoveDown && mainContentId && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveContent('up', content);
                      }}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveContent('down', content);
                      }}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </>
                )}

                {/* Edit button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsInlineEditing(content.id);
                    setInlineEditTitle(content.title);
                    console.log(`Editing content with ID: ${content.id}`);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>

                {/* Delete button */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Unterthema löschen</AlertDialogTitle>
                      <AlertDialogDescription>
                        Möchten Sie dieses Unterthema wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => handleDelete(content)}
                      >
                        Löschen
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}