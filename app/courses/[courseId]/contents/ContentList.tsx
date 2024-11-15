'use client'

import { CourseContent } from './types';
import { Button } from "@/components/ui/button";
import { Edit, Trash2, ChevronUp, ChevronDown, Check, Circle, BookOpen } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { isPageVisited, togglePageVisited, getVisitedPages } from './utils/visitedPages';
import { useState, useMemo } from 'react';
import { cn } from "@/lib/utils";

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
}: ContentListProps) {
  const [, setForceUpdate] = useState({});

  // Calculate progress for the current section
  const progress = useMemo(() => {
    if (!contents.length) return 0;
    const visitedCount = contents.filter(content => isPageVisited(courseId, content.id)).length;
    return Math.round((visitedCount / contents.length) * 100);
  }, [contents, courseId, getVisitedPages(courseId)]);

  const handleVisitedToggle = (e: React.MouseEvent, contentId: string) => {
    e.stopPropagation();
    togglePageVisited(courseId, contentId);
    setForceUpdate({});
  };

  return (
    <div className="space-y-4">
      {/* Progress indicator for sections */}
      {mainContentId && contents.length > 0 && (
        <div className="px-2">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-muted-foreground">Fortschritt</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full transition-all duration-500 ease-out rounded-full",
                progress === 100 ? "bg-green-500" : "bg-primary"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {contents.map((content, index) => (
          <li
            key={content.id}
            className={cn(
              "rounded-lg transition-all duration-200",
              mainContentId ? 'cursor-pointer hover:bg-accent/50' : '',
              selectedContentId === content.id ? 'bg-accent shadow-sm' : ''
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