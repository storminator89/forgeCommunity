'use client'

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PlusCircle, Award } from 'lucide-react';
import { ContentList } from './ContentList';
import { NewMainTopicDialog } from './NewMainTopicDialog';
import { NewSubTopicDialog } from './NewSubTopicDialog';
import { CourseContent } from './types';
import { isPageVisited } from './utils/visitedPages';

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
  onMoveUp: (parentId: string, contentId: string) => Promise<void> | void;
  onMoveDown: (parentId: string, contentId: string) => Promise<void> | void;
  onMoveMainUp?: (contentId: string) => Promise<void> | void;
  onMoveMainDown?: (contentId: string) => Promise<void> | void;
  mainContentId: string | null;
  mainTopicIndex: number;
  courseId: string;
  courseName: string;
  isLoading: boolean;
  isMutating?: boolean;
  canManage?: boolean;
  forceUpdate?: boolean;
  onMainContentSubmit?: (title: string) => Promise<CourseContent | void>;
  onSubContentSubmit: (title: string, parentId?: string) => Promise<CourseContent | void>;
  onMainContentSelect?: (contentId: string | null) => void;
  onVisitedToggle: (contentId: string) => void;
}

export function CourseContentsSidebar(props: CourseContentsSidebarProps) {
  const { contents, selectedContentId, onContentSelect, onEditClick, onDeleteClick, isInlineEditing,
    inlineEditTitle, onInlineEditSubmit, setIsInlineEditing, setInlineEditTitle, onMoveUp, onMoveDown,
    onMoveMainUp, onMoveMainDown, mainContentId, courseId, courseName, isLoading, isMutating = false,
    canManage = true, forceUpdate, onMainContentSubmit, onSubContentSubmit, onMainContentSelect, onVisitedToggle } = props;
  const [mainTitle, setMainTitle] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [mainDialogOpen, setMainDialogOpen] = useState(false);
  const [subParentId, setSubParentId] = useState<string | null>(null);
  const [isGeneratingCertificate, setIsGeneratingCertificate] = useState(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [visitedVersion, setVisitedVersion] = useState(0);

  useEffect(() => {
    const handleVisited = (event: Event) => { if ((event as CustomEvent).detail?.courseId === courseId) setVisitedVersion(value => value + 1); };
    window.addEventListener('visitedPagesChanged', handleVisited);
    return () => window.removeEventListener('visitedPagesChanged', handleVisited);
  }, [courseId]);

  const leafContents = useMemo(() => {
    const leaves: CourseContent[] = [];
    const walk = (items: CourseContent[]) => items.forEach(item => item.subContents?.length ? walk(item.subContents) : leaves.push(item));
    walk(contents);
    return leaves;
  }, [contents]);
  const allTopicsCompleted = useMemo(() => {
    void visitedVersion;
    void forceUpdate;
    return leafContents.length > 0 && leafContents.every(item => isPageVisited(courseId, item.id));
  }, [leafContents, courseId, visitedVersion, forceUpdate]);

  const generateCertificate = useCallback(async () => {
    if (isGeneratingCertificate) return;
    setIsGeneratingCertificate(true);
    setCertificateError(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/certificate`, { method: 'POST' });
      if (!response.ok) throw new Error(response.status === 403 ? 'Der Kursabschluss ist noch nicht bestätigt.' : 'Das Zertifikat konnte nicht erstellt werden. Bitte versuche es erneut.');
      const url = window.URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${courseName.replace(/\s+/g, '_')}_Certificate.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (cause) { setCertificateError(cause instanceof Error ? cause.message : 'Das Zertifikat konnte nicht erstellt werden.'); }
    finally { setIsGeneratingCertificate(false); }
  }, [courseId, courseName, isGeneratingCertificate]);

  // Capture the parent in this component instead of depending on asynchronous parent state updates.
  const activeParentId = subParentId ?? mainContentId;
  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
    <div className="border-b px-4 py-3"><h2 className="truncate text-sm font-semibold" title={courseName}>{courseName || 'Kursinhalte'}</h2><p className="mt-1 text-xs text-muted-foreground">Inhaltsverzeichnis</p></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {isLoading ? <p role="status" className="p-4 text-sm text-muted-foreground">Inhalte werden geladen …</p> : contents.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Noch keine Inhalte vorhanden.</p> : <ContentList
        contents={contents} selectedContentId={selectedContentId} onContentSelect={onContentSelect}
        onEditClick={onEditClick} onDeleteClick={onDeleteClick} isInlineEditing={isInlineEditing}
        inlineEditTitle={inlineEditTitle} onInlineEditSubmit={onInlineEditSubmit} setIsInlineEditing={setIsInlineEditing}
        setInlineEditTitle={setInlineEditTitle} mainContentId="" mainTopicIndex={0} courseId={courseId}
        isLoading={isLoading} isMutating={isMutating} canManage={canManage} onVisitedToggle={onVisitedToggle}
        allowRootReorder={Boolean(onMoveMainUp && onMoveMainDown)}
        onMoveUp={(parentId, id) => parentId ? onMoveUp(parentId, id) : onMoveMainUp?.(id)}
        onMoveDown={(parentId, id) => parentId ? onMoveDown(parentId, id) : onMoveMainDown?.(id)}
        onAddContent={canManage ? parentId => { setSubParentId(parentId); setSubTitle(''); onMainContentSelect?.(parentId); } : undefined}
      />}
      {canManage && onMainContentSubmit && <Button variant="outline" className="mt-3 w-full gap-2 border-dashed" disabled={isLoading || isMutating} onClick={() => { setMainTitle(''); setMainDialogOpen(true); }}><PlusCircle className="h-4 w-4" />Neues Kapitel</Button>}
    </div>
    {contents.length > 0 && <div className="shrink-0 space-y-2 border-t p-3">
      <Button variant="outline" className="w-full gap-2" disabled={isGeneratingCertificate || !allTopicsCompleted} onClick={() => void generateCertificate()} aria-describedby={!allTopicsCompleted ? 'certificate-progress-hint' : undefined}><Award className="h-4 w-4" />{isGeneratingCertificate ? 'Wird erstellt …' : 'Zertifikat herunterladen'}</Button>
      {!allTopicsCompleted && <p id="certificate-progress-hint" className="text-xs text-muted-foreground">Schließe alle Inhalte ab, um dein Zertifikat herunterzuladen.</p>}
      {certificateError && <p role="alert" className="text-xs text-destructive">{certificateError}</p>}
    </div>}
    {canManage && onMainContentSubmit && <NewMainTopicDialog isOpen={mainDialogOpen} onOpenChange={setMainDialogOpen} title={mainTitle} onTitleChange={setMainTitle} onSubmit={onMainContentSubmit} />}
    {canManage && <NewSubTopicDialog isOpen={Boolean(activeParentId)} onOpenChange={open => { if (!open) { setSubParentId(null); onMainContentSelect?.(null); } }} title={subTitle} onTitleChange={setSubTitle} onSubmit={async title => { if (!activeParentId) throw new Error('Bitte wähle ein übergeordnetes Thema.'); return onSubContentSubmit(title, activeParentId); }} />}
  </div>;
}
