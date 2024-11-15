'use client'

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CourseContent } from './types';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select";
import { FileText, Video, Music2, Layers, Info } from "lucide-react";
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill'), { 
  ssr: false,
  loading: () => <div className="h-64 w-full bg-gray-100 dark:bg-gray-800 rounded-md animate-pulse" />
});

interface EditContentFormProps {
  content: CourseContent;
  onContentChange: (content: Partial<CourseContent>) => void;
  onSubmit: (content: CourseContent) => Promise<void>;
  onCancel: () => void;
}

interface ContentFormData {
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P';
  content: string;
  isHtmlMode?: boolean;
}

const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, false] }],
    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
    ['link', 'image'],
    ['clean']
  ],
  clipboard: {
    matchVisual: false
  }
};

const quillFormats = [
  'header',
  'bold', 'italic', 'underline', 'strike', 'blockquote',
  'list', 'bullet', 'indent',
  'link', 'image'
];

export const EditContentForm = ({
  content,
  onSubmit,
  onContentChange,
  onCancel,
}: EditContentFormProps) => {
  const [formData, setFormData] = useState<ContentFormData>({
    title: content.title,
    type: content.type,
    content: content.content,
    isHtmlMode: false
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...content,
      ...formData
    });
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    const newFormData = { ...formData, [name]: value };
    setFormData(newFormData);
    onContentChange(newFormData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-6">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex-1 space-y-2">
            <Label htmlFor="title" className="text-sm font-medium">
              Titel
            </Label>
            <Input
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              className="w-full transition-shadow focus-visible:ring-primary"
              placeholder="Geben Sie einen Titel ein..."
            />
          </div>
          <div className="w-full sm:w-48 space-y-2">
            <Label htmlFor="type" className="text-sm font-medium">
              Inhaltstyp
            </Label>
            <Select
              id="type"
              name="type"
              value={formData.type}
              onValueChange={(value) => handleChange({ target: { name: 'type', value } } as any)}
              className="w-full"
            >
              <SelectTrigger className="w-full transition-shadow focus-visible:ring-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Verfügbare Typen</SelectLabel>
                  <SelectItem value="TEXT" className="flex flex-col items-start gap-1 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      <span>Text</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="VIDEO" className="flex flex-col items-start gap-1 py-2">
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4" />
                      <span>Video</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="AUDIO" className="flex flex-col items-start gap-1 py-2">
                    <div className="flex items-center gap-2">
                      <Music2 className="h-4 w-4" />
                      <span>Audio</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="H5P" className="flex flex-col items-start gap-1 py-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      <span>H5P</span>
                    </div>
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        {formData.type === 'TEXT' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="html-mode"
                checked={formData.isHtmlMode}
                onCheckedChange={(checked) => setFormData({ ...formData, isHtmlMode: checked })}
              />
              <Label htmlFor="html-mode">HTML Mode</Label>
            </div>
            
            {formData.isHtmlMode ? (
              <div className="space-y-2">
                <Label htmlFor="html-content">HTML Content</Label>
                <Textarea
                  id="html-content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="min-h-[300px] font-mono"
                  placeholder="<p>Your HTML content here...</p>"
                />
                <div className="prose dark:prose-invert max-w-none mt-4 p-4 border rounded-md">
                  <div dangerouslySetInnerHTML={{ __html: formData.content }} />
                </div>
              </div>
            ) : (
              <ReactQuill
                value={formData.content}
                onChange={(content) => setFormData({ ...formData, content })}
                modules={quillModules}
                formats={quillFormats}
                className="bg-white dark:bg-gray-800"
              />
            )}
          </div>
        )}
        {formData.type !== 'TEXT' && (
          <div className="space-y-2">
            <Label htmlFor="content" className="text-sm font-medium">
              Inhalt
            </Label>
            <Input
              id="content"
              name="content"
              value={formData.content}
              onChange={handleChange}
              className="w-full transition-shadow focus-visible:ring-primary"
              placeholder={
                formData.type === 'VIDEO'
                  ? 'Fügen Sie hier die Video-URL ein...'
                  : formData.type === 'AUDIO'
                  ? 'Fügen Sie hier die Audio-URL ein...'
                  : 'Fügen Sie hier die H5P-ID ein...'
              }
            />
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Hinweis zum {formData.type === 'VIDEO' ? 'Video' : formData.type === 'AUDIO' ? 'Audio' : 'H5P'}-Inhalt</p>
                  <p className="text-sm text-muted-foreground">
                    {formData.type === 'VIDEO' && 'Fügen Sie eine gültige Video-URL ein (z.B. YouTube, Vimeo).'}
                    {formData.type === 'AUDIO' && 'Fügen Sie eine gültige Audio-URL ein (z.B. MP3, WAV).'}
                    {formData.type === 'H5P' && 'Fügen Sie die H5P-Inhalts-ID ein.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20 transition-colors"
        >
          Abbrechen
        </Button>
        <Button
          type="submit"
          className="bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 text-primary-foreground shadow-sm transition-all duration-200"
        >
          Speichern
        </Button>
      </div>
    </form>
  );
};