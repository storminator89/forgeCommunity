'use client';

import { FileText, Video, Music, Box, HelpCircle } from 'lucide-react';
import { CourseContent } from './types';
import { ContentRenderer } from './ContentRenderer';
import { inferContentType } from './content-form-utils';

const typeDetails = {
  TEXT: { label: 'Text', icon: FileText },
  VIDEO: { label: 'Video', icon: Video },
  AUDIO: { label: 'Audio', icon: Music },
  H5P: { label: 'H5P', icon: Box },
  QUIZ: { label: 'Quiz', icon: HelpCircle },
};

export function ContentViewer({ content }: { content: CourseContent }) {
  const type = inferContentType(content);
  const { label, icon: Icon } = typeDetails[type];
  return (
    <section className="space-y-4">
      <div className="flex min-w-0 items-start gap-3 border-b pb-4">
        <Icon className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{content.title}</h2><p className="text-sm text-muted-foreground">{label}</p></div>
      </div>
      <ContentRenderer content={{ ...content, type }} />
    </section>
  );
}
