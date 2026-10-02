'use client'

import { Fragment, useState } from 'react'
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
        <Fragment key={content.id}>
        <div
          className={cn(
            "relative group flex flex-wrap gap-2 items-center justify-between py-2 px-3 rounded-md transition-all duration-200",
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
                      "h-8 w-8 flex-shrink-0 p-0 relative bg-background hover:bg-primary/10 border border-primary/20 hover:border-primary shadow-sm hover:shadow transition-all duration-200",
                      selectedContentId === content.id && "text-primary border-primary bg-primary/5",
                      isPageVisited(courseId, content.id) && "border-green-500/50 bg-green-50 dark:bg-green-500/10"
                    )}
                    aria-label={`${isPageVisited(courseId, content.id) ? "Als ungelesen" : "Als gelesen"} markieren: ${content.title}`}
                    aria-pressed={isPageVisited(courseId, content.id)}
                    onClick={() => onVisitedToggle(content.id)}
                  >
                    {isPageVisited(courseId, content.id) ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-card border border-border shadow-lg p-2">
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
              <button type="button"
                className="min-w-0 truncate rounded-sm text-left text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-current={selectedContentId === content.id ? "page" : undefined}
                onClick={() => onContentSelect(content.id)}
              >
                {content.title}
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-all duration-200 flex-shrink-0">
            {index > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                aria-label={`${content.title} nach oben verschieben`}
                onClick={() => onMoveUp(mainContentId, content.id)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
            {index < contents.length - 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                aria-label={`${content.title} nach unten verschieben`}
                onClick={() => onMoveDown(mainContentId, content.id)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-1.5 ml-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                onClick={() => {
                  setIsInlineEditing(content.id);
                  setInlineEditTitle(content.title);
                }}
              >
                <span className="sr-only">{content.title} umbenennen</span>
                <Pen className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
                  >
                    <span className="sr-only">{content.title} löschen</span>
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
        {content.subContents && content.subContents.length > 0 && (
          <div className="pl-4 ml-3 border-l border-border/40">
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
              mainTopicIndex={mainTopicIndex}
              courseId={courseId}
              isLoading={isLoading}
              onVisitedToggle={onVisitedToggle}
            />
          </div>
        )}
        </Fragment>
      ))}
    </div>
  );
}
