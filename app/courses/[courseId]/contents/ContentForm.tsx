'use client';

import { H5PSourceField } from '@/components/h5p/H5PSourceField';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Editor } from '@/components/Editor';
import { QuizEditor } from './QuizEditor';
import { QuizContent } from './types';
import { ContentTypeSelector } from './ContentTypeSelector';
import { ContentType, EMPTY_QUIZ, draftString, getContentValidationError, serialiseContent } from './content-form-utils';

interface ContentFormProps {
  onSubmit: (type: ContentType, content: string) => Promise<void>;
  mainContentId: string;
}

export function ContentForm(props: ContentFormProps) {
  return <ContentFormDraft key={props.mainContentId} {...props} />;
}

function ContentFormDraft({ onSubmit }: ContentFormProps) {
  const [selectedType, setSelectedType] = useState<ContentType | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ContentType, string | QuizContent>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isH5PBusy, setIsH5PBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const content = selectedType ? drafts[selectedType] ?? (selectedType === 'QUIZ' ? EMPTY_QUIZ : '') : '';
  const update = (value: string | QuizContent) => { if (selectedType) setDrafts(previous => ({ ...previous, [selectedType]: value })); setError(null); };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedType || saving.current || isH5PBusy) return;
    const validation = getContentValidationError(selectedType, content);
    if (validation) { setError(validation); return; }
    saving.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(selectedType, serialiseContent(content));
      setSelectedType(null);
      setDrafts({});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Der Inhalt konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.');
    } finally { saving.current = false; setIsSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Inhalt hinzufügen" aria-busy={isSubmitting || isH5PBusy}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ContentTypeSelector selectedType={selectedType ?? undefined} disabled={isSubmitting || isH5PBusy} onSelectType={type => { setSelectedType(type); setError(null); }} />
      {selectedType && <fieldset disabled={isSubmitting || isH5PBusy} className="min-w-0 space-y-4">
        {selectedType === 'QUIZ' ? <QuizEditor initialContent={content as QuizContent} onSave={update} onChange={update} showSaveButton={false} disabled={isSubmitting || isH5PBusy} /> : selectedType === 'TEXT' ? <Editor content={draftString(content)} onChange={update} readOnly={isSubmitting} /> : selectedType === 'H5P' ? <H5PSourceField id="new-content-source" value={draftString(content)} onChange={update} disabled={isSubmitting || isH5PBusy} onBusyChange={setIsH5PBusy} /> : <div className="space-y-2"><Label htmlFor="new-content-source">{selectedType === 'VIDEO' ? 'Video-URL' : 'Audio-URL'}</Label><Input id="new-content-source" inputMode="url" value={draftString(content)} onChange={event => update(event.target.value)} /></div>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => { setSelectedType(null); setDrafts({}); setError(null); }}>Abbrechen</Button><Button type="submit" disabled={isSubmitting || isH5PBusy || !draftString(content).trim()}>{isSubmitting ? 'Wird gespeichert…' : 'Speichern'}</Button></div>
      </fieldset>}
    </form>
  );
}
