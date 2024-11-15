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

  return (
    <div className="space-y-4">
      {/* Main content list */}
      <ul className="space-y-1">
        {safeContents.map((content, index) => (
          <li
            key={content.id}
            className={cn(
              "relative",
              selectedContentId === content.id && "bg-muted"
            )}
          >
            <div
              className="p-2 flex items-center group/item"
              onClick={() => mainContentId ? onContentSelect(content.id) : null}
            >
              <div className="flex items-center flex-1 min-w-0">
                {!mainContentId ? (
                  <div className="flex items-center space-x-3">
                    <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">
                      {(mainTopicIndex ?? 0) + 1}
                    </span>
                    <span className="font-medium truncate">{content.title}</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-3 min-w-0">
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
                        <Check className="w-4 h-4 transition-transform duration-200 group-hover/check:scale-110" />
                      ) : (
                        <BookOpen className="w-4 h-4 transition-transform duration-200 group-hover/check:scale-110" />
                      )}
                      <span className="absolute -top-9 left-1/2 transform -translate-x-1/2 px-2 py-1 bg-popover rounded-md text-xs font-medium text-popover-foreground shadow-md opacity-0 group-hover/check:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none border">
                        {isPageVisited(courseId, content.id) ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
                      </span>
                    </button>
                    <span className={cn(
                      "truncate text-sm",
                      isPageVisited(courseId, content.id) && "text-muted-foreground line-through decoration-[1.5px]"
                    )}>
                      {content.title}
                    </span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 ml-2">
                {onMoveUp && onMoveDown && (
                  <div className="opacity-0 group-hover/item:opacity-100 transition-opacity duration-200 flex items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onMoveUp) onMoveUp(mainContentId!, content.id);
                      }}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onMoveDown) onMoveDown(mainContentId!, content.id);
                      }}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <div className="opacity-0 group-hover/item:opacity-100 transition-opacity duration-200 flex items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditClick(content);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteClick(content);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}