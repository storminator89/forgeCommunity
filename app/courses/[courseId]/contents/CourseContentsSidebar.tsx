'use client'

import { useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { PlusCircle } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ContentList } from './ContentList';
import { NewMainTopicDialog } from './NewMainTopicDialog';
import { CourseContent } from './types';

interface CourseContentsSidebarProps {
  mainContents: CourseContent[];
  selectedContentId: string | null;
  isTopicsSidebarOpen: boolean;
  sidebarWidth: number;
  isAddingMainContent: boolean;
  newMainContentTitle: string;
  isInlineEditing: string | null;
  inlineEditTitle: string;
  onContentSelect: (id: string) => void;
  onEditClick: (content: CourseContent) => void;
  onDeleteClick: (content: CourseContent) => void;
  onInlineEditSubmit: (contentId: string, newTitle: string) => void;
  setIsInlineEditing: (id: string | null) => void;
  setInlineEditTitle: (title: string) => void;
  setIsAddingMainContent: (isAdding: boolean) => void;
  onMainContentSubmit: (e: React.FormEvent) => Promise<void>;
  setNewMainContentTitle: (title: string) => void;
  startResizing: (e: React.MouseEvent) => void;
}

export function CourseContentsSidebar({
  mainContents,
  selectedContentId,
  isTopicsSidebarOpen,
  sidebarWidth,
  isAddingMainContent,
  newMainContentTitle,
  isInlineEditing,
  inlineEditTitle,
  onContentSelect,
  onEditClick,
  onDeleteClick,
  onInlineEditSubmit,
  setIsInlineEditing,
  setInlineEditTitle,
  setIsAddingMainContent,
  onMainContentSubmit,
  setNewMainContentTitle,
  startResizing
}: CourseContentsSidebarProps) {
  return (
    <div
      style={{ 
        width: isTopicsSidebarOpen ? `${sidebarWidth}px` : '0px',
        minWidth: isTopicsSidebarOpen ? '200px' : '0px',
        maxWidth: isTopicsSidebarOpen ? '500px' : '0px',
      }}
      className="bg-white dark:bg-gray-800 overflow-y-auto border-r border-gray-200 dark:border-gray-700 transition-all duration-300 ease-in-out relative flex-shrink-0"
    >
      <div className={`p-4 ${isTopicsSidebarOpen ? 'block' : 'hidden'}`}>
        <h3 className="text-lg font-semibold mb-4">Lernpfad</h3>
        <ContentList
          contents={mainContents}
          selectedContentId={selectedContentId}
          onContentSelect={onContentSelect}
          onEditClick={onEditClick}
          onDeleteClick={onDeleteClick}
          isInlineEditing={isInlineEditing}
          inlineEditTitle={inlineEditTitle}
          onInlineEditSubmit={onInlineEditSubmit}
          setIsInlineEditing={setIsInlineEditing}
          setInlineEditTitle={setInlineEditTitle}
        />

        <Dialog>
          <DialogTrigger asChild>
            <Button 
              onClick={() => setIsAddingMainContent(true)} 
              className="mt-4 w-full flex items-center"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Neues Hauptthema
            </Button>
          </DialogTrigger>
        </Dialog>

        <NewMainTopicDialog
          isOpen={isAddingMainContent}
          onOpenChange={setIsAddingMainContent}
          onSubmit={async (title) => {
            await onMainContentSubmit({
              preventDefault: () => {},
            } as React.FormEvent);
          }}
          title={newMainContentTitle}
          onTitleChange={setNewMainContentTitle}
        />
      </div>

      {/* Resize Handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 group"
        onMouseDown={startResizing}
      >
        <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-1 h-8 bg-transparent group-hover:bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}