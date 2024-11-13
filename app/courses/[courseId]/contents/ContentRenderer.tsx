
'use client'

import { CourseContent } from './types';

interface ContentRendererProps {
  content: CourseContent;
}

export function ContentRenderer({ content }: ContentRendererProps) {
  switch (content.type) {
    case 'TEXT':
      return (
        <div 
          className="prose dark:prose-invert max-w-none" 
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
}