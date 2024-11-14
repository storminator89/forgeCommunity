'use client'

import { useState, useEffect } from 'react';
import { CourseContent } from './types';
import { Editor } from '@/components/Editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Pencil } from 'lucide-react';

interface ContentRendererProps {
  content: CourseContent;
  isEditing?: boolean;
  onSave?: (contentId: string, newContent: string) => Promise<void>;
  onEditToggle?: (isEditing: boolean) => void;
}

export function ContentRenderer({ content, isEditing: externalIsEditing, onSave, onEditToggle }: ContentRendererProps) {
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  
  useEffect(() => {
    setEditedContent(content.content || '');
  }, [content.id]);

  const isEditing = externalIsEditing ?? internalIsEditing;

  const handleEditToggle = (editing: boolean) => {
    if (onEditToggle) {
      onEditToggle(editing);
    } else {
      setInternalIsEditing(editing);
    }
  };

  const handleSave = async () => {
    if (onSave) {
      await onSave(content.id, editedContent);
      handleEditToggle(false);
    }
  };

  if (isEditing) {
    return (
      <Card className="p-6 shadow-lg">
        <div className="space-y-6">
          {content.type === 'TEXT' ? (
            <Editor content={editedContent} onChange={setEditedContent} />
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                {content.type === 'VIDEO' ? 'YouTube URL' :
                 content.type === 'AUDIO' ? 'Audio URL' :
                 'H5P Content ID'}
              </label>
              <Input
                type="url"
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                placeholder={
                  content.type === 'VIDEO' ? 'YouTube URL eingeben' :
                  content.type === 'AUDIO' ? 'Audio URL eingeben' :
                  'H5P Content ID oder URL eingeben'
                }
                className="w-full"
              />
            </div>
          )}
          <div className="flex justify-end space-x-2 pt-4">
            <Button 
              variant="outline" 
              onClick={() => handleEditToggle(false)}
              className="px-4"
            >
              Abbrechen
            </Button>
            <Button 
              onClick={handleSave}
              className="px-4"
            >
              Speichern
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const renderContent = () => {
    switch (content.type) {
      case 'TEXT':
        return (
          <div className="prose dark:prose-invert max-w-none p-6 bg-card rounded-lg">
            <div dangerouslySetInnerHTML={{ __html: content.content }} />
          </div>
        );

      case 'VIDEO': {
        const getYouTubeEmbedUrl = (url: string) => {
          try {
            let videoId = '';
            if (url.includes('youtu.be/')) {
              videoId = url.split('youtu.be/')[1].split('?')[0];
            } else if (url.includes('youtube.com')) {
              const urlParams = new URLSearchParams(url.split('?')[1]);
              videoId = urlParams.get('v') || '';
            }
            return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
          } catch (error) {
            console.error('Error parsing YouTube URL:', error);
            return url;
          }
        };

        return (
          <div className="bg-card rounded-lg p-6">
            <div className="relative" style={{ paddingBottom: '56.25%', height: 0 }}>
              <iframe
                src={getYouTubeEmbedUrl(content.content)}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute top-0 left-0 w-full h-full rounded-lg shadow-md"
              />
            </div>
          </div>
        );
      }

      case 'AUDIO':
        return (
          <div className="bg-card rounded-lg p-6">
            <audio 
              src={content.content} 
              controls 
              className="w-full"
            />
          </div>
        );

      case 'H5P':
        return (
          <div className="bg-card rounded-lg p-6">
            <div className="relative" style={{ paddingBottom: '56.25%', height: 0 }}>
              <iframe
                src={`/h5p/embed/${content.content}`}
                className="absolute top-0 left-0 w-full h-full rounded-lg shadow-md"
                allowFullScreen
              />
            </div>
          </div>
        );

      default:
        return (
          <div className="bg-card rounded-lg p-6">
            <p>{content.content}</p>
          </div>
        );
    }
  };

  return (
    <div className="space-y-4">
      {onSave && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => handleEditToggle(true)}
            className="flex items-center space-x-2"
          >
            <Pencil className="h-4 w-4" />
            <span>Bearbeiten</span>
          </Button>
        </div>
      )}
      <div className="shadow-md">
        {renderContent()}
      </div>
    </div>
  );
}