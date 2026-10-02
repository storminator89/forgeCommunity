'use client';

import { CourseContent } from './types';
import { EditContentForm } from './EditContentForm';

interface ContentEditorProps {
  content: CourseContent;
  onSave: (content: CourseContent) => Promise<void> | void;
  onCancel: () => void;
}

/** The legacy inline editor uses the same draft and validation rules as the main editor. */
export function ContentEditor({ content, onSave, onCancel }: ContentEditorProps) {
  return <EditContentForm key={content.id} content={content} onContentChange={() => {}} onSubmit={async draft => { await onSave(draft); }} onCancel={onCancel} />;
}
