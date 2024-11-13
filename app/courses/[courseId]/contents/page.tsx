'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
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
  Loader2,
  GripVertical
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { H5PSelectionDialog } from '@/components/h5p/H5PSelectionDialog';
import { NewMainTopicDialog } from './NewMainTopicDialog';
import { SubContentForm } from './SubContentForm';
import { ContentList } from './ContentList';
import { ContentViewer } from './ContentViewer';
import { ContentRenderer } from './ContentRenderer';

// Dynamisches Laden von ReactQuill
const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

// Importieren von dnd-kit
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import type { UniqueIdentifier } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem'; // SortableItem-Komponente

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

        // Nach dem Abrufen prüfen, ob die ausgewählte Content-ID noch existiert
        if (selectedContentId) {
          const exists = data.some(content =>
            content.id === selectedContentId ||
            content.subContents?.some(sub => sub.id === selectedContentId)
          );
          if (!exists) {
            setSelectedContentId(data.length > 0 ? data[0].id : null);
          }
        } else {
          setSelectedContentId(data.length > 0 ? data[0].id : null);
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
  }, [params.courseId, selectedContentId]);

  // Initiales Laden der Inhalte und Authentifizierung prüfen
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    }
  }, [status, router]);

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
          if (content.id === returnedContent.id) {
            // Hauptthema aktualisieren (inkl. Typ und Inhalt)
            if (returnedContent.parentId === null) {
              return { ...content, ...returnedContent };
            }
            // Unterthema aktualisieren
            return {
              ...content,
              subContents: content.subContents?.map(sub => sub.id === returnedContent.id ? { ...sub, ...returnedContent } : sub)
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

      setMainContents(prev => prev.reduce((acc, c) => {
        if (c.id === content.id) {
          // Hauptinhalt löschen, inklusive Unterinhalte
          return acc;
        }
        if (c.subContents) {
          const filteredSubContents = c.subContents.filter(sub => sub.id !== content.id);
          acc.push({ ...c, subContents: filteredSubContents });
        } else {
          acc.push(c);
        }
        return acc;
      }, [] as CourseContent[]));

      // Wenn der gelöschte Inhalt ausgewählt war, setze die Auswahl auf das erste vorhandene Hauptthema
      if (content.id === selectedContentId) {
        const remainingMain = mainContents.filter(c => c.id !== content.id);
        setSelectedContentId(remainingMain.length > 0 ? remainingMain[0].id : null);
      }

      setConfirmDelete({ open: false, content: null });
    } catch (error) {
      console.error('Error deleting content:', error);
      setAlertMessage({ type: 'error', message: 'Fehler beim Löschen des Inhalts.' });
      setConfirmDelete({ open: false, content: null });
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

  // Initialisieren der Sensoren für dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
    // Sie können weitere Sensoren hinzufügen, z.B. KeyboardSensor
  );

  // Drag-End-Handler für dnd-kit
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId === overId) return;

    // Prüfen, ob die Drag-Aktion innerhalb der Hauptthemen oder Unterthemen stattfindet
    const mainIds = mainContents.map(content => content.id);
    const isMain = mainIds.includes(activeId) && mainIds.includes(overId);

    if (isMain) {
      const oldIndex = mainContents.findIndex(content => content.id === activeId);
      const newIndex = mainContents.findIndex(content => content.id === overId);

      const reordered = arrayMove(mainContents, oldIndex, newIndex);
      setMainContents(reordered);

      // Aktualisieren Sie die Reihenfolge auf dem Server
      try {
        const updatePromises = reordered.map((content, index) => {
          return fetch(`/api/courses/${params.courseId}/contents/${content.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: content.title,
              type: content.type,
              content: content.content,
              order: index + 1,
              parentId: null
            }),
          });
        });

        await Promise.all(updatePromises);
        setAlertMessage({ type: 'success', message: 'Reihenfolge der Hauptthemen erfolgreich aktualisiert.' });
      } catch (error) {
        console.error('Error updating main contents order:', error);
        setAlertMessage({ type: 'error', message: 'Fehler beim Aktualisieren der Reihenfolge der Hauptthemen.' });
      }

    } else {
      // Handle Sub-Contents Dragging
      const mainContent = mainContents.find(content => content.subContents?.some(sub => sub.id === activeId));
      if (!mainContent || !mainContent.subContents) return;

      const oldIndex = mainContent.subContents.findIndex(sub => sub.id === activeId);
      const newIndex = mainContent.subContents.findIndex(sub => sub.id === overId);

      const reorderedSubContents = arrayMove(mainContent.subContents, oldIndex, newIndex);

      setMainContents(prev => prev.map(content => {
        if (content.id === mainContent.id) {
          return { ...content, subContents: reorderedSubContents };
        }
        return content;
      }));

      // Aktualisieren Sie die Reihenfolge auf dem Server
      try {
        const updatePromises = reorderedSubContents.map((sub, index) => {
          return fetch(`/api/courses/${params.courseId}/contents/${sub.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: sub.title,
              type: sub.type,
              content: sub.content,
              order: index + 1,
              parentId: mainContent.id
            }),
          });
        });

        await Promise.all(updatePromises);
        setAlertMessage({ type: 'success', message: 'Reihenfolge der Unterthemen erfolgreich aktualisiert.' });
      } catch (error) {
        console.error('Error updating sub contents order:', error);
        setAlertMessage({ type: 'error', message: 'Fehler beim Aktualisieren der Reihenfolge der Unterthemen.' });
      }
    }
  };

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

  // Finden des ausgewählten Inhalts basierend auf selectedContentId
  const selectedMainContent = mainContents.find(content => content.id === selectedContentId && content.parentId === null) ||
    mainContents.find(content => content.subContents?.some(sub => sub.id === selectedContentId && sub.parentId === content.id)) ||
    null;

  const selectedSubContent = selectedMainContent?.subContents?.find(sub => sub.id === selectedContentId) || null;

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
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              <Button variant="ghost" onClick={() => router.push('/courses')} className="mr-4 flex items-center">
                <ArrowLeft className="h-4 w-4 mr-2" />
                {/* Nur Icon, kein Text */}
              </Button>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Kursinhalte</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        {/* Hauptinhalt */}
        <main className="flex-1 overflow-hidden flex relative">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={mainContents.map(content => String(content.id))}
              strategy={verticalListSortingStrategy}
            >
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
              />
            </SortableContext>

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

            {/* Bereich für die Anzeige und Verwaltung von Inhalten */}
            <div className="flex-1 p-6 overflow-y-auto relative">
              {/* Alert Nachrichten */}
              {alertMessage && (
                <Alert variant={alertMessage.type === 'error' ? "destructive" : "default"} className="mb-4">
                  <AlertTitle>{alertMessage.type === 'error' ? 'Fehler' : 'Erfolg'}</AlertTitle>
                  <AlertDescription>{alertMessage.message}</AlertDescription>
                </Alert>
              )}

              {/* Anzeige des ausgewählten Inhalts und dessen Unterthemen */}
              {selectedMainContent ? (
                <>
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow mb-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-2xl font-bold text-gray-800 dark:text-white">{selectedMainContent.title}</h3>
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingContentId(selectedMainContent.id);
                            setNewContent(selectedMainContent);
                          }}
                          aria-label="Bearbeiten Hauptthema"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteContent(selectedMainContent)}
                          aria-label="Löschen Hauptthema"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-4">
                      {selectedMainContent.subContents && selectedMainContent.subContents.length > 0 ? (
                        <SortableContext
                          items={selectedMainContent.subContents.map(sub => String(sub.id))}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="space-y-2">
                            {selectedMainContent.subContents.map((subContent, index) => (
                              <SortableItem key={subContent.id} id={subContent.id}>
                                <li className="border-t pt-4 flex flex-col">
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center">
                                      <GripVertical className="mr-2 h-4 w-4 cursor-grab" />
                                      <h4 className="text-xl font-semibold text-gray-700 dark:text-gray-200">
                                        {subContent.title}
                                      </h4>
                                    </div>
                                    <div className="flex space-x-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setEditingContentId(subContent.id);
                                          setNewContent(subContent);
                                        }}
                                        aria-label="Bearbeiten Unterthema"
                                      >
                                        <Edit className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteContent(subContent)}
                                        aria-label="Löschen Unterthema"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                  <ContentRenderer content={subContent} />

                                  {/* Inline-Bearbeitungsformular */}
                                  {editingContentId === subContent.id && (
                                    <div className="mt-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg shadow">
                                      <SubContentForm
                                        content={newContent}
                                        onContentChange={setNewContent}
                                        onSubmit={(e) => handleContentUpdate(e, newContent)}
                                        onCancel={() => {
                                          setEditingContentId(null);
                                          setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null });
                                        }}
                                        isEditing={true}
                                        onH5PDialogOpen={() => setIsH5PDialogOpen(true)}
                                      />
                                    </div>
                                  )}
                                </li>
                              </SortableItem>
                            ))}
                          </ul>
                        </SortableContext>
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400">Keine Unterthemen vorhanden.</p>
                      )}
                    </div>

                    {/* Formular zum Hinzufügen eines Unterthemas */}
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

                    {/* Button zum Öffnen des Formulars zum Hinzufügen eines Unterthemas */}
                    {!isAddingSubContent && isTopicsSidebarOpen && (
                      <Button onClick={() => setIsAddingSubContent(true)} className="mt-4 flex items-center w-full">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Neues Unterthema
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 dark:text-gray-400">Wählen Sie ein Hauptthema aus, um die Unterthemen anzuzeigen.</p>
                </div>
              )}

              {/* Editieren eines Hauptthemas inline */}
              {editingContentId === selectedMainContent?.id && (
                <EditContentForm
                  content={newContent}
                  onContentChange={setNewContent}
                  onSubmit={(e) => handleContentUpdate(e, newContent)}
                  onCancel={() => {
                    setEditingContentId(null);
                    setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null });
                  }}
                  setIsH5PDialogOpen={setIsH5PDialogOpen}
                />
              )}

              {/* Bestätigungsdialog für das Löschen */}
              <Dialog open={confirmDelete.open} onOpenChange={(open) => { if (!open) setConfirmDelete({ open: false, content: null }); }}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Inhalt löschen</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <p>Möchten Sie diesen Inhalt wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.</p>
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setConfirmDelete({ open: false, content: null })}>
                        Abbrechen
                      </Button>
                      <Button variant="destructive" onClick={confirmDeleteContent}>
                        Löschen
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <H5PSelectionDialog
                open={isH5PDialogOpen}
                onOpenChange={setIsH5PDialogOpen}
                onSelect={handleH5PSelect}
              />
            </div>
          </DndContext>
        </main>
      </div>
    </div>
  );
}
