'use client'

import { useState } from 'react'
import { CourseContent } from './types'
import { FileText, ChevronUp, ChevronDown, Pen, Trash2, CheckCircle } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"
import { isPageVisited } from './utils/visitedPages'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

interface ContentListProps {
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
  onMoveUp: (mainContentId: string, contentId: string) => void;
  onMoveDown: (mainContentId: string, contentId: string) => void;
  mainContentId: string;
  mainTopicIndex: number;
  courseId: string;
  isLoading?: boolean;
  onVisitedToggle: (contentId: string) => void;
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
  isLoading = false,
  onVisitedToggle,
}: ContentListProps) {
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  return (
    <div>
      {contents.map((content, index) => (
        <div
          key={content.id}
          className={cn(
            "relative group flex items-center justify-between py-2 px-3 rounded-md transition-all duration-200",
            selectedContentId === content.id && "bg-primary/10 text-primary font-medium shadow-sm",
            "hover:bg-primary/5 hover:shadow-sm"
          )}
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 w-7 flex-shrink-0 p-0 relative bg-background hover:bg-primary/10 border border-primary/20 hover:border-primary shadow-sm hover:shadow transition-all duration-200",
                      selectedContentId === content.id && "text-primary border-primary bg-primary/5",
                      isPageVisited(courseId, content.id) && "border-green-500/50 bg-green-50 dark:bg-green-500/10"
                    )}
                    onClick={() => onVisitedToggle(content.id)}
                  >
                    {isPageVisited(courseId, content.id) ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-white dark:bg-gray-800 border border-border shadow-lg p-2">
                  <div className="text-xs font-medium">
                    {isPageVisited(courseId, content.id) ? (
                      <div className="flex items-center gap-2 text-green-500">
                        <span>Gelesen</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>Ungelesen</span>
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isInlineEditing === content.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inlineEditTitle.trim()) {
                    onInlineEditSubmit(content.id, inlineEditTitle);
                  }
                }}
                className="flex-1 min-w-0"
              >
                <Input
                  value={inlineEditTitle}
                  onChange={(e) => setInlineEditTitle(e.target.value)}
                  onBlur={() => {
                    if (inlineEditTitle.trim()) {
                      onInlineEditSubmit(content.id, inlineEditTitle);
                    }
                    setIsInlineEditing(null);
                  }}
                  className="h-8 text-sm bg-background/80 border-primary/30 focus:border-primary focus:ring-primary/20 font-medium shadow-sm"
                  autoFocus
                />
              </form>
            ) : (
              <span
                className="text-sm cursor-pointer font-medium text-foreground hover:text-primary transition-colors duration-200 truncate"
                onClick={() => onContentSelect(content.id)}
              >
                {content.title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 flex-shrink-0">
            {index > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                onClick={() => onMoveUp(mainContentId, content.id)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
            {index < contents.length - 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                onClick={() => onMoveDown(mainContentId, content.id)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-1.5 ml-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                onClick={() => {
                  setIsInlineEditing(content.id);
                  setInlineEditTitle(content.title);
                }}
              >
                <Pen className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Unterthema löschen</AlertDialogTitle>
                    <AlertDialogDescription>
                      Möchten Sie dieses Unterthema wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-background hover:bg-accent text-foreground hover:text-foreground border-border hover:border-accent transition-all duration-200">
                      Abbrechen
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        onDeleteClick(content);
                        // Lokaler State wird durch Parent-Komponenten aktualisiert
                      }}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors duration-200"
                    >
                      Löschen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}