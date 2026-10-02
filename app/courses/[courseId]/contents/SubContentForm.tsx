'use client';

import { H5PSourceField } from '@/components/h5p/H5PSourceField';
import { useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { CourseContent } from './types';
import { QuizEditor } from './QuizEditor';
import { ContentTypeSelector } from './ContentTypeSelector';
import { Editor } from '@/components/Editor';
import { ContentType, EMPTY_QUIZ, draftString, getContentValidationError, quizEditorDraft } from './content-form-utils';

interface SubContentFormProps {
  content: CourseContent;
  onContentChange: (content: CourseContent) => void;
  onSubmit: (event: React.FormEvent) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  onH5PDialogOpen?: () => void;
}

export function SubContentForm({ content, onContentChange, onSubmit, onCancel, isEditing = false }: SubContentFormProps) {
  const fieldId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isH5PBusy, setIsH5PBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const typeDrafts = useRef<Partial<Record<ContentType, CourseContent['content']>>>({ [content.type]: content.content });
  const update = (value: CourseContent['content']) => { typeDrafts.current[content.type] = value; onContentChange({ ...content, content: value }); setError(null); };
  const selectType = (type: ContentType) => {
    if (type === content.type) return;
    typeDrafts.current[content.type] = content.content;
    onContentChange({ ...content, type, content: typeDrafts.current[type] ?? (type === 'QUIZ' ? EMPTY_QUIZ : '') });
    setError(null);
  };
  const quiz = content.type === 'QUIZ' ? quizEditorDraft(content.content || EMPTY_QUIZ) : null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || isH5PBusy) return;
    const validationError = !content.title.trim() ? 'Gib einen Titel ein.' : getContentValidationError(content.type, content.content);
    if (validationError) { setError(validationError); return; }
    saving.current = true;
    setIsSubmitting(true);
    setError(null);
    try { await onSubmit(event); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Der Inhalt konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.'); }
    finally { saving.current = false; setIsSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Unterthema bearbeiten" aria-busy={isSubmitting || isH5PBusy}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <fieldset disabled={isSubmitting || isH5PBusy} className="min-w-0 space-y-4">
        <div className="space-y-2"><Label htmlFor={`${fieldId}-title`}>Titel</Label><Input id={`${fieldId}-title`} value={content.title} onChange={event => onContentChange({ ...content, title: event.target.value })} required /></div>
        <div className="space-y-2"><Label>Inhaltstyp</Label><ContentTypeSelector selectedType={content.type} onSelectType={selectType} disabled={isSubmitting || isH5PBusy} /></div>
        {content.type === 'TEXT' ? <div role="group" aria-labelledby={`${fieldId}-label`}><Label id={`${fieldId}-label`}>Inhalt</Label><Editor content={draftString(content.content)} onChange={update} readOnly={isSubmitting} className="min-h-48" /></div> : content.type === 'QUIZ' ? quiz ? <QuizEditor key={`${content.id}-quiz`} initialContent={quiz} onSave={update} onChange={update} showSaveButton={false} disabled={isSubmitting || isH5PBusy} /> : <div className="space-y-2"><p role="alert" className="text-sm text-destructive">Die Quiz-Daten sind ungültig. Der ursprüngliche Inhalt bleibt erhalten.</p><Label htmlFor={`${fieldId}-quiz`}>Quiz-Daten (JSON)</Label><Textarea id={`${fieldId}-quiz`} value={draftString(content.content)} onChange={event => update(event.target.value)} className="font-mono" /></div> : content.type === 'H5P' ? <H5PSourceField id={`${fieldId}-source`} value={draftString(content.content)} onChange={update} disabled={isSubmitting || isH5PBusy} onBusyChange={setIsH5PBusy} /> : <div className="space-y-2"><Label htmlFor={`${fieldId}-source`}>{content.type === 'VIDEO' ? 'Video-URL' : 'Audio-URL'}</Label><Input id={`${fieldId}-source`} inputMode="url" value={draftString(content.content)} onChange={event => update(event.target.value)} /></div>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Abbrechen</Button><Button type="submit" disabled={isSubmitting || isH5PBusy || !content.title.trim()}>{isSubmitting ? 'Wird gespeichert…' : isEditing ? 'Aktualisieren' : 'Hinzufügen'}</Button></div>
      </fieldset>
    </form>
  );
}
