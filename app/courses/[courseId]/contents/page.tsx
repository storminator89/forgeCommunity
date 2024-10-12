'use client'

import { useState, useEffect, useCallback } from 'react';
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

// Dynamisches Laden von ReactQuill
const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

// Importieren von dnd-kit
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem'; // SortableItem-Komponente

interface CourseContent {
  id: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO';
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAddingMainContent, setIsAddingMainContent] = useState(false);
  const [isAddingSubContent, setIsAddingSubContent] = useState(false);
  const [newMainContentTitle, setNewMainContentTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean, content: CourseContent | null }>({ open: false, content: null });
  const { data: session, status } = useSession();
  const router = useRouter();

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

  // Funktion zum Rendern des Inhalts basierend auf dem Typ
  const renderContent = (content: CourseContent) => {
    switch (content.type) {
      case 'TEXT':
        return <div className="prose dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: content.content }} />;
      case 'VIDEO':
        return (
          <div className="relative" style={{ paddingBottom: '56.25%', height: 0 }}>
            <iframe
              src={content.content}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute top-0 left-0 w-full h-full rounded-lg shadow-md"
            ></iframe>
          </div>
        );
      case 'AUDIO':
        return <audio src={content.content} controls className="w-full" />;
      default:
        return <p>{content.content}</p>;
    }
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

    const activeId = active.id;
    const overId = over.id;

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

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <Sidebar isOpen={isSidebarOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

      {/* Hauptbereich */}
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
            {/* Sidebar Bereich (Hauptthemen) */}
            <SortableContext
              items={mainContents.map(content => content.id)}
              strategy={verticalListSortingStrategy}
            >
              <div
                className={`${isSidebarOpen ? 'w-1/4' : 'w-16'} bg-white dark:bg-gray-800 overflow-y-auto border-r border-gray-200 dark:border-gray-700 transition-all duration-300 relative`}
              >
                <div className="p-4">
                  {isSidebarOpen && <h3 className="text-lg font-semibold mb-4">Lernpfad</h3>}
                  <ul className="space-y-2">
                    {mainContents.map((content, index) => (
                      <SortableItem key={content.id} id={content.id}>
                        <li
                          className={`p-2 rounded-md cursor-pointer flex justify-between items-center ${selectedContentId === content.id ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                          onClick={() => setSelectedContentId(content.id)}
                        >
                          <span className="flex items-center">
                            <GripVertical className="mr-2 h-4 w-4 cursor-grab" />
                            <span className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 flex items-center justify-center mr-2 text-sm font-medium">{index + 1}</span>
                            {isSidebarOpen && <span className="truncate">{content.title}</span>}
                          </span>
                          {isSidebarOpen && (
                            <div className="flex space-x-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingContentId(content.id);
                                  setNewContent(content);
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
                                  handleDeleteContent(content);
                                }}
                                aria-label="Löschen"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </li>
                      </SortableItem>
                    ))}
                  </ul>

                  {/* Button zum Hinzufügen eines neuen Hauptthemas */}
                  {isSidebarOpen && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button onClick={() => setIsAddingMainContent(true)} className="mt-4 w-full flex items-center">
                          <PlusCircle className="mr-2 h-4 w-4" />
                          Neues Hauptthema
                        </Button>
                      </DialogTrigger>
                    </Dialog>
                  )}

                  {/* Dialog zum Hinzufügen eines neuen Hauptthemas */}
                  {isSidebarOpen && (
                    <Dialog open={isAddingMainContent} onOpenChange={setIsAddingMainContent}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Neues Hauptthema hinzufügen</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleMainContentSubmit} className="space-y-4">
                          <div>
                            <Label htmlFor="mainContentTitle">Titel</Label>
                            <Input
                              id="mainContentTitle"
                              value={newMainContentTitle}
                              onChange={(e) => setNewMainContentTitle(e.target.value)}
                              required
                              placeholder="Titel des Hauptthemas"
                            />
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button type="button" variant="outline" onClick={() => setIsAddingMainContent(false)}>
                              Abbrechen
                            </Button>
                            <Button type="submit">Hinzufügen</Button>
                          </div>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>
            </SortableContext>

            {/* Toggle Sidebar Button */}
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`absolute ${isSidebarOpen ? 'left-1/4' : 'left-16'} top-1/2 transform -translate-y-1/2 bg-white dark:bg-gray-800 p-2 rounded-r-md shadow-md z-20 transition-all duration-300`}
              aria-label={isSidebarOpen ? "Sidebar schließen" : "Sidebar öffnen"}
            >
              {isSidebarOpen ? <ChevronLeft /> : <ChevronRight />}
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
                          items={selectedMainContent.subContents.map(sub => sub.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="space-y-2">
                            {selectedMainContent.subContents.map((subContent, index) => (
                              <SortableItem key={subContent.id} id={subContent.id}>
                                <li className="border-t pt-4 flex flex-col">
                                  <div className="flex justify-between items-center">
                                    <div className="flex items-center">
                                      <GripVertical className="mr-2 h-4 w-4 cursor-grab" />
                                      <h4 className="text-xl font-semibold text-gray-700 dark:text-gray-200">{subContent.title}</h4>
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
                                  <p className="text-sm text-gray-500 mb-2 flex items-center">
                                    {getContentTypeIcon(subContent.type)}
                                    <span className="ml-2">{subContent.type}</span>
                                  </p>
                                  {renderContent(subContent)}

                                  {/* Inline-Bearbeitungsformular */}
                                  {editingContentId === subContent.id && (
                                    <div className="mt-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg shadow">
                                      <form onSubmit={(e) => handleContentUpdate(e, newContent)} className="space-y-4">
                                        <div>
                                          <Label htmlFor="editTitle">Titel</Label>
                                          <Input
                                            id="editTitle"
                                            value={newContent.title}
                                            onChange={(e) => setNewContent({ ...newContent, title: e.target.value })}
                                            required
                                            placeholder="Titel des Unterthemas"
                                          />
                                        </div>
                                        <div>
                                          <Label htmlFor="editType">Typ</Label>
                                          <select
                                            id="editType"
                                            value={newContent.type}
                                            onChange={(e) => setNewContent({ ...newContent, type: e.target.value as 'TEXT' | 'VIDEO' | 'AUDIO' })}
                                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                          >
                                            <option value="TEXT">Text</option>
                                            <option value="VIDEO">Video</option>
                                            <option value="AUDIO">Audio</option>
                                          </select>
                                        </div>
                                        <div>
                                          <Label htmlFor="editContent">Inhalt</Label>
                                          {newContent.type === 'TEXT' ? (
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
                                              className="bg-white dark:bg-gray-700 rounded-md h-4/5" // Höhe auf 80% gesetzt
                                            />
                                          ) : (
                                            <Input
                                              id="editContent"
                                              value={newContent.content}
                                              onChange={(e) => setNewContent({ ...newContent, content: e.target.value })}
                                              placeholder={newContent.type === 'VIDEO' ? "YouTube URL" : "Audio URL"}
                                              required
                                            />
                                          )}
                                        </div>
                                        <div className="flex justify-end space-x-2">
                                          <Button type="button" variant="outline" onClick={() => {
                                            setEditingContentId(null);
                                            setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null });
                                          }}>
                                            Abbrechen
                                          </Button>
                                          <Button type="submit">
                                            Aktualisieren
                                          </Button>
                                        </div>
                                      </form>
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
                        <form onSubmit={handleSubContentSubmit} className="space-y-4">
                          <div>
                            <Label htmlFor="title">Titel</Label>
                            <Input
                              id="title"
                              value={newContent.title}
                              onChange={(e) => setNewContent({ ...newContent, title: e.target.value })}
                              required
                              placeholder="Titel des Unterthemas"
                            />
                          </div>
                          <div>
                            <Label htmlFor="type">Typ</Label>
                            <select
                              id="type"
                              value={newContent.type}
                              onChange={(e) => setNewContent({ ...newContent, type: e.target.value as 'TEXT' | 'VIDEO' | 'AUDIO' })}
                              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            >
                              <option value="TEXT">Text</option>
                              <option value="VIDEO">Video</option>
                              <option value="AUDIO">Audio</option>
                            </select>
                          </div>
                          <div>
                            <Label htmlFor="content">Inhalt</Label>
                            {newContent.type === 'TEXT' ? (
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
                                className="bg-white dark:bg-gray-700 rounded-md h-4/5" // Höhe auf 80% gesetzt
                              />
                            ) : (
                              <Input
                                id="content"
                                value={newContent.content}
                                onChange={(e) => setNewContent({ ...newContent, content: e.target.value })}
                                placeholder={newContent.type === 'VIDEO' ? "YouTube URL" : "Audio URL"}
                                required
                              />
                            )}
                          </div>
                          {/* Buttons in einem separaten Container */}
                          <div className="flex justify-end space-x-2">
                            <Button type="button" variant="outline" onClick={() => setIsAddingSubContent(false)}>
                              Abbrechen
                            </Button>
                            <Button type="submit">
                              Hinzufügen
                            </Button>
                          </div>
                        </form>
                      </div>
                    )}

                    {/* Button zum Öffnen des Formulars zum Hinzufügen eines Unterthemas */}
                    {!isAddingSubContent && isSidebarOpen && (
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
                <div className="mt-4 bg-gray-50 dark:bg-gray-800 p-6 rounded-lg shadow">
                  <form onSubmit={(e) => handleContentUpdate(e, newContent)} className="space-y-4">
                    <div>
                      <Label htmlFor="editTitle">Titel</Label>
                      <Input
                        id="editTitle"
                        value={newContent.title}
                        onChange={(e) => setNewContent({ ...newContent, title: e.target.value })}
                        required
                        placeholder="Titel des Hauptthemas"
                      />
                    </div>
                    <div>
                      <Label htmlFor="editType">Typ</Label>
                      <select
                        id="editType"
                        value={newContent.type}
                        onChange={(e) => setNewContent({ ...newContent, type: e.target.value as 'TEXT' | 'VIDEO' | 'AUDIO' })}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      >
                        <option value="TEXT">Text</option>
                        <option value="VIDEO">Video</option>
                        <option value="AUDIO">Audio</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="editContent">Inhalt</Label>
                      {newContent.type === 'TEXT' ? (
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
                          className="bg-white dark:bg-gray-700 rounded-md h-4/5" // Höhe auf 80% gesetzt
                        />
                      ) : (
                        <Input
                          id="editContent"
                          value={newContent.content}
                          onChange={(e) => setNewContent({ ...newContent, content: e.target.value })}
                          placeholder={newContent.type === 'VIDEO' ? "YouTube URL" : "Audio URL"}
                          required
                        />
                      )}
                    </div>
                    <div className="flex justify-end space-x-2">
                      <Button type="button" variant="outline" onClick={() => {
                        setEditingContentId(null);
                        setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0, parentId: null });
                      }}>
                        Abbrechen
                      </Button>
                      <Button type="submit">
                        Aktualisieren
                      </Button>
                    </div>
                  </form>
                </div>
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
            </div>
          </DndContext>
        </main>
      </div>
    </div>
  );
}
