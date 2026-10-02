'use client';

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

interface EditContentFormProps {
  content: CourseContent;
  onContentChange: (content: Partial<CourseContent>) => void;
  onSubmit: (content: CourseContent) => Promise<void>;
  onCancel: () => void;
}

export function EditContentForm({ content: initialContent, onSubmit, onContentChange, onCancel }: EditContentFormProps) {
  const fieldId = useId();
  const initialType = inferContentType(initialContent);
  const [title, setTitle] = useState(initialContent.title);
  const [type, setType] = useState<ContentType>(initialType);
  const [content, setContent] = useState<CourseContent['content']>(initialContent.content);
  const [htmlMode, setHtmlMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    const nextContent = typeDrafts.current[nextType] ?? (nextType === 'QUIZ' ? EMPTY_QUIZ : '');
    setType(nextType);
    setContent(nextContent);
    setHtmlMode(false);
    setError(null);
    onContentChange({ type: nextType, content: nextContent });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const validationError = !title.trim() ? 'Gib einen Titel ein.' : getContentValidationError(type, content);
    if (validationError) { setError(validationError); return; }
    saving.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({ ...initialContent, title: title.trim(), type, content: serialiseContent(content) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Der Inhalt konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.');
    } finally {
      saving.current = false;
      setIsSubmitting(false);
    }
  };

  const quiz = type === 'QUIZ' ? quizEditorDraft(content) : null;
  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="Inhalt bearbeiten" aria-busy={isSubmitting}>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <fieldset disabled={isSubmitting} className="space-y-5 min-w-0">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-title`}>Titel</Label>
          <Input id={`${fieldId}-title`} value={title} required onChange={event => { setTitle(event.target.value); onContentChange({ title: event.target.value }); setError(null); }} />
        </div>
        <div className="space-y-2">
          <Label>Inhaltstyp</Label>
          <ContentTypeSelector selectedType={type} onSelectType={selectType} disabled={isSubmitting} />
        </div>
        {type === 'QUIZ' ? quiz ? (
          <QuizEditor key={`${initialContent.id}-${type}`} initialContent={quiz} onSave={(value: QuizContent) => updateContent(value)} onChange={updateContent} showSaveButton={false} disabled={isSubmitting} />
        ) : (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">Die gespeicherten Quiz-Daten sind ungültig. Der ursprüngliche Inhalt bleibt erhalten.</p>
            <Label htmlFor={`${fieldId}-quiz`}>Quiz-Daten (JSON)</Label>
            <Textarea id={`${fieldId}-quiz`} value={draftString(content)} onChange={event => updateContent(event.target.value)} className="min-h-48 font-mono" />
          </div>
        ) : type === 'TEXT' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label id={`${fieldId}-text-label`} htmlFor={htmlMode ? `${fieldId}-html` : undefined}>Inhalt</Label>
              <div className="flex items-center gap-2"><Label htmlFor={`${fieldId}-html-mode`}>HTML</Label><Switch id={`${fieldId}-html-mode`} checked={htmlMode} onCheckedChange={setHtmlMode} /></div>
            </div>
            {htmlMode ? <Textarea id={`${fieldId}-html`} value={draftString(content)} onChange={event => updateContent(event.target.value)} className="min-h-64 font-mono" /> : <div role="group" aria-labelledby={`${fieldId}-text-label`}><Editor content={draftString(content)} onChange={updateContent} readOnly={isSubmitting} className="min-h-56" /></div>}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-source`}>{type === 'VIDEO' ? 'Video-URL' : type === 'AUDIO' ? 'Audio-URL' : 'H5P-URL, ID oder Einbettungscode'}</Label>
            {type === 'H5P' ? <Textarea id={`${fieldId}-source`} value={draftString(content)} onChange={event => updateContent(event.target.value)} placeholder="https://…/embed/…" /> : <Input id={`${fieldId}-source`} inputMode="url" value={draftString(content)} onChange={event => updateContent(event.target.value)} placeholder={type === 'VIDEO' ? 'https://www.youtube.com/watch?v=…' : '/uploads/audio.mp3'} />}
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>Abbrechen</Button>
        <Button type="submit" disabled={isSubmitting || !title.trim()}>{isSubmitting ? 'Wird gespeichert…' : 'Speichern'}</Button>
      </div>
    </form>
  );
}
