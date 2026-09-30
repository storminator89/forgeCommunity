'use client'

import { useCallback, useEffect, useState, useMemo, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import dynamic from 'next/dynamic'
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { CourseContentsSidebar } from './CourseContentsSidebar'
import { EditContentForm } from './EditContentForm'
import { ContentRenderer } from './ContentRenderer'
import { CourseContent } from './types'
import { courseRequestError, useCourseProgress } from './hooks/useCourseProgress'
import { CourseAccessManager, CourseDetails, CourseEnrollmentButton } from './components/CourseAccess'
import { ChevronLeft, ChevronRight, Edit, FileText, Video, Music, Box } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function findContentById(contentId: string, contentsToSearch: CourseContent[]): CourseContent | null {
  for (const content of contentsToSearch) {
    if (content.id === contentId) {
      return content;
    }
    if (content.subContents) {
      const found = findContentById(contentId, content.subContents);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export default function CourseContentsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  const { data: session } = useSession();
  return <CourseContentsState key={`${courseId}:${session?.user?.id || 'anonymous'}`} courseId={courseId} />;
}

function CourseContentsState({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mainContents, setMainContents] = useState<CourseContent[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [isTopicsSidebarOpen, setIsTopicsSidebarOpen] = useState(true);
  const [isAddingSubContent, setIsAddingSubContent] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; content: CourseContent | null }>({ open: false, content: null });
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isInlineEditing, setIsInlineEditing] = useState<string | null>(null);
  const [inlineEditTitle, setInlineEditTitle] = useState('');
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [loadedContentsCourseId, setLoadedContentsCourseId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [course, setCourse] = useState<CourseDetails | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [newMainContentTitle, setNewMainContentTitle] = useState("");
  const [currentMainContentId, setCurrentMainContentId] = useState<string | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [loadedCourseId, setLoadedCourseId] = useState<string | null>(null);
  const courseController = useRef<AbortController | null>(null);
  const canManage = !!course?.canManage;
  const hasAccess = !!course?.hasAccess;
  const { progress, isLoading: progressLoading, error: progressError, savingContentId, refresh: refreshProgress, setCompleted } = useCourseProgress(courseId, status === 'authenticated' && !!course?.enrollment);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const loadCourse = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/courses/${courseId}`, { signal });
    if (!response.ok) {
      throw await courseRequestError(response, 'Kursinformationen konnten nicht geladen werden.');
    }
    return response.json() as Promise<CourseDetails>;
  }, [courseId]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const controller = new AbortController();
    courseController.current = controller;
    void loadCourse(controller.signal)
      .then(data => {
        if (!controller.signal.aborted) {
          setCourse(data);
          setLoadedCourseId(courseId);
        }
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.error('Error fetching course:', error);
        setCourse(null);
        setLoadedCourseId(courseId);
        setAlertMessage({
          type: 'error',
          message: 'Failed to load course information',
        });
      });

    return () => controller.abort();
  }, [courseId, loadCourse, status, loadVersion]);

  const refreshCourse = useCallback(async () => {
    courseController.current?.abort();
    const controller = new AbortController();
    courseController.current = controller;
    const data = await loadCourse(controller.signal);
    if (!controller.signal.aborted) {
      setCourse(data);
      setLoadedCourseId(courseId);
    }
  }, [courseId, loadCourse]);

  useEffect(() => () => { courseController.current?.abort(); }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
  }, [status, router]);

  // Utility function to update content order
  const updateContentOrder = useCallback((
    contents: CourseContent[],
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' | 'inside'
  ): CourseContent[] => {
    const newContents = [...contents];
    const draggedContent = findContentById(draggedId, contents);
    const targetContent = findContentById(targetId, contents);

    if (!draggedContent || !targetContent) {
      return contents;
    }

    // Remove dragged content from its current position
    const removeFromParent = (parentContents: CourseContent[]) => {
      const index = parentContents.findIndex(c => c.id === draggedId);
      if (index !== -1) {
        parentContents.splice(index, 1);
        return true;
      }
      for (const content of parentContents) {
        if (content.subContents && removeFromParent(content.subContents)) {
          return true;
        }
      }
      return false;
    };

    removeFromParent(newContents);

    // Add dragged content to new position
    const addToTarget = () => {
      if (position === 'inside' && targetContent) {
        if (!targetContent.subContents) {
          targetContent.subContents = [];
        }
        targetContent.subContents.push({ ...draggedContent, parentId: targetContent.id });
        return;
      }

      const addToParent = (parentContents: CourseContent[]) => {
        const targetIndex = parentContents.findIndex(c => c.id === targetId);
        if (targetIndex !== -1) {
          const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
          parentContents.splice(insertIndex, 0, { ...draggedContent, parentId: targetContent.parentId });
          return true;
        }
        for (const content of parentContents) {
          if (content.subContents && addToParent(content.subContents)) {
            return true;
          }
        }
        return false;
      };

      addToParent(newContents);
    };

    addToTarget();
    return newContents;
  }, []);

  // Finden des ausgewählten Inhalts basierend auf selectedContentId
  const selectedMainContent = useMemo(() => {
    const currentContents = loadedContentsCourseId === courseId ? mainContents : [];
    return selectedContentId ? findContentById(selectedContentId, currentContents) : null;
  }, [courseId, loadedContentsCourseId, mainContents, selectedContentId]);

  const currentContents = useMemo(
    () => loadedContentsCourseId === courseId ? mainContents : [],
    [courseId, loadedContentsCourseId, mainContents]
  );

  const startResizing = (e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.pageX;
    startWidth.current = sidebarWidth;
    setIsResizingSidebar(true);
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = e.pageX - startX.current;
      const newWidth = Math.max(200, Math.min(500, startWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const stopResizing = () => {
      isResizing.current = false;
      setIsResizingSidebar(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingSidebar]);

  const loadContents = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/courses/${courseId}/contents`, { signal });
    if (!response.ok) {
      throw new Error('Failed to fetch contents');
    }
    return response.json() as Promise<CourseContent[]>;
  }, [courseId]);

  const fetchContents = useCallback(async () => {
    try {
      const data = await loadContents(new AbortController().signal);
      setMainContents(data);
      setLoadedContentsCourseId(courseId);
    } catch (error) {
      console.error('Error fetching contents:', error);
      setAlertMessage({
        type: 'error',
        message: 'Failed to load course contents. Please try again.',
      });
      setLoadedContentsCourseId(courseId);
    }
  }, [courseId, loadContents]);

  useEffect(() => {
    if (status !== 'authenticated' || !hasAccess) return;

    const controller = new AbortController();
    void loadContents(controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setMainContents(data);
        setLoadedContentsCourseId(courseId);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.error('Error fetching contents:', error);
        setAlertMessage({
          type: 'error',
          message: 'Failed to load course contents. Please try again.',
        });
        setMainContents([]);
        setLoadedContentsCourseId(courseId);
      });

    return () => controller.abort();
  }, [courseId, loadContents, status, hasAccess, loadVersion]);

  // Add this to your existing useEffect block or create a new one
  useEffect(() => {
    const expandTopicForSelectedContent = () => {
      if (selectedContentId) {
        const content = findContentById(selectedContentId, currentContents);
        if (content?.parentId) {
          const parentId = content.parentId;
          setExpandedTopics(prev => {
            const next = new Set(prev);
            next.add(parentId);
            return next;
          });
        }
      }
    };

    expandTopicForSelectedContent();
  }, [selectedContentId, currentContents]);

  // Handler zum Hinzufügen eines neuen Hauptthemas
  const handleMainContentSubmit = useCallback(async (title: string) => {
    if (!title.trim()) return;

    try {
      const response = await fetch(`/api/courses/${courseId}/contents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          type: 'TEXT', // Default type for main topics
          content: '',
          parentId: null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create main content');
      }

      const newContent = await response.json();

      // Update local state
      setMainContents(prev => [...prev, newContent]);
      setNewMainContentTitle('');

      void refreshProgress();
      setAlertMessage({
        type: 'success',
        message: 'Hauptthema erfolgreich erstellt.',
      });
    } catch (error) {
      console.error('Error creating main content:', error);
      setAlertMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to create main content.',
      });
    }
  }, [courseId, refreshProgress]);

  // Handler zum Hinzufügen eines neuen Unterthemas
  const handleContentSubmit = useCallback(async (title: string) => {
    if (!isAddingSubContent || typeof isAddingSubContent !== 'string') return;
    // Show type selector only for subtopics
    setNewMainContentTitle(title);
  }, [isAddingSubContent]);

  // Handler for content type selection
  const handleTypeSelection = useCallback(async (selectedType: 'TEXT' | 'VIDEO' | 'AUDIO') => {
    try {
      const response = await fetch(`/api/courses/${courseId}/contents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: newMainContentTitle,
          type: selectedType,
          content: '',
          parentId: isAddingSubContent,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create content');
      }

      const newContent = await response.json();
      setMainContents(prev => {
        if (isAddingSubContent) {
          return prev.map(content =>
            content.id === isAddingSubContent
              ? {
                ...content,
                subContents: [...(content.subContents || []), newContent],
              }
              : content
          );
        } else {
          return [...prev, newContent];
        }
      });

      setNewMainContentTitle('');
      setIsAddingSubContent(null);
      void refreshProgress();
      setAlertMessage({
        type: 'success',
        message: 'Content created successfully.',
      });
    } catch (error) {
      console.error('Error creating content:', error);
      setAlertMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to create content.',
      });
    }
  }, [courseId, newMainContentTitle, isAddingSubContent, refreshProgress]);

  const handleSubContentSubmit = useCallback(async (title: string) => {
    if (!currentMainContentId) return;

    try {
      const response = await fetch(`/api/courses/${courseId}/contents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          type: 'TEXT',
          content: '',
          parentId: currentMainContentId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create subcontent');
      }

      const newContent = await response.json();

      // Update the local state directly
      setMainContents(prev => prev.map(content => {
        if (content.id === currentMainContentId) {
          return {
            ...content,
            subContents: [...(content.subContents || []), newContent]
          };
        }
        return content;
      }));

      void refreshProgress();
      setAlertMessage({
        type: 'success',
        message: 'Unterthema erfolgreich erstellt',
      });

      return newContent;
    } catch (error) {
      console.error('Error creating subcontent:', error);
      setAlertMessage({
        type: 'error',
        message: 'Fehler beim Erstellen des Unterthemas',
      });
      throw error;
    }
  }, [courseId, currentMainContentId, refreshProgress]);

  // Handler zum Aktualisieren eines Inhalts (Hauptthema oder Unterthema)
  const handleContentUpdate = useCallback(async (updatedContent: CourseContent) => {
    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${updatedContent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...updatedContent, type: updatedContent.type === 'QUIZ' ? 'TEXT' : updatedContent.type }),
      });

      if (!response.ok) {
        throw new Error('Failed to update content');
      }

      const updatedData = await response.json();

      const replaceContent = (contents: CourseContent[]): CourseContent[] => contents.map(content =>
        content.id === updatedContent.id
          ? { ...content, ...updatedData, subContents: content.subContents }
          : { ...content, subContents: content.subContents ? replaceContent(content.subContents) : undefined }
      );
      setMainContents(replaceContent);

      setIsEditing(false);
      setEditingContentId(null);
      void refreshProgress();
      setAlertMessage({
        type: 'success',
        message: 'Inhalt erfolgreich aktualisiert.',
      });
    } catch (error) {
      console.error('Error updating content:', error);
      setAlertMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to update content.',
      });
      throw error;
    }
  }, [courseId, refreshProgress]);

  // Handler zum Initiieren des Löschvorgangs
  const handleDeleteContent = useCallback(async (content: CourseContent) => {
    try {
      // Sofortige lokale State-Aktualisierung für bessere UX
      setMainContents(prev => {
        // Kopie des States erstellen
        const newContents = [...prev];

        if (!content.parentId) {
          return newContents.filter(main => main.id !== content.id);
        }

        // Hauptthema finden, das das zu löschende Unterthema enthält
        const parentIndex = newContents.findIndex(main =>
          main.subContents?.some(sub => sub.id === content.id)
        );

        if (parentIndex !== -1) {
          // Unterthema aus dem subContents Array filtern
          newContents[parentIndex] = {
            ...newContents[parentIndex],
            subContents: newContents[parentIndex].subContents?.filter(
              sub => sub.id !== content.id
            ) || []
          };
        }

        return newContents;
      });

      // API-Aufruf zum Löschen
      const response = await fetch(`/api/courses/${courseId}/contents/${content.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete content');
        // Bei Fehler könnten wir hier den State wiederherstellen
      }

      // Selected Content zurücksetzen wenn das gelöschte Element ausgewählt war
      if (selectedContentId === content.id) {
        setSelectedContentId(null);
        setEditingContentId(null);
        setIsEditing(false);
      }

      void refreshProgress();
      setAlertMessage({
        type: 'success',
        message: 'Unterthema erfolgreich gelöscht'
      });

    } catch (error) {
      console.error('Error deleting content:', error);
      setAlertMessage({
        type: 'error',
        message: 'Fehler beim Löschen des Unterthemas'
      });

      // Optional: State wiederherstellen bei Fehler
      await fetchContents();
    }
  }, [courseId, selectedContentId, fetchContents, refreshProgress]);

  // Handler zum Bestätigen des Löschvorgangs
  const confirmDeleteContent = useCallback(async () => {
    const content = confirmDelete.content;
    if (!content) return;

    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${content.id}`, {
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
  }, [courseId, mainContents, selectedContentId, confirmDelete.content]);

  // Funktion zum Generieren des YouTube Embed Codes aus einer URL
  const getYouTubeEmbedUrl = useCallback((url: string) => {
    if (!url) return '';

    try {
      // Extract video ID from URL
      let videoId = '';

      if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1].split('?')[0];
      } else if (url.includes('youtube.com')) {
        const urlParams = new URLSearchParams(url.split('?')[1]);
        videoId = urlParams.get('v') || '';
      }

      if (videoId) {
        return `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      }
    } catch (error) {
      console.error('Error parsing YouTube URL:', error);
    }

    return url;
  }, []);

  // Funktion zum Abrufen des entsprechenden Icons basierend auf dem Typ
  const getContentTypeIcon = useCallback((type: string) => {
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
  }, []);

  // Handler zum Verschieben eines Unterthemas nach oben
  const handleMoveSubContentUp = useCallback(async (mainContentId: string, subContentId: string) => {
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
        fetch(`/api/courses/${courseId}/contents/${newSubContents[currentIndex].id}`, {
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
        fetch(`/api/courses/${courseId}/contents/${newSubContents[currentIndex - 1].id}`, {
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
  }, [courseId, mainContents]);

  // Handler zum Verschieben eines Unterthemas nach unten
  const handleMoveSubContentDown = useCallback(async (mainContentId: string, subContentId: string) => {
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
        fetch(`/api/courses/${courseId}/contents/${newSubContents[currentIndex].id}`, {
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
        fetch(`/api/courses/${courseId}/contents/${newSubContents[currentIndex + 1].id}`, {
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
  }, [courseId, mainContents]);

  // Handler zum Bearbeiten eines Inhalts
  const handleEditContent = useCallback((contentId: string) => {
    // Falls contentId ein Event ist (manchmal bei Fehlklicks), ignorieren oder behandeln
    if (typeof contentId !== 'string') return;

    setSelectedContentId(contentId);
    setEditingContentId(contentId);
  }, []);

  // Handler for inline title editing
  const handleInlineEditSubmit = useCallback(async (contentId: string, newTitle: string) => {
    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${contentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        throw new Error('Failed to update title');
      }

      // Update local state
      setMainContents(mainContents.map(content => {
        if (content.id === contentId) {
          return { ...content, title: newTitle };
        }
        if (content.subContents) {
          return {
            ...content,
            subContents: content.subContents.map(sub =>
              sub.id === contentId ? { ...sub, title: newTitle } : sub
            ),
          };
        }
        return content;
      }));

      setAlertMessage({ type: 'success', message: 'Titel erfolgreich aktualisiert.' });
    } catch (error) {
      console.error('Error updating title:', error);
      setAlertMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to update title.',
      });
    } finally {
      setIsInlineEditing(null);
      setInlineEditTitle('');
    }
  }, [courseId, mainContents]);

  const handleContentSelect = useCallback((contentId: string) => {
    setSelectedContentId(contentId);

    // Find the selected content
    const content = findContentById(contentId, mainContents);

    // If content is empty, automatically enter edit mode
    if (canManage && content && (!content.content || (typeof content.content === 'string' && content.content.trim() === ''))) {
      setEditingContentId(contentId);
      setIsEditing(true);
    } else {
      setEditingContentId(null);
      setIsEditing(false);
    }

    // Ensure parent topic is expanded when selecting content
    if (content?.parentId) {
      const parentContent = findContentById(content.parentId, mainContents);
      if (parentContent) {
        setExpandedTopics(prev => new Set([...prev, parentContent.id]));
      }
    }
  }, [canManage, mainContents]);

  const handleContentDrop = async (draggedId: string, targetId: string, position: "before" | "after" | "inside") => {
    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${draggedId}/move`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetId,
          position,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to move content');
      }

      // Aktualisiere die lokale State nach erfolgreicher API-Anfrage
      const updatedContents = await response.json();
      setMainContents(updatedContents);
    } catch (error) {
      console.error('Error moving content:', error);
      setAlertMessage({
        type: 'error',
        message: 'Fehler beim Verschieben des Inhalts.',
      });
    }
  };

  const handleVisitedToggle = (contentId: string) => {
    if (!progress || !progress.learningContentIds.includes(contentId)) return;
    void setCompleted(contentId, !progress.completedContentIds.includes(contentId));
  };

  // Add this function to handle topic expansion
  const toggleTopic = useCallback((topicId: string) => {
    setExpandedTopics(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(topicId)) {
        newExpanded.delete(topicId);
      } else {
        newExpanded.add(topicId);
      }
      return newExpanded;
    });
  }, []);

  // Loading indicator while fetching contents
  const isLoading = status === 'loading'
    || (status === 'authenticated' && (
      loadedCourseId !== courseId
      || (hasAccess && loadedContentsCourseId !== courseId)
    ));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin h-8 w-8 text-gray-500" />
      </div>
    );
  }

  // Redirect if not authenticated
  if (status === "unauthenticated") {
    return null;
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-background transition-all duration-300">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border sticky top-0 z-40">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-xl font-semibold text-foreground tracking-tight">{course?.name}</h2>
              <div className="hidden sm:flex items-center text-muted-foreground">
                <span className="text-xs mx-2">/</span>
                <span className="text-sm font-medium">Kursinhalt</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {canManage && <CourseAccessManager courseId={courseId} onAccessChanged={refreshCourse} />}
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          {alertMessage && <div className={`m-4 rounded border p-3 text-sm ${alertMessage.type === 'error' ? 'border-destructive text-destructive' : 'border-border'}`} role={alertMessage.type === 'error' ? 'alert' : 'status'}>
            {alertMessage.message}
            {alertMessage.type === 'error' && <Button variant="outline" size="sm" className="ml-3" onClick={() => { setAlertMessage(null); setLoadVersion(value => value + 1); }}>Erneut laden</Button>}
          </div>}
          {progressError && !isTopicsSidebarOpen && <div role="alert" className="m-4 rounded border border-destructive p-3 text-sm text-destructive">
            <p>{progressError}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void refreshProgress()} disabled={progressLoading || !!savingContentId}>Fortschritt erneut laden</Button>
          </div>}
          {!course ? <div className="p-8"><p>Kursinformationen sind nicht verfügbar.</p><Button variant="outline" className="mt-4" onClick={() => router.push('/courses')}>Zur Kursübersicht</Button></div> : !hasAccess ? <div className="max-w-2xl mx-auto p-8 space-y-6"><h1 className="text-2xl font-semibold">{course.name}</h1><p className="text-muted-foreground">{course.description}</p><CourseEnrollmentButton course={course} onEnrolled={refreshCourse} /><Button variant="outline" onClick={() => router.push('/courses')}>Zur Kursübersicht</Button></div> : <>
          {canManage && !course.enrollment && <div className="m-4 rounded border border-border p-4 space-y-2"><p className="text-sm">Sie sehen den Kurs als Kursleitung. Für persönlichen Lernfortschritt ist eine eigene Einschreibung erforderlich.</p><CourseEnrollmentButton course={course} onEnrolled={refreshCourse} /></div>}
          <div className="flex h-full">
            <div
              className="relative transition-all duration-300 ease-in-out border-r border-border bg-card/30"
              style={{ width: isTopicsSidebarOpen ? `${sidebarWidth}px` : '0px' }}
            >
              <div className="absolute -right-3 top-3 z-50">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsTopicsSidebarOpen(!isTopicsSidebarOpen)}
                  aria-label={isTopicsSidebarOpen ? 'Inhaltsverzeichnis ausblenden' : 'Inhaltsverzeichnis einblenden'}
                  aria-expanded={isTopicsSidebarOpen}
                  className="h-6 w-6 rounded-full shadow-sm bg-background border-border hover:bg-accent"
                >
                  {isTopicsSidebarOpen ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </Button>
              </div>
              <div aria-hidden={!isTopicsSidebarOpen} inert={!isTopicsSidebarOpen} className={cn(
                "h-full overflow-hidden transition-all duration-300",
                isTopicsSidebarOpen ? "opacity-100 w-full" : "opacity-0 w-0"
              )}>
                <CourseContentsSidebar
                  contents={currentContents}
                  selectedContentId={selectedContentId}
                  onContentSelect={handleContentSelect}
                  onEditClick={handleEditContent}
                  onDeleteClick={handleDeleteContent}
                  isInlineEditing={isInlineEditing}
                  inlineEditTitle={inlineEditTitle}
                  onInlineEditSubmit={handleInlineEditSubmit}
                  setIsInlineEditing={setIsInlineEditing}
                  setInlineEditTitle={setInlineEditTitle}
                  onMoveUp={(subContentId) => {
                    // Find parent
                    const parent = mainContents.find(m => m.subContents?.some(s => s.id === subContentId));
                    if (parent) handleMoveSubContentUp(parent.id, subContentId);
                  }}
                  onMoveDown={(subContentId) => {
                    const parent = mainContents.find(m => m.subContents?.some(s => s.id === subContentId));
                    if (parent) handleMoveSubContentDown(parent.id, subContentId);
                  }}
                  mainContentId={currentMainContentId}
                  mainTopicIndex={0}
                  courseId={courseId}
                  courseName={course?.name || ''}
                  isLoading={isLoading}
                  onMainContentSubmit={handleMainContentSubmit}
                  canManage={canManage}
                  progress={progress}
                  progressLoading={progressLoading}
                  progressError={progressError}
                  onProgressRetry={() => void refreshProgress()}
                  savingContentId={savingContentId}
                  onVisitedToggle={handleVisitedToggle}
                  onSubContentSubmit={handleSubContentSubmit}
                  onMainContentSelect={setCurrentMainContentId}
                />
              </div>
              <div
                className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-primary/20 transition-colors"
                onMouseDown={startResizing}
              />
            </div>

            <div className={cn(
              "flex-1 overflow-y-auto bg-background/50",
              !isTopicsSidebarOpen && "px-0"
            )}>
              <div className="h-full max-w-5xl mx-auto w-full">
                {selectedMainContent ? (
                  <div className="w-full px-6 py-8 md:px-10 lg:px-12">
                    <div className="mb-8 pb-6 border-b border-border/60">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                              {selectedMainContent.type === 'TEXT' && <FileText className="h-3 w-3" />}
                              {selectedMainContent.type === 'VIDEO' && <Video className="h-3 w-3" />}
                              {selectedMainContent.type === 'AUDIO' && <Music className="h-3 w-3" />}
                              {selectedMainContent.type === 'H5P' && <Box className="h-3 w-3" />}
                              <span className="capitalize">{selectedMainContent.type.toLowerCase()}</span>
                            </span>
                          </div>
                          <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            {selectedMainContent.title}
                          </h1>
                        </div>
                        {canManage && <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingContentId(selectedMainContent.id);
                            setIsEditing(true);
                          }}
                          className="h-8 text-muted-foreground hover:text-primary"
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          <span>Bearbeiten</span>
                        </Button>}
                      </div>
                    </div>

                    {!isEditing && progress?.learningContentIds.includes(selectedMainContent.id) && <div className="mb-6 space-y-2">
                      <Button variant={progress.completedContentIds.includes(selectedMainContent.id) ? 'secondary' : 'default'}
                        onClick={() => handleVisitedToggle(selectedMainContent.id)}
                        disabled={progressLoading || !!savingContentId || !!progress.enrollment.completedAt}
                        aria-pressed={progress.completedContentIds.includes(selectedMainContent.id)}>
                        {savingContentId === selectedMainContent.id ? 'Wird gespeichert...' : progress.completedContentIds.includes(selectedMainContent.id) ? 'Abgeschlossen' : 'Als abgeschlossen markieren'}
                      </Button>
                      <p className="text-xs text-muted-foreground">{progress.requiredContentIds.includes(selectedMainContent.id) ? 'Pflichtinhalt' : 'Optionaler Inhalt'} · {progress.enrollment.completedAt ? 'Ihr Kursabschluss wurde gespeichert.' : progress.completedContentIds.includes(selectedMainContent.id) ? 'Erneut klicken, um die Markierung zurückzunehmen.' : 'Bestätigen Sie hier, dass Sie diesen Inhalt bearbeitet haben.'}</p>
                    </div>}
                    <div className="relative min-h-[500px]">
                      {canManage && isEditing && editingContentId === selectedMainContent.id ? (
                        <div className="bg-card rounded-lg border border-border shadow-sm p-4 animate-in fade-in zoom-in-95 duration-200">
                          <EditContentForm
                            content={selectedMainContent}
                            onSubmit={handleContentUpdate}
                            key={selectedMainContent.id}
                            onContentChange={() => { /* Drafts stay in the form until saved. */ }}
                            onCancel={() => {
                              setEditingContentId(null);
                              setIsEditing(false);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                          <ContentRenderer content={selectedMainContent} />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-center p-8">
                    <div className="max-w-md space-y-4">
                      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                        <FileText className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">
                        Kein Inhalt ausgewählt
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        Wählen Sie ein Thema aus der Seitenleiste, um den Inhalt anzuzeigen.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          </>}
        </main>
      </div>
    </div>
  );
}
