'use client'

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Edit, Trash2, PlusCircle } from 'lucide-react'
import { ContentRenderer } from './ContentRenderer'
import { SubContentForm } from './SubContentForm'
import { ContentTypeSelector } from './ContentTypeSelector'
import { ContentEditor } from './ContentEditor'
import { CourseContent } from './types'

interface CourseMainContentProps {
  alertMessage: { type: 'success' | 'error'; message: string } | null
  selectedMainContent: CourseContent | null
  editingContentId: string | null
  newContent: CourseContent
  isAddingSubContent: string | null
  isSelectingContentType: boolean
  isTopicsSidebarOpen: boolean
  onEditContent: (content: CourseContent) => void
  onDeleteContent: (content: CourseContent) => void
  onContentUpdate: (e: React.FormEvent, content: CourseContent) => void
  setEditingContentId: (id: string | null) => void
  setNewContent: (content: CourseContent) => void
  setIsAddingSubContent: (isAdding: string | null) => void
  setIsSelectingContentType: (isSelecting: boolean) => void
  handleSubContentSubmit: (title: string) => Promise<void>
  setIsH5PDialogOpen: (isOpen: boolean) => void
  setMainContents: (contents: CourseContent[]) => void
  setAlertMessage: (message: { type: 'success' | 'error'; message: string } | null) => void
  mainContents: CourseContent[]
  refreshContents: () => Promise<void>
  refreshSingleContent: (contentId: string) => Promise<void>
}

export function CourseMainContent({
  alertMessage,
  selectedMainContent,
  editingContentId,
  newContent,
  isAddingSubContent,
  isSelectingContentType,
  isTopicsSidebarOpen,
  onEditContent,
  onDeleteContent,
  onContentUpdate,
  setEditingContentId,
  setNewContent,
  setIsAddingSubContent,
  setIsSelectingContentType,
  handleSubContentSubmit,
  setIsH5PDialogOpen,
  setMainContents,
  setAlertMessage,
  mainContents,
  refreshContents,
  refreshSingleContent
}: CourseMainContentProps) {
  return (
    <div className="flex-1 h-full overflow-y-auto">
      {/* Only show error messages */}
      {alertMessage?.type === 'error' && (
        <Alert variant="destructive" className="m-6 mb-4">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>{alertMessage.message}</AlertDescription>
        </Alert>
      )}

      {selectedMainContent ? (
        <div className="p-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{selectedMainContent.title}</h3>
              <div className="flex space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditContent(selectedMainContent)}
                  aria-label="Bearbeiten"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeleteContent(selectedMainContent)}
                  aria-label="Löschen"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Content Type Selection when adding new content */}
            {isAddingSubContent && (
              <div className="mt-4 mb-6 w-full">
                <h4 className="text-lg font-semibold mb-4">Wählen Sie den Inhaltstyp aus:</h4>
                <ContentTypeSelector onSelectType={(type) => {
                  setNewContent({ ...newContent, type });
                  setIsSelectingContentType(true);
                }} />
              </div>
            )}

            {/* Show SubContentForm only after type is selected */}
            {isAddingSubContent && isSelectingContentType && (
              <div className="mt-4">
                <SubContentForm
                  content={newContent}
                  onContentChange={setNewContent}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await handleSubContentSubmit(newContent.title);
                  }}
                  onCancel={() => {
                    setIsAddingSubContent(null);
                    setIsSelectingContentType(false);
                    setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null, courseId: '' });
                  }}
                  onH5PDialogOpen={() => setIsH5PDialogOpen(true)}
                />
              </div>
            )}

            {/* Content Editor */}
            {editingContentId === 'new' && selectedMainContent.parentId && (
              <div className="mt-4 mb-6 w-full">
                <h4 className="text-lg font-semibold mb-4">Inhalt erstellen</h4>
                <ContentEditor
                  content={newContent}
                  onSave={async (content) => {
                    try {
                      // If we're editing a subtopic that already exists
                      const response = await fetch(`/api/courses/${selectedMainContent.courseId}/contents/${selectedMainContent.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          title: selectedMainContent.title,
                          type: content.type,
                          content: content.content,
                          order: selectedMainContent.order
                        }),
                      });

                      if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.message || 'Failed to save content');
                      }

                      const savedContent = await response.json();

                      // Update the main contents with the updated content
                      const updatedMainContents = mainContents.map(mainContent => {
                        if (mainContent.id === selectedMainContent.parentId) {
                          return {
                            ...mainContent,
                            subContents: (mainContent.subContents || []).map(sub =>
                              sub.id === selectedMainContent.id ? savedContent : sub
                            )
                          };
                        }
                        return mainContent;
                      });

                      setMainContents(updatedMainContents);
                      setEditingContentId(null);
                      // Only refresh this specific content without showing success message
                      await refreshSingleContent(selectedMainContent.id);
                    } catch (error) {
                      console.error('Error saving content:', error);
                      setAlertMessage({
                        type: 'error',
                        message: error instanceof Error ? error.message : 'Fehler beim Speichern des Inhalts.'
                      });
                    }
                  }}
                  onCancel={() => {
                    setEditingContentId(null);
                    setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null, courseId: '' });
                  }}
                />
              </div>
            )}

            <div className="space-y-4 w-full">
              {/* Show content for subtopics */}
              {selectedMainContent.parentId && (
                <>
                  {selectedMainContent.content ? (
                    <div className="mt-4 w-full">
                      <ContentRenderer content={selectedMainContent} />
                    </div>
                  ) : (
                    <div className="mt-4 text-center p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg w-full">
                      <p className="text-gray-500 dark:text-gray-400 mb-4">Noch keine Inhalte vorhanden</p>
                      <Button
                        variant="outline"
                        onClick={() => setIsAddingSubContent(selectedMainContent.id)}
                        className="flex items-center space-x-2"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Inhalt hinzufügen</span>
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* Show subtopics list for main topics */}
              {!selectedMainContent.parentId && selectedMainContent.subContents && selectedMainContent.subContents.length > 0 && (
                <ul className="space-y-2">
                  {selectedMainContent.subContents.map((subContent) => (
                    <li key={subContent.id} className="border-t pt-4">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xl font-semibold text-gray-700 dark:text-gray-200">
                          {subContent.title}
                        </h4>
                        <div className="flex space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditContent(subContent)}
                            aria-label="Bearbeiten"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteContent(subContent)}
                            aria-label="Löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4">
                        <ContentRenderer content={subContent} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p>Wählen Sie ein Thema aus der linken Seitenleiste aus</p>
        </div>
      )}
    </div>
  );
}
