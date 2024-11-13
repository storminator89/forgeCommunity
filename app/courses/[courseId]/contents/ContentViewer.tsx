'use client'

import { FileText, Video, Music } from 'lucide-react';
import { CourseContent } from './types';

interface ContentViewerProps {
  content: CourseContent;
}

export function ContentViewer({ content }: ContentViewerProps) {
  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case 'TEXT':
        return <FileText className="h-4 w-4" />;
      case 'VIDEO':
        return <Video className="h-4 w-4" />;
      case 'AUDIO':
        return <Music className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const renderContent = () => {
    switch (content.type) {
      case 'TEXT':
        return (
          <div className="prose dark:prose-invert max-w-none" 
            dangerouslySetInnerHTML={{ __html: content.content }} 
          />
        );
      case 'VIDEO':
        return (
          <div className="relative" style={{ paddingBottom: '56.25%', height: 0 }}>
            <iframe
              src={content.content}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute top-0 left-0 w-full h-full rounded-lg shadow-md"
            />
          </div>
        );
      case 'AUDIO':
        return <audio src={content.content} controls className="w-full" />;
      case 'H5P':
        return (
          <div className="relative" style={{ paddingBottom: '56.25%', height: 0 }}>
            <iframe
              src={`/h5p/embed/${content.content}`}
              className="absolute top-0 left-0 w-full h-full rounded-lg shadow-md"
              allowFullScreen
            />
          </div>
        );
      default:
        return <p>{content.content}</p>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center text-sm text-gray-500 mb-2">
        {getContentTypeIcon(content.type)}
        <span className="ml-2">{content.type}</span>
      </div>
      {renderContent()}
    </div>
  );
}