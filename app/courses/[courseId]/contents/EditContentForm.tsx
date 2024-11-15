'use client'

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CourseContent, QuizContent } from './types';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select";
import { FileText, Video, Music2, Layers, Info, HelpCircle } from "lucide-react";
import { QuizEditor } from './QuizEditor';
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
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ';
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

export function EditContentForm({
  content: initialContent,
  onSubmit,
  onContentChange,
  onCancel,
}: EditContentFormProps) {
  const [formData, setFormData] = useState<ContentFormData>(() => {
    let content = initialContent.content;
    // If it's a TEXT type but contains quiz content, parse it
    if (initialContent.type === 'TEXT' && 
        typeof content === 'string' && 
        content.includes('"questions":[')) {
      try {
        content = JSON.parse(content);
      } catch (e) {
        console.error('Failed to parse quiz content:', e);
      }
    }
    
    return {
      title: initialContent.title,
      type: initialContent.type === 'TEXT' && typeof content === 'object' ? 'QUIZ' : initialContent.type,
      content: typeof content === 'object' ? JSON.stringify(content) : content as string,
      isHtmlMode: false,
    };
  });

  const handleQuizChange = (quizContent: QuizContent) => {
    setFormData(prev => ({
      ...prev,
      content: JSON.stringify(quizContent)
    }));
    onContentChange({
      ...initialContent,
      content: JSON.stringify(quizContent)
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Titel</Label>
        <Input
          id="title"
          value={formData.title}
          onChange={(e) => {
            setFormData(prev => ({ ...prev, title: e.target.value }));
            onContentChange({ ...initialContent, title: e.target.value });
          }}
          placeholder="Titel des Inhalts"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="type">Inhaltstyp</Label>
        <Select
          value={formData.type}
          onValueChange={(value: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ') => {
            setFormData(prev => ({ 
              ...prev, 
              type: value,
              content: value === 'QUIZ' ? JSON.stringify({ questions: [], shuffleQuestions: false, passingScore: 70 }) : ''
            }));
            onContentChange({ 
              ...initialContent, 
              type: value,
              content: value === 'QUIZ' ? JSON.stringify({ questions: [], shuffleQuestions: false, passingScore: 70 }) : ''
            });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Wähle einen Inhaltstyp</SelectLabel>
              <SelectItem value="TEXT">
                <div className="flex items-center">
                  <FileText className="w-4 h-4 mr-2" />
                  <span>Text</span>
                </div>
              </SelectItem>
              <SelectItem value="VIDEO">
                <div className="flex items-center">
                  <Video className="w-4 h-4 mr-2" />
                  <span>Video</span>
                </div>
              </SelectItem>
              <SelectItem value="AUDIO">
                <div className="flex items-center">
                  <Music2 className="w-4 h-4 mr-2" />
                  <span>Audio</span>
                </div>
              </SelectItem>
              <SelectItem value="H5P">
                <div className="flex items-center">
                  <Layers className="w-4 h-4 mr-2" />
                  <span>H5P</span>
                </div>
              </SelectItem>
              <SelectItem value="QUIZ">
                <div className="flex items-center">
                  <HelpCircle className="w-4 h-4 mr-2" />
                  <span>Quiz</span>
                </div>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {formData.type === 'QUIZ' ? (
          <QuizEditor
            initialContent={JSON.parse(formData.content)}
            onSave={handleQuizChange}
          />
        ) : formData.type === 'TEXT' ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <Label>Inhalt</Label>
              <div className="flex items-center space-x-2">
                <Label htmlFor="html-mode" className="text-sm">HTML-Modus</Label>
                <Switch
                  id="html-mode"
                  checked={formData.isHtmlMode}
                  onCheckedChange={(checked) => {
                    setFormData(prev => ({ ...prev, isHtmlMode: checked }));
                  }}
                />
              </div>
            </div>
            {formData.isHtmlMode ? (
              <Textarea
                value={formData.content}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, content: e.target.value }));
                  onContentChange({ ...initialContent, content: e.target.value });
                }}
                className="min-h-[200px] font-mono"
              />
            ) : (
              <ReactQuill
                value={formData.content}
                onChange={(content) => {
                  setFormData(prev => ({ ...prev, content }));
                  onContentChange({ ...initialContent, content });
                }}
                modules={quillModules}
                formats={quillFormats}
                className="bg-background"
              />
            )}
          </>
        ) : (
          <>
            <Label>URL oder Embed-Code</Label>
            <Input
              value={formData.content}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, content: e.target.value }));
                onContentChange({ ...initialContent, content: e.target.value });
              }}
              placeholder={
                formData.type === 'VIDEO'
                  ? 'YouTube Video URL'
                  : formData.type === 'AUDIO'
                  ? 'Audio URL'
                  : 'H5P Embed Code'
              }
            />
          </>
        )}
      </div>

      <div className="flex justify-end space-x-2">
        <Button
          variant="outline"
          onClick={onCancel}
        >
          Abbrechen
        </Button>
        <Button
          onClick={() => onSubmit({ ...initialContent, ...formData })}
        >
          Speichern
        </Button>
      </div>
    </div>
  );
}