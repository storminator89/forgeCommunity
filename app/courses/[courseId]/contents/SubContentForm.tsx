
'use client'

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import dynamic from 'next/dynamic';
import { CourseContent } from './types';

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
      <div>
        <Label htmlFor="type">Typ</Label>
        <select
          id="type"
          value={content.type}
          onChange={(e) => onContentChange({ ...content, type: e.target.value as 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="TEXT">Text</option>
          <option value="VIDEO">Video</option>
          <option value="AUDIO">Audio</option>
          <option value="H5P">H5P Inhalt</option>
        </select>
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