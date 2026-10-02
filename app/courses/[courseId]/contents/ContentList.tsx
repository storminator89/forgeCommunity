'use client'

import { Fragment, useRef, useState } from 'react'
import { CourseContent } from './types'
import { FileText, ChevronUp, ChevronDown, ChevronRight, Pen, Trash2, CheckCircle, Check, X, Plus } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"
import { isPageVisited } from './utils/visitedPages'

interface ContentListProps {
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
  onMoveUp?: (parentId: string, contentId: string) => Promise<void> | void;
  onMoveDown?: (parentId: string, contentId: string) => Promise<void> | void;
  mainContentId: string;
  mainTopicIndex: number;
  courseId: string;
  isLoading?: boolean;
  isMutating?: boolean;
  canManage?: boolean;
  allowRootReorder?: boolean;
  onAddContent?: (parentId: string) => void;
  onVisitedToggle: (contentId: string) => void;
}

export function ContentList(props: ContentListProps) {
  const { contents, selectedContentId, onContentSelect, onDeleteClick, isInlineEditing, inlineEditTitle,
    onInlineEditSubmit, setIsInlineEditing, setInlineEditTitle, onMoveUp, onMoveDown, mainContentId,
    courseId, isLoading = false, isMutating = false, canManage = true, allowRootReorder = true, onAddContent, onVisitedToggle } = props;
  const [deleteTarget, setDeleteTarget] = useState<CourseContent | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(false);
  const busy = isLoading || isMutating || pending;
  const orderedContents = [...contents].sort((a, b) => a.order - b.order);

  const runMutation = async (action: () => Promise<void> | void, onSuccess?: () => void) => {
    if (pendingRef.current || isMutating || isLoading) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try { await action(); onSuccess?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Änderung konnte nicht gespeichert werden.'); }
    finally { pendingRef.current = false; setPending(false); }
  };
  const cancelRename = () => { setIsInlineEditing(null); setInlineEditTitle(''); setError(null); };

  return (
    <div className="min-w-0 space-y-1">
      {orderedContents.map((content, index) => {
        const visited = isPageVisited(courseId, content.id);
        const hasChildren = Boolean(content.subContents?.length);
        const expanded = !collapsedIds.has(content.id);
        return <Fragment key={content.id}>
          <div className={cn('group min-w-0 rounded-lg border border-transparent px-2 py-2', selectedContentId === content.id ? 'border-primary/20 bg-primary/10' : 'hover:bg-accent/60')}>
            <div className="flex min-w-0 items-center gap-2">
              {hasChildren && <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`${expanded ? 'Einklappen' : 'Aufklappen'}: ${content.title}`} aria-expanded={expanded} aria-controls={`topic-children-${content.id}`} onClick={() => setCollapsedIds(previous => { const next = new Set(previous); if (next.has(content.id)) next.delete(content.id); else next.add(content.id); return next; })}><ChevronRight className={cn('h-4 w-4', expanded && 'rotate-90')} /></Button>}
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`${visited ? 'Als ungelesen' : 'Als gelesen'} markieren: ${content.title}`} aria-pressed={visited} onClick={() => onVisitedToggle(content.id)}>{visited ? <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" /> : <FileText className="h-4 w-4 text-muted-foreground" />}</Button>
              {canManage && isInlineEditing === content.id ? (
                <form className="min-w-0 flex-1" onSubmit={event => { event.preventDefault(); const title = inlineEditTitle.trim(); if (!title) return; if (title === content.title) { cancelRename(); return; } void runMutation(() => onInlineEditSubmit(content.id, title), cancelRename); }}>
                  <Input autoFocus aria-label={`Titel von ${content.title}`} value={inlineEditTitle} onChange={event => setInlineEditTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) cancelRename(); } }} disabled={busy} className="h-9 text-sm" />
                  <div className="mt-1 flex gap-1"><Button type="submit" variant="ghost" size="sm" className="gap-1" disabled={busy || !inlineEditTitle.trim()}><Check className="h-4 w-4" />Speichern</Button><Button type="button" variant="ghost" size="sm" className="gap-1" disabled={busy} onClick={cancelRename}><X className="h-4 w-4" />Abbrechen</Button></div>
                </form>
              ) : <button type="button" className="min-w-0 flex-1 rounded text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-current={selectedContentId === content.id ? 'page' : undefined} onClick={() => onContentSelect(content.id)}><span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{content.title}</span></button>}
            </div>
            {canManage && isInlineEditing !== content.id && <div className="mt-1 flex flex-wrap justify-end gap-1">
              {onMoveUp && (mainContentId || allowRootReorder) && <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy || index === 0} aria-label={`${content.title} nach oben verschieben`} onClick={() => void runMutation(() => onMoveUp(mainContentId, content.id))}><ChevronUp className="h-4 w-4" /></Button>}
              {onMoveDown && (mainContentId || allowRootReorder) && <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy || index === orderedContents.length - 1} aria-label={`${content.title} nach unten verschieben`} onClick={() => void runMutation(() => onMoveDown(mainContentId, content.id))}><ChevronDown className="h-4 w-4" /></Button>}
              {onAddContent && <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy} aria-label={`Unterthema zu ${content.title} hinzufügen`} onClick={() => onAddContent(content.id)}><Plus className="h-4 w-4" /></Button>}
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy} aria-label={`${content.title} umbenennen`} onClick={() => { setError(null); setIsInlineEditing(content.id); setInlineEditTitle(content.title); }}><Pen className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={busy} aria-label={`${content.title} löschen`} onClick={() => { setError(null); setDeleteTarget(content); }}><Trash2 className="h-4 w-4" /></Button>
            </div>}
          </div>
          {hasChildren && expanded && <div id={`topic-children-${content.id}`} className="ml-2 min-w-0 border-l border-border pl-2"><ContentList {...props} contents={content.subContents!} mainContentId={content.id} isMutating={isMutating || pending} /></div>}
        </Fragment>;
      })}
      {error && !deleteTarget && <p role="alert" className="px-2 text-xs text-destructive">{error}</p>}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open && !pendingRef.current) { setDeleteTarget(null); setError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Inhalt löschen</AlertDialogTitle><AlertDialogDescription>„{deleteTarget?.title}“ und alle zugehörigen Unterthemen werden dauerhaft gelöscht.</AlertDialogDescription></AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel><AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={event => { event.preventDefault(); if (deleteTarget) void runMutation(() => onDeleteClick(deleteTarget), () => setDeleteTarget(null)); }}>{pending ? 'Wird gelöscht …' : 'Löschen'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
