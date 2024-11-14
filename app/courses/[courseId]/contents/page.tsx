'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Button
} from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  PlusCircle,
  Edit,
  Trash2,
  FileText,
  Video,
  Music,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Loader2
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { H5PSelectionDialog } from '@/components/h5p/H5PSelectionDialog';
import { NewMainTopicDialog } from './NewMainTopicDialog';
import { SubContentForm } from './SubContentForm';
import { ContentList } from './ContentList';
import { ContentViewer } from './ContentViewer';
import { ContentRenderer } from './ContentRenderer';
import { CourseHeader } from './CourseHeader';
import { CourseMainContent } from './CourseMainContent';

// Dynamisches Laden von ReactQuill
const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

// Importiere die neue Komponente
import { EditContentForm } from './EditContentForm';
import { CourseContentsSidebar } from './CourseContentsSidebar';

interface CourseContent {
  id: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P';
  content: string;
  order: number;
  parentId: string | null;
  subContents?: CourseContent[];
}

export default function CourseContentsPage({ params }: { params: { courseId: string } }) {
  const [mainContents, setMainContents] = useState<CourseContent[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<CourseContent>({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null });
  const [editingContentId, setEditingContentId] = useState<string | null>(null); // Track which content is being edited
  const [isTopicsSidebarOpen, setIsTopicsSidebarOpen] = useState(true); // Separate Zustand für die Lernpfad-Sidebar
  const [isAddingMainContent, setIsAddingMainContent] = useState(false);
  const [isAddingSubContent, setIsAddingSubContent] = useState(false);
  const [newMainContentTitle, setNewMainContentTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean, content: CourseContent | null }>({ open: false, content: null });
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isH5PDialogOpen, setIsH5PDialogOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256); // 256px = 16rem (w-64)
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [inlineEditTitle, setInlineEditTitle] = useState<string>('');
  const [isInlineEditing, setIsInlineEditing] = useState<string | null>(null);

  // Finden des ausgewählten Inhalts basierend auf selectedContentId
  const selectedMainContent = useMemo(() => {
    // First check if the content is a subcontent
    for (const main of mainContents) {
      if (main.subContents) {
        const sub = main.subContents.find(sub => sub.id === selectedContentId);
        if (sub) return sub;
      }
    }
    // If not found in subcontents, check main contents
    return mainContents.find(content => content.id === selectedContentId) || null;
  }, [mainContents, selectedContentId]);

  const startResizing = (e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.pageX;
    startWidth.current = sidebarWidth;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const delta = e.pageX - startX.current;
    const newWidth = Math.max(200, Math.min(500, startWidth.current + delta));
    setSidebarWidth(newWidth);
  };

  const stopResizing = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  // Funktion zum Abrufen der Kursinhalte
  const fetchContents = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents`);
      if (response.ok) {
        const data: CourseContent[] = await response.json();
        setMainContents(data);
        if (!selectedContentId && data.length > 0) {
          setSelectedContentId(data[0].id);
        }
      } else {
        throw new Error('Failed to fetch contents');
      }
    } catch (error) {
      console.error('Error fetching contents:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Laden der Kursinhalte.' });
    } finally {
      setIsLoading(false);
    }
  }, [params.courseId]);

  // Initiales Laden der Inhalte und Authentifizierung prüfen
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    } else {
      fetchContents();
    }
  }, [status, router, fetchContents]);

  useEffect(() => {
    fetchContents();
  }, [fetchContents]);

  // Alert-Nachrichten automatisch nach 3 Sekunden ausblenden
  useEffect(() => {
    if (alertMessage) {
      const timer = setTimeout(() => {
        setAlertMessage(null);
      }, 3000); // 3000 Millisekunden = 3 Sekunden

      // Bereinigung des Timers bei Änderung von alertMessage oder Unmount
      return () => clearTimeout(timer);
    }
  }, [alertMessage]);

  // Handler zum Hinzufügen eines neuen Hauptthemas
  const handleMainContentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newMainContentTitle,
          type: 'TEXT',
          content: '',
          order: mainContents.length + 1,
          parentId: null
        }),
      });

      if (response.ok) {
        const createdContent: CourseContent = await response.json();
        setNewMainContentTitle('');
        setAlertMessage({ type: 'success', message: 'Neues Hauptthema erfolgreich hinzugefügt.' });
        setMainContents(prev => [...prev, { ...createdContent, subContents: [] }]);
        setSelectedContentId(createdContent.id);
        setIsAddingMainContent(false);
      } else {
        throw new Error('Failed to create main content');
      }
    } catch (error) {
      console.error('Error creating main content:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Hinzufügen des neuen Hauptthemas.' });
    }
  };

  // Handler zum Hinzufügen eines neuen Unterthemas
  const handleSubContentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContentId) {
      setAlertMessage({ type: 'error', message: 'Kein Hauptthema ausgewählt.' });
      return;
    }
    try {
      let contentToSend = newContent.content;
      if (newContent.type === 'VIDEO') {
        contentToSend = getYouTubeEmbedUrl(newContent.content);
      }

      const response = await fetch(`/api/courses/${params.courseId}/contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newContent.title,
          type: newContent.type,
          content: contentToSend,
          order: (mainContents.find(c => c.id === selectedContentId)?.subContents?.length || 0) + 1,
          parentId: selectedContentId
        }),
      });

      if (response.ok) {
        const createdSubContent: CourseContent = await response.json();
        setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null });
        setAlertMessage({ type: 'success', message: 'Neues Unterthema erfolgreich hinzugefügt.' });

        setMainContents(prev => prev.map(content => {
          if (content.id === selectedContentId) {
            return {
              ...content,
              subContents: [...(content.subContents || []), createdSubContent]
            };
          }
          return content;
        }));
        setIsAddingSubContent(false);
      } else {
        throw new Error('Failed to create sub-content');
      }
    } catch (error) {
      console.error('Error creating sub-content:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Hinzufügen des neuen Unterthemas.' });
    }
  };

  // Handler zum Aktualisieren eines Inhalts (Hauptthema oder Unterthema)
  const handleContentUpdate = async (e: React.FormEvent, updatedContent: CourseContent) => {
    e.preventDefault();
    try {
      let contentToSend = updatedContent.content;
      if (updatedContent.type === 'VIDEO') {
        contentToSend = getYouTubeEmbedUrl(updatedContent.content);
      }

      const payload: any = {
        title: updatedContent.title,
        type: updatedContent.type,
        content: contentToSend,
      };

      // 'order' ist nur relevant, wenn es eine Änderung der Reihenfolge gab
      // Falls Sie beim Bearbeiten eines Inhalts auch die Reihenfolge ändern möchten, fügen Sie 'order' hinzu
      if (updatedContent.order !== undefined) {
        payload.order = updatedContent.order;
      }

      const response = await fetch(`/api/courses/${params.courseId}/contents/${updatedContent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const returnedContent: CourseContent = await response.json();
        setAlertMessage({ type: 'success', message: 'Inhalt erfolgreich aktualisiert.' });

        setMainContents(prev => prev.map(content => {
          // If this is the main content being updated
          if (content.id === returnedContent.id) {
            return { ...content, ...returnedContent };
          }
          // If this content has subcontents, check if we need to update any of them
          if (content.subContents?.length > 0) {
            return {
              ...content,
              subContents: content.subContents.map(sub =>
                sub.id === returnedContent.id ? { ...sub, ...returnedContent } : sub
              )
            };
          }
          return content;
        }));

        // Aktualisiere den ausgewählten Inhalt, falls es das bearbeitete Element ist
        if (selectedContentId === returnedContent.id) {
          setSelectedContentId(returnedContent.id);
        }

        setEditingContentId(null); // Beende das Bearbeiten
      } else {
        throw new Error('Failed to update content');
      }
    } catch (error) {
      console.error('Error updating content:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Aktualisieren des Inhalts.' });
    }
  };

  // Handler zum Initiieren des Löschvorgangs
  const handleDeleteContent = (content: CourseContent) => {
    setConfirmDelete({ open: true, content });
  };

  // Handler zum Bestätigen des Löschvorgangs
  const confirmDeleteContent = async () => {
    const content = confirmDelete.content;
    if (!content) return;

    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents/${content.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete content');
      }

      setAlertMessage({ type: 'success', message: 'Inhalt erfolgreich gelöscht.' });

      setMainContents(prev => {
        // If deleting a main content
        if (!content.parentId) {
          return prev.filter(c => c.id !== content.id);
        }
        
        // If deleting a subtheme
        return prev.map(main => {
          if (main.subContents) {
            return {
              ...main,
              subContents: main.subContents.filter(sub => sub.id !== content.id)
            };
          }
          return main;
        });
      });

      // Reset selected content if needed
      if (selectedContentId === content.id) {
        const firstMain = mainContents[0];
        setSelectedContentId(firstMain ? firstMain.id : null);
      }

      // Close the confirmation dialog
      setConfirmDelete({ open: false, content: null });
    } catch (error) {
      console.error('Error deleting content:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Löschen des Inhalts.' });
    }
  };

  // Funktion zum Konvertieren einer YouTube-URL in eine Embed-URL
  const getYouTubeEmbedUrl = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      return `https://www.youtube.com/embed/${match[2]}`;
    }
    return url;
  };

  // Funktion zum Abrufen des entsprechenden Icons basierend auf dem Typ
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

  // Handler zum Verschieben eines Unterthemas nach oben
  const handleMoveSubContentUp = async (mainContentId: string, subContentId: string) => {
    const mainContent = mainContents.find(content => content.id === mainContentId);
    if (!mainContent?.subContents) return;

    const currentIndex = mainContent.subContents.findIndex(sub => sub.id === subContentId);
    if (currentIndex <= 0) return; // Already at the top

    const newSubContents = [...mainContent.subContents];
    const temp = newSubContents[currentIndex];
    newSubContents[currentIndex] = newSubContents[currentIndex - 1];
    newSubContents[currentIndex - 1] = temp;

    // Update the order property for the moved items
    newSubContents[currentIndex].order = currentIndex + 1;
    newSubContents[currentIndex - 1].order = currentIndex;

    try {
      // Update the order on the server
      const updatePromises = [
        fetch(`/api/courses/${params.courseId}/contents/${newSubContents[currentIndex].id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newSubContents[currentIndex].title,
            type: newSubContents[currentIndex].type,
            content: newSubContents[currentIndex].content,
            order: newSubContents[currentIndex].order,
            parentId: mainContentId
          }),
        }),
        fetch(`/api/courses/${params.courseId}/contents/${newSubContents[currentIndex - 1].id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newSubContents[currentIndex - 1].title,
            type: newSubContents[currentIndex - 1].type,
            content: newSubContents[currentIndex - 1].content,
            order: newSubContents[currentIndex - 1].order,
            parentId: mainContentId
          }),
        })
      ];

      await Promise.all(updatePromises);
      
      // Update local state
      setMainContents(prev => prev.map(content => {
        if (content.id === mainContentId) {
          return { ...content, subContents: newSubContents };
        }
        return content;
      }));

      setAlertMessage({ type: 'success', message: 'Reihenfolge erfolgreich aktualisiert.' });
    } catch (error) {
      console.error('Error updating sub contents order:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Aktualisieren der Reihenfolge.' });
    }
  };

  // Handler zum Verschieben eines Unterthemas nach unten
  const handleMoveSubContentDown = async (mainContentId: string, subContentId: string) => {
    const mainContent = mainContents.find(content => content.id === mainContentId);
    if (!mainContent?.subContents) return;

    const currentIndex = mainContent.subContents.findIndex(sub => sub.id === subContentId);
    if (currentIndex === -1 || currentIndex >= mainContent.subContents.length - 1) return; // Already at the bottom

    const newSubContents = [...mainContent.subContents];
    const temp = newSubContents[currentIndex];
    newSubContents[currentIndex] = newSubContents[currentIndex + 1];
    newSubContents[currentIndex + 1] = temp;

    // Update the order property for the moved items
    newSubContents[currentIndex].order = currentIndex + 1;
    newSubContents[currentIndex + 1].order = currentIndex + 2;

    try {
      // Update the order on the server
      const updatePromises = [
        fetch(`/api/courses/${params.courseId}/contents/${newSubContents[currentIndex].id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newSubContents[currentIndex].title,
            type: newSubContents[currentIndex].type,
            content: newSubContents[currentIndex].content,
            order: newSubContents[currentIndex].order,
            parentId: mainContentId
          }),
        }),
        fetch(`/api/courses/${params.courseId}/contents/${newSubContents[currentIndex + 1].id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newSubContents[currentIndex + 1].title,
            type: newSubContents[currentIndex + 1].type,
            content: newSubContents[currentIndex + 1].content,
            order: newSubContents[currentIndex + 1].order,
            parentId: mainContentId
          }),
        })
      ];

      await Promise.all(updatePromises);
      
      // Update local state
      setMainContents(prev => prev.map(content => {
        if (content.id === mainContentId) {
          return { ...content, subContents: newSubContents };
        }
        return content;
      }));

      setAlertMessage({ type: 'success', message: 'Reihenfolge erfolgreich aktualisiert.' });
    } catch (error) {
      console.error('Error updating sub contents order:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Aktualisieren der Reihenfolge.' });
    }
  };

  // Handler zum Hinzufügen eines neuen H5P-Inhalts
  const handleH5PSelect = (h5pContent: any) => {
    setNewContent(prev => ({
      ...prev,
      content: h5pContent.id, // Store H5P content ID
      type: 'H5P'
    }));
    setIsH5PDialogOpen(false);
  };

  // Ladeindikator anzeigen, während Inhalte geladen werden
  if (status === 'loading' || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin h-8 w-8 text-gray-500" />
      </div>
    );
  }

  // Kein Zugriff, wenn nicht authentifiziert
  if (!session) {
    return null;
  }

  const renderContentInput = (type: string) => {
    switch (type) {
      case 'TEXT':
        return (
          <ReactQuill
            value={newContent.content}
            onChange={(content) => setNewContent({ ...newContent, content })}
            modules={{
              toolbar: [
                [{ 'header': [1, 2, false] }],
                ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
                ['link', 'image'],
                ['clean']
              ],
            }}
            className="bg-white dark:bg-gray-700 rounded-md"
          />
        );
      case 'VIDEO':
        return (
          <Input
            value={newContent.content}
            onChange={(e) => setNewContent({ ...newContent, content: e.target.value })}
            placeholder="YouTube URL eingeben"
          />
        );
      case 'AUDIO':
        return (
          <Input
            value={newContent.content}
            onChange={(e) => setNewContent({ ...newContent, content: e.target.value })}
            placeholder="Audio URL eingeben"
          />
        );
      case 'H5P':
        return (
          <div className="space-y-4">
            <Button 
              type="button"
              onClick={() => setIsH5PDialogOpen(true)}
              className="w-full"
            >
              H5P Inhaltstyp auswählen
            </Button>
            {newContent.content && (
              <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
                <p className="font-medium">Ausgewählter H5P Inhaltstyp:</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{newContent.content}</p>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // Add new state for inline title editing near other state declarations
  const handleInlineTitleUpdate = async (contentId: string, newTitle: string) => {
    try {
      const content = mainContents.find(c => c.id === contentId);
      if (!content) return;

      const response = await fetch(`/api/courses/${params.courseId}/contents/${contentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...content,
          title: newTitle,
        }),
      });

      if (response.ok) {
        setMainContents(prev => prev.map(c => 
          c.id === contentId ? { ...c, title: newTitle } : c
        ));
        setAlertMessage({ type: 'success', message: 'Titel erfolgreich aktualisiert.' });
      } else {
        throw new Error('Failed to update title');
      }
    } catch (error) {
      console.error('Error updating title:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Aktualisieren des Titels.' });
    } finally {
      setIsInlineEditing(null);
      setInlineEditTitle('');
    }
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <CourseHeader />

        {/* Hauptinhalt */}
        <main className="flex-1 overflow-hidden flex relative">
          <CourseContentsSidebar
            mainContents={mainContents}
            selectedContentId={selectedContentId}
            isTopicsSidebarOpen={isTopicsSidebarOpen}
            sidebarWidth={sidebarWidth}
            isAddingMainContent={isAddingMainContent}
            newMainContentTitle={newMainContentTitle}
            isInlineEditing={isInlineEditing}
            inlineEditTitle={inlineEditTitle}
            onContentSelect={setSelectedContentId}
            onEditClick={(content) => {
              setEditingContentId(content.id);
              setNewContent(content);
            }}
            onDeleteClick={handleDeleteContent}
            onInlineEditSubmit={handleInlineTitleUpdate}
            setIsInlineEditing={setIsInlineEditing}
            setInlineEditTitle={setInlineEditTitle}
            setIsAddingMainContent={setIsAddingMainContent}
            onMainContentSubmit={handleMainContentSubmit}
            setNewMainContentTitle={setNewMainContentTitle}
            startResizing={startResizing}
            onMoveSubContentUp={handleMoveSubContentUp}
            onMoveSubContentDown={handleMoveSubContentDown}
          />

          {/* Rest der Komponente bleibt unverändert */}
          <button
            onClick={() => setIsTopicsSidebarOpen(!isTopicsSidebarOpen)}
            className="absolute top-1/2 transform -translate-y-1/2 bg-white dark:bg-gray-800 p-2 rounded-r-md shadow-md z-20 transition-all duration-300"
            style={{ 
              left: isTopicsSidebarOpen ? `${sidebarWidth}px` : '0px'
            }}
            aria-label={isTopicsSidebarOpen ? "Lernpfad schließen" : "Lernpfad öffnen"}
          >
            {isTopicsSidebarOpen ? <ChevronLeft /> : <ChevronRight />}
          </button>

          <CourseMainContent
            alertMessage={alertMessage}
            selectedMainContent={selectedMainContent}
            editingContentId={editingContentId}
            newContent={newContent}
            isAddingSubContent={isAddingSubContent}
            isTopicsSidebarOpen={isTopicsSidebarOpen}
            onEditContent={(content) => {
              setEditingContentId(content.id);
              setNewContent(content);
            }}
            onDeleteContent={handleDeleteContent}
            onContentUpdate={handleContentUpdate}
            setEditingContentId={setEditingContentId}
            setNewContent={setNewContent}
            setIsAddingSubContent={setIsAddingSubContent}
            handleSubContentSubmit={handleSubContentSubmit}
            setIsH5PDialogOpen={setIsH5PDialogOpen}
          />
        </main>
      </div>

      {/* Bestätigungsdialog für das Löschen */}
      <Dialog open={confirmDelete.open} onOpenChange={(open) => !open && setConfirmDelete({ open: false, content: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inhalt löschen</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Möchten Sie diesen Inhalt wirklich löschen?</p>
            {confirmDelete.content?.parentId === null && confirmDelete.content?.subContents?.length > 0 && (
              <p className="text-red-500 mt-2">
                Achtung: Das Löschen dieses Hauptthemas wird auch alle zugehörigen Unterthemen löschen!
              </p>
            )}
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete({ open: false, content: null })}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteContent}
            >
              Löschen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
