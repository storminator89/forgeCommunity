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
import { Editor } from "@/components/Editor";

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
    <div className="space-y-8 p-8 bg-gradient-to-br from-card to-card/95 rounded-lg border border-border/50 shadow-sm">
      <div className="space-y-3">
        <Label htmlFor="title" className="text-lg font-semibold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          Titel
        </Label>
        <Input
          id="title"
          value={formData.title}
          onChange={(e) => {
            setFormData(prev => ({ ...prev, title: e.target.value }));
            onContentChange({ ...initialContent, title: e.target.value });
          }}
          placeholder="Titel des Inhalts"
          className="w-full bg-background/50 border-border/50 focus:border-primary/50 transition-all duration-200"
        />
      </div>

      <div className="space-y-3">
        <Label htmlFor="type" className="text-lg font-semibold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          Inhaltstyp
        </Label>
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
          <SelectTrigger className="w-full bg-background/50 border-border/50 focus:border-primary/50 transition-all duration-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-sm font-medium text-muted-foreground">Wähle einen Inhaltstyp</SelectLabel>
              <SelectItem value="TEXT" className="group">
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 rounded-md bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors duration-200">
                    <FileText className="w-4 h-4" />
                  </div>
                  <span>Text</span>
                </div>
              </SelectItem>
              <SelectItem value="VIDEO" className="group">
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 rounded-md bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors duration-200">
                    <Video className="w-4 h-4" />
                  </div>
                  <span>Video</span>
                </div>
              </SelectItem>
              <SelectItem value="AUDIO" className="group">
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 rounded-md bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors duration-200">
                    <Music2 className="w-4 h-4" />
                  </div>
                  <span>Audio</span>
                </div>
              </SelectItem>
              <SelectItem value="H5P" className="group">
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 rounded-md bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors duration-200">
                    <Layers className="w-4 h-4" />
                  </div>
                  <span>H5P</span>
                </div>
              </SelectItem>
              <SelectItem value="QUIZ" className="group">
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 rounded-md bg-primary/5 text-primary group-hover:bg-primary/10 transition-colors duration-200">
                    <HelpCircle className="w-4 h-4" />
                  </div>
                  <span>Quiz</span>
                </div>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {formData.type === 'QUIZ' ? (
          <div className="bg-background/50 rounded-lg p-6 border border-border/50">
            <QuizEditor
              initialContent={JSON.parse(formData.content)}
              onSave={handleQuizChange}
            />
          </div>
        ) : formData.type === 'TEXT' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-lg font-semibold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Inhalt
              </Label>
              <div className="flex items-center space-x-3">
                <Label htmlFor="html-mode" className="text-sm text-muted-foreground">HTML-Modus</Label>
                <Switch
                  id="html-mode"
                  checked={formData.isHtmlMode}
                  onCheckedChange={(checked) => {
                    setFormData(prev => ({ ...prev, isHtmlMode: checked }));
                  }}
                  className="data-[state=checked]:bg-primary"
                />
              </div>
            </div>
            <div className="bg-background/50 rounded-lg border border-border/50 overflow-hidden">
              {formData.isHtmlMode ? (
                <Textarea
                  value={formData.content}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, content: e.target.value }));
                    onContentChange({ ...initialContent, content: e.target.value });
                  }}
                  className="min-h-[300px] font-mono p-4 bg-transparent focus:border-primary/50"
                />
              ) : (
                <div className="[&_.ql-toolbar]:border-border/50 [&_.ql-container]:border-border/50">
                  <Editor
                    content={formData.content}
                    onChange={(content: string) => {
                      setFormData(prev => ({ ...prev, content }));
                      onContentChange({ ...initialContent, content });
                    }}
                    className="min-h-[250px]"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Label className="text-lg font-semibold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              URL oder Embed-Code
            </Label>
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
              className="w-full bg-background/50 border-border/50 focus:border-primary/50 transition-all duration-200"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end items-center space-x-4 pt-6 border-t border-border/50">
        <Button
          variant="outline"
          onClick={onCancel}
          className="bg-background/50 hover:bg-background border-border/50 hover:border-border transition-colors duration-200"
        >
          Abbrechen
        </Button>
        <Button
          onClick={() => onSubmit({ ...initialContent, ...formData })}
          className="bg-primary hover:bg-primary/90 text-primary-foreground transition-colors duration-200"
        >
          Speichern
        </Button>
      </div>
    </div>
  );
}