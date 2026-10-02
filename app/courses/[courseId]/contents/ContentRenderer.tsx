'use client'

import { useState, useRef } from 'react';
import { CourseContent, parseQuizContent } from './types';
import { Editor } from '@/components/Editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Pencil } from 'lucide-react';
import { QuizRenderer } from './QuizRenderer';
import { QuizEditor } from './QuizEditor';
import { getH5PEmbedUrl, getCourseVideoUrl, getCourseAudioEmbedUrl } from './content-form-utils';

import { getSafeEmbedUrl } from '@/lib/security';
import { AlertTriangle } from 'lucide-react';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

interface ContentRendererProps {
  content: CourseContent;
  isEditing?: boolean;
  onSave?: (contentId: string, newContent: string) => Promise<void>;
  onEditToggle?: (isEditing: boolean) => void;
}

export function ContentRenderer(props: ContentRendererProps) {
  return <ContentRendererState key={props.content.id} {...props} />;
}

function ContentRendererState({ content, isEditing: externalIsEditing, onSave, onEditToggle }: ContentRendererProps) {
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [draft, setDraft] = useState<{ source: CourseContent['content']; value: string } | null>(null);
  const editedContent = draft && draft.source === content.content
    ? draft.value
    : typeof content.content === 'string' ? content.content : JSON.stringify(content.content);
  const setEditedContent = (value: string) => setDraft({ source: content.content, value });

  const isEditing = externalIsEditing ?? internalIsEditing;

  const handleEditToggle = (editing: boolean) => {
    if (onEditToggle) {
      onEditToggle(editing);
    } else {
      setInternalIsEditing(editing);
    }
  };

  const handleSave = async (value = editedContent) => {
    if (!onSave || savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(content.id, value);
      setDraft(null);
      handleEditToggle(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Der Inhalt konnte nicht gespeichert werden.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const quizContent = (content.type === 'TEXT' || content.type === 'QUIZ') ? parseQuizContent(content.content) : null;

  if (isEditing) {
    return (
      <Card className="p-6 shadow-none">
        <div className="space-y-6">
          {quizContent || content.type === 'QUIZ' ? (
            <QuizEditor key={content.id} initialContent={quizContent ?? content.content} disabled={isSaving || !onSave} onSave={async quiz => { await handleSave(JSON.stringify(quiz)); }} />
          ) : content.type === 'TEXT' ? (
            <Editor content={editedContent} onChange={setEditedContent} />
          ) : (
            <div className="space-y-2">
              <label htmlFor={`content-url-${content.id}`} className="text-sm font-medium text-muted-foreground">
                {content.type === 'VIDEO' ? 'Video-URL' :
                  content.type === 'AUDIO' ? 'Audio-URL' :
                    'H5P-URL, ID oder Einbettungscode'}
              </label>
              <Input
                id={`content-url-${content.id}`}
                type="text"
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                placeholder={
                  content.type === 'VIDEO' ? 'Video-URL oder lokaler Medienpfad' :
                    content.type === 'AUDIO' ? 'Audio-URL oder lokaler Medienpfad' :
                      'H5P Content ID oder URL eingeben'
                }
                className="w-full"
              />
            </div>
          )}
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-4">
            <Button
              type="button"
              disabled={isSaving}
              variant="outline"
              onClick={() => { setDraft(null); setSaveError(null); handleEditToggle(false); }}
              className="px-4"
            >
              Abbrechen
            </Button>
            {!quizContent && content.type !== 'QUIZ' && <Button
              type="button"
              disabled={isSaving || !onSave}
              onClick={() => handleSave()}
              className="px-4"
            >
              {isSaving ? 'Wird gespeichert…' : 'Speichern'}
            </Button>}
          </div>
        </div>
      </Card>
    );
  }

  if (quizContent || content.type === 'QUIZ') return <QuizRenderer content={quizContent ?? content.content} />;

  const renderContent = () => {
    switch (content.type) {
      case 'TEXT':
        return (
          <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_img]:max-w-full">
            <div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(content.content as string) }} />
          </div>
        );

      case 'VIDEO': {
        const videoUrl = content.content as string;
        const safeUrl = getCourseVideoUrl(videoUrl);

        if (!safeUrl) {
          return (
            <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5" />
              <span>Diese Video-URL wird aus Sicherheitsgründen nicht unterstützt.</span>
            </div>
          );
        }

        if (safeUrl.startsWith('/') && /\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(safeUrl)) {
          return <video src={safeUrl} controls aria-label={content.title} className="w-full rounded-md" />;
        }
        return (
          <div className="aspect-video w-full rounded-md overflow-hidden bg-muted border border-border/50">
            <iframe
              src={safeUrl}
              title={content.title}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        );
      }

      case 'AUDIO': {
        const safeUrl = getSafeEmbedUrl(content.content as string, 'audio');
        const embedUrl = getCourseAudioEmbedUrl(content.content as string);
        if (embedUrl) return <iframe src={embedUrl} title={content.title} className="h-44 w-full rounded-md border border-border" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />;
        if (!safeUrl || !safeUrl.startsWith('/')) return <p role="alert" className="rounded-md bg-destructive/10 p-4 text-destructive">Diese Audio-URL wird nicht unterstützt.</p>;
        return <div className="rounded-lg border border-border/50 bg-muted/30 p-6"><audio src={safeUrl} controls className="w-full" /></div>;
      }
      case 'H5P': {
        const safeUrl = getH5PEmbedUrl(content.content);
        if (!safeUrl) return <p role="alert" className="rounded-md bg-destructive/10 p-4 text-destructive">Die H5P-Quelle ist ungültig.</p>;
        return <div className="aspect-video w-full overflow-hidden rounded-md border border-border/50 bg-muted"><iframe src={safeUrl} title={content.title} className="h-full w-full" allowFullScreen /></div>;
      }

      default:
        return (
          <div className="p-4 text-muted-foreground">
            <p>{typeof content.content === 'string' ? content.content : 'Komplexer Inhalt'}</p>
          </div>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Edit Button is already in parent, but if needed here we can add it */}
      <div className="p-0">
        {renderContent()}
      </div>
    </div>
  );
}
