'use client'

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import dynamic from 'next/dynamic';
import { CourseContent } from './types';
import { QuizEditor } from './QuizEditor';
import { ContentTypeSelector } from './ContentTypeSelector';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

interface SubContentFormProps {
  content: CourseContent;
  onContentChange: (content: CourseContent) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  onH5PDialogOpen?: () => void;
}

export function SubContentForm({
  content,
  onContentChange,
  onSubmit,
  onCancel,
  isEditing = false,
  onH5PDialogOpen
}: SubContentFormProps) {
  const renderContentInput = (type: string) => {
    switch (type) {
      case 'TEXT':
        return (
          <ReactQuill
            value={content.content}
            onChange={(value) => onContentChange({ ...content, content: value })}
            modules={{
              toolbar: [
                [{ 'header': [1, 2, false] }],
                ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
                ['link', 'image'],
                ['clean']
              ],
            }}
            className="bg-white dark:bg-gray-700 rounded-md"
          />
        );
      case 'VIDEO':
        return (
          <Input
            value={content.content}
            onChange={(e) => onContentChange({ ...content, content: e.target.value })}
            placeholder="YouTube URL eingeben"
          />
        );
      case 'AUDIO':
        return (
          <Input
            value={content.content}
            onChange={(e) => onContentChange({ ...content, content: e.target.value })}
            placeholder="Audio URL eingeben"
          />
        );
      case 'H5P':
        return (
          <div className="space-y-4">
            <Button 
              type="button"
              onClick={onH5PDialogOpen}
              className="w-full"
            >
              H5P Inhaltstyp auswählen
            </Button>
            {content.content && (
              <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                <p className="font-medium">Ausgewählter H5P Inhaltstyp:</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{content.content}</p>
              </div>
            )}
          </div>
        );
      case 'QUIZ':
        return (
          <QuizEditor
            initialContent={content.content ? JSON.parse(content.content) : { questions: [], shuffleQuestions: false, passingScore: 70 }}
            onSave={(quizContent) => onContentChange({ ...content, content: JSON.stringify(quizContent) })}
          />
        );
      default:
        return null;
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">Titel</Label>
        <Input
          id="title"
          value={content.title}
          onChange={(e) => onContentChange({ ...content, title: e.target.value })}
          required
          placeholder="Titel des Unterthemas"
        />
      </div>
      <div className="space-y-2">
        <Label>Inhaltstyp</Label>
        <ContentTypeSelector 
          onSelectType={(type) => onContentChange({ 
            ...content, 
            type: type as 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ', 
            content: type === 'QUIZ' ? JSON.stringify({ questions: [], shuffleQuestions: false, passingScore: 70 }) : '' 
          })} 
        />
      </div>
      <div>
        <Label htmlFor="content">Inhalt</Label>
        {renderContentInput(content.type)}
      </div>
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit">
          {isEditing ? 'Aktualisieren' : 'Hinzufügen'}
        </Button>
      </div>
    </form>
  );
}