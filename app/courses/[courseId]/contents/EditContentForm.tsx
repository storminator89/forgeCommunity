'use client';

import { H5PSourceField } from '@/components/h5p/H5PSourceField';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { CourseContent, QuizContent } from './types';
import { QuizEditor } from './QuizEditor';
import { Editor } from '@/components/Editor';
import { ContentTypeSelector } from './ContentTypeSelector';
import { ContentType, EMPTY_QUIZ, draftString, getContentValidationError, inferContentType, serialiseContent, quizEditorDraft } from './content-form-utils';
import { editableSignature } from './content-tree';
import { EMPTY_ASSIGNMENT, MAX_ASSIGNMENT_PROMPT, parseAssignmentContent } from './assignment-content';
import richTextStyles from './course-rich-text.module.css';

interface EditContentFormProps {
  content: CourseContent;
  onContentChange: (content: Partial<CourseContent>) => void;
  onSubmit: (content: CourseContent) => Promise<void>;
  onCancel: () => void;
  saveState?: 'saved' | 'dirty';
  saveMessage?: string;
  staged?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
}

export function EditContentForm({ content: initialContent, onSubmit, onContentChange, onCancel, saveState, saveMessage, staged = false, onImageUpload }: EditContentFormProps) {
  const fieldId = useId();
  const initialType = inferContentType(initialContent);
  const [title, setTitle] = useState(initialContent.title);
  const [type, setType] = useState<ContentType>(initialType);
  const [content, setContent] = useState<CourseContent['content']>(initialContent.content);
  const initialAssignment = initialType === 'ASSIGNMENT' ? parseAssignmentContent(initialContent.content) : null;
  const [assignmentPrompt, setAssignmentPrompt] = useState(initialAssignment?.prompt ?? '');
  const [assignmentScore, setAssignmentScore] = useState(String(initialAssignment?.passingScore ?? 70));
  const [localAssignmentDirty, setLocalAssignmentDirty] = useState(false);
  const [htmlMode, setHtmlMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isH5PBusy, setIsH5PBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const typeDrafts = useRef<Partial<Record<ContentType, CourseContent['content']>>>({ [initialType]: initialContent.content });

  const updateContent = (value: CourseContent['content']) => {
    setContent(value);
    typeDrafts.current[type] = value;
    onContentChange({ type, content: value });
    setError(null);
  };

  const selectType = (nextType: ContentType) => {
    if (type === nextType) return;
    typeDrafts.current[type] = content;
    const nextContent = typeDrafts.current[nextType] ?? (nextType === 'QUIZ' ? EMPTY_QUIZ : nextType === 'ASSIGNMENT' ? JSON.stringify(EMPTY_ASSIGNMENT) : '');
    if (nextType === 'ASSIGNMENT') {
      const assignment = parseAssignmentContent(nextContent) ?? EMPTY_ASSIGNMENT;
      setAssignmentPrompt(assignment.prompt);
      setAssignmentScore(String(assignment.passingScore));
    }
    setLocalAssignmentDirty(false);
    setType(nextType);
    setContent(nextContent);
    setHtmlMode(false);
    setError(null);
    onContentChange({ type: nextType, content: nextContent });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || isH5PBusy) return;
    const score = Number(assignmentScore);
    const assignmentDraft = { prompt: assignmentPrompt, passingScore: score };
    const validationError = type === 'ASSIGNMENT' && (!Number.isInteger(score) || score < 1 || score > 100)
      ? 'Die Bestehensgrenze muss zwischen 1 und 100 % liegen.'
      : staged ? null : !title.trim() ? 'Gib einen Titel ein.' : getContentValidationError(type, type === 'ASSIGNMENT' ? JSON.stringify(assignmentDraft) : content);
    if (validationError) { setError(validationError); return; }
    saving.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({ ...initialContent, title: title.trim(), type, content: type === 'ASSIGNMENT' ? JSON.stringify(assignmentDraft) : serialiseContent(content) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Der Inhalt konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.');
    } finally {
      saving.current = false;
      setIsSubmitting(false);
    }
  };

  const quiz = type === 'QUIZ' ? quizEditorDraft(content) : null;
  const dirty = localAssignmentDirty || (saveState ? saveState === 'dirty' : editableSignature({ ...initialContent, title, type, content }) !== editableSignature(initialContent));
  const stateLabel = isSubmitting ? 'Änderungen werden gespeichert …' : error ? 'Speichern nicht abgeschlossen' : dirty ? 'Lokal ungespeichert' : 'Gespeicherter Inhalt';
  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="Inhalt bearbeiten" aria-busy={isSubmitting || isH5PBusy}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
        <p className="text-sm font-medium">Inhalt ausarbeiten</p>
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{stateLabel}</p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <fieldset disabled={isSubmitting || isH5PBusy} className="space-y-5 min-w-0">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-title`}>Titel</Label>
          <Input id={`${fieldId}-title`} value={title} required={!staged} maxLength={300} onChange={event => { setTitle(event.target.value); onContentChange({ title: event.target.value }); setError(null); }} />
        </div>
        <div className="space-y-2">
          <Label>Inhaltstyp</Label>
          <ContentTypeSelector selectedType={type} onSelectType={selectType} disabled={isSubmitting || isH5PBusy} />
        </div>
        {type === 'QUIZ' ? quiz ? (
          <QuizEditor key={`${initialContent.id}-${type}`} initialContent={quiz} onSave={(value: QuizContent) => updateContent(value)} onChange={updateContent} showSaveButton={false} disabled={isSubmitting || isH5PBusy} />
        ) : (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">Die gespeicherten Quiz-Daten sind ungültig. Der ursprüngliche Inhalt bleibt erhalten.</p>
            <Label htmlFor={`${fieldId}-quiz`}>Quiz-Daten (JSON)</Label>
            <Textarea id={`${fieldId}-quiz`} value={draftString(content)} onChange={event => updateContent(event.target.value)} className="min-h-48 font-mono" />
          </div>
        ) : type === 'ASSIGNMENT' ? (
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor={`${fieldId}-prompt`}>Aufgabentext</Label>
              <Textarea id={`${fieldId}-prompt`} className="min-h-40 resize-y" maxLength={MAX_ASSIGNMENT_PROMPT} value={assignmentPrompt} onChange={event => {
                const prompt = event.target.value; setAssignmentPrompt(prompt);
                const score = Number(assignmentScore);
                if (Number.isInteger(score) && score >= 1 && score <= 100) { updateContent(JSON.stringify({ prompt, passingScore: score })); setLocalAssignmentDirty(false); }
                else setLocalAssignmentDirty(true);
              }} aria-describedby={`${fieldId}-prompt-hint`} />
              <p id={`${fieldId}-prompt-hint`} className="text-sm text-muted-foreground">Nur Textantworten. Lernende können keine Dateien hochladen.</p></div>
            <div className="space-y-2"><Label htmlFor={`${fieldId}-passing-score`}>Bestehensgrenze in Prozent</Label>
              <Input id={`${fieldId}-passing-score`} type="number" inputMode="numeric" min={1} max={100} step={1} value={assignmentScore} onChange={event => {
                const value = event.target.value; setAssignmentScore(value);
                if (value !== '' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100) { updateContent(JSON.stringify({ prompt: assignmentPrompt, passingScore: Number(value) })); setLocalAssignmentDirty(false); }
                else setLocalAssignmentDirty(true);
              }} aria-invalid={Boolean(error && error.includes('Bestehensgrenze'))} />
              <p className="text-sm text-muted-foreground">Lehrende bewerten jede Abgabe manuell mit 0 bis 100 Punkten.</p></div>
          </div>
        ) : type === 'TEXT' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label id={`${fieldId}-text-label`} htmlFor={htmlMode ? `${fieldId}-html` : undefined}>Inhalt</Label>
              <div className="flex items-center gap-2"><Label htmlFor={`${fieldId}-html-mode`}>HTML</Label><Switch id={`${fieldId}-html-mode`} checked={htmlMode} onCheckedChange={setHtmlMode} /></div>
            </div>
            {htmlMode ? <Textarea id={`${fieldId}-html`} value={draftString(content)} onChange={event => updateContent(event.target.value)} className="min-h-64 font-mono" /> : <div role="group" aria-labelledby={`${fieldId}-text-label`}><Editor content={draftString(content)} onChange={updateContent} readOnly={isSubmitting} rootDocumentChangesOnly={staged} uploadImage={onImageUpload} className={`${richTextStyles.editor} min-h-56`} /></div>}
          </div>
        ) : type === 'H5P' ? (
          <H5PSourceField id={`${fieldId}-source`} value={draftString(content)} onChange={updateContent} disabled={isSubmitting || isH5PBusy} onBusyChange={setIsH5PBusy} />
        ) : (
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-source`}>{type === 'VIDEO' ? 'Video-URL' : 'Audio-URL'}</Label>
            <Input id={`${fieldId}-source`} inputMode="url" aria-describedby={`${fieldId}-source-hint`} value={draftString(content)} onChange={event => updateContent(event.target.value)} placeholder={type === 'VIDEO' ? 'https://www.youtube.com/watch?v=…' : '/uploads/audio.mp3'} />
            <p id={`${fieldId}-source-hint`} className="text-sm text-muted-foreground">{type === 'VIDEO' ? 'YouTube, Vimeo, Dailymotion oder ein lokaler Videopfad. Verwende die Quelle statt eines HTML-Einbettungscodes.' : 'Spotify, SoundCloud oder ein lokaler Audiopfad. Die Wiedergabe prüfst du in der Vorschau.'}</p>
          </div>
        )}
      </fieldset>
      <div className="sticky bottom-0 z-10 space-y-3 border-t bg-card py-4">
        <p className="text-xs text-muted-foreground">{saveMessage || (staged ? 'Für Lernende noch nicht sichtbar.' : 'Änderungen werden nach dem Speichern für eingeschriebene Lernende sichtbar.')}</p>
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={isSubmitting || isH5PBusy} onClick={onCancel}>Abbrechen</Button>
        <Button type="submit" disabled={isSubmitting || isH5PBusy || (!staged && !title.trim())}>{isSubmitting ? 'Wird gespeichert…' : staged ? 'Entwurf speichern' : 'Speichern'}</Button></div>
      </div>
    </form>
  );
}
