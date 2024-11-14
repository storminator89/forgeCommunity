'use client'

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Edit, Trash2 } from 'lucide-react'
import { ContentRenderer } from './ContentRenderer'
import { SubContentForm } from './SubContentForm'
import { CourseContent } from './types'

interface CourseMainContentProps {
  alertMessage: { type: 'success' | 'error'; message: string } | null
  selectedMainContent: CourseContent | null
  editingContentId: string | null
  newContent: CourseContent
  isAddingSubContent: boolean
  isTopicsSidebarOpen: boolean
  onEditContent: (content: CourseContent) => void
  onDeleteContent: (content: CourseContent) => void
  onContentUpdate: (e: React.FormEvent, content: CourseContent) => void
  setEditingContentId: (id: string | null) => void
  setNewContent: (content: CourseContent) => void
  setIsAddingSubContent: (isAdding: boolean) => void
  handleSubContentSubmit: (e: React.FormEvent) => void
  setIsH5PDialogOpen: (isOpen: boolean) => void
}

export function CourseMainContent({
  alertMessage,
  selectedMainContent,
  editingContentId,
  newContent,
  isAddingSubContent,
  isTopicsSidebarOpen,
  onEditContent,
  onDeleteContent,
  onContentUpdate,
  setEditingContentId,
  setNewContent,
  setIsAddingSubContent,
  handleSubContentSubmit,
  setIsH5PDialogOpen
}: CourseMainContentProps) {
  return (
    <div className="flex-1 p-6 overflow-y-auto relative">
      {alertMessage && (
        <Alert variant={alertMessage.type === 'error' ? "destructive" : "default"} className="mb-4">
          <AlertTitle>{alertMessage.type === 'error' ? 'Fehler' : 'Erfolg'}</AlertTitle>
          <AlertDescription>{alertMessage.message}</AlertDescription>
        </Alert>
      )}

      {selectedMainContent ? (
        <>
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{selectedMainContent.title}</h3>
              <div className="flex space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditContent(selectedMainContent)}
                  aria-label="Bearbeiten Hauptthema"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeleteContent(selectedMainContent)}
                  aria-label="Löschen Hauptthema"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-4">
              {/* Show content only if it's a subtopic */}
              {selectedMainContent.parentId && (
                <div className="mt-4">
                  <ContentRenderer content={selectedMainContent} />
                </div>
              )}
              
              {/* Show subtopics list only if it's a main topic */}
              {!selectedMainContent.parentId && selectedMainContent.subContents && selectedMainContent.subContents.length > 0 ? (
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
                            aria-label="Bearbeiten Unterthema"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteContent(subContent)}
                            aria-label="Löschen Unterthema"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : !selectedMainContent.parentId && (
                <p className="text-gray-500 dark:text-gray-400">Keine Unterthemen vorhanden.</p>
              )}
            </div>

            {isAddingSubContent && (
              <div className="mt-6 bg-gray-50 dark:bg-gray-800 p-6 rounded-lg shadow">
                <h4 className="text-xl font-semibold mb-4">Neues Unterthema hinzufügen</h4>
                <SubContentForm
                  content={newContent}
                  onContentChange={setNewContent}
                  onSubmit={handleSubContentSubmit}
                  onCancel={() => setIsAddingSubContent(false)}
                  onH5PDialogOpen={() => setIsH5PDialogOpen(true)}
                />
              </div>
            )}

            {!isAddingSubContent && isTopicsSidebarOpen && (
              <Button
                onClick={() => setIsAddingSubContent(true)}
                className="mt-4 w-full"
                variant="outline"
              >
                Neues Unterthema hinzufügen
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">Wählen Sie ein Thema aus der linken Seitenleiste aus.</p>
        </div>
      )}
    </div>
  )
}
