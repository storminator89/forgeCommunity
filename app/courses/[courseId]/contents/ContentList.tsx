'use client'

import { CourseContent } from './types';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem';
import { Button } from "@/components/ui/button";
import { Edit, Trash2, GripVertical } from 'lucide-react';
import { Input } from "@/components/ui/input";

interface ContentListProps {
  contents: CourseContent[];
  selectedContentId: string | null;
  onContentSelect: (id: string) => void;
  onEditClick: (content: CourseContent) => void;
  onDeleteClick: (content: CourseContent) => void;
  isInlineEditing: string | null;
  inlineEditTitle: string;
  onInlineEditSubmit: (contentId: string, newTitle: string) => Promise<void>;
  setIsInlineEditing: (id: string | null) => void;
  setInlineEditTitle: (title: string) => void;
}

export function ContentList({
  contents,
  selectedContentId,
  onContentSelect,
  onEditClick,
  onDeleteClick,
  isInlineEditing,
  inlineEditTitle,
  onInlineEditSubmit,
  setIsInlineEditing,
  setInlineEditTitle,
}: ContentListProps) {
  return (
    <div>
      <SortableContext items={contents.map(content => String(content.id))} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {contents.map((content, index) => (
            <SortableItem key={content.id} id={content.id}>
              <li
                className={`p-2 rounded-md cursor-pointer flex justify-between items-center 
                  ${selectedContentId === content.id ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                onClick={() => onContentSelect(content.id)}
              >
                <span className="flex items-center flex-1">
                  <GripVertical className="mr-2 h-4 w-4 cursor-grab" />
                  <span className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 flex items-center justify-center mr-2 text-sm font-medium">
                    {index + 1}
                  </span>
                  {isInlineEditing === content.id ? (
                    <form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        onInlineEditSubmit(content.id, inlineEditTitle);
                      }}
                      className="flex-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={inlineEditTitle}
                        onChange={(e) => setInlineEditTitle(e.target.value)}
                        className="h-7 py-1"
                        autoFocus
                        onBlur={() => {
                          if (inlineEditTitle !== content.title && inlineEditTitle !== '') {
                            onInlineEditSubmit(content.id, inlineEditTitle);
                          } else {
                            setIsInlineEditing(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setIsInlineEditing(null);
                            setInlineEditTitle('');
                          }
                        }}
                      />
                    </form>
                  ) : (
                    <span className="truncate">{content.title}</span>
                  )}
                </span>
                <div className="flex space-x-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsInlineEditing(content.id);
                      setInlineEditTitle(content.title);
                    }}
                    aria-label="Bearbeiten"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteClick(content);
                    }}
                    aria-label="Löschen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </div>
  );
}