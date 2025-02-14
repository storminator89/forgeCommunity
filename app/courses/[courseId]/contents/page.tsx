'use client'

import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
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
import { markPageAsVisited } from './utils/visitedPages'
import { ChevronLeft, ChevronRight, Edit, FileText, Video, Music, Box } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function CourseContentsPage({ params }: { params: { courseId: string } }) {
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
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [course, setCourse] = useState<{ id: string; name: string } | null>(null);
  const [forceUpdateValue, setForceUpdateValue] = useState(0);
  const [newMainContentTitle, setNewMainContentTitle] = useState("");
  const [currentMainContentId, setCurrentMainContentId] = useState<string | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Fetch course data
  const fetchCourse = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/courses/${params.courseId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch course');
      }
      const data = await response.json();
      setCourse(data);
    } catch (error) {
      console.error('Error fetching course:', error);
      setAlertMessage({
        type: 'error',
        message: 'Failed to load course information',
      });
    } finally {
      setIsLoading(false);
    }
  }, [params.courseId]);

  useEffect(() => {
    fetchCourse();
  }, [fetchCourse]);

  // Utility function to find content by ID
  const findContentById = useCallback((contentId: string, contentsToSearch: CourseContent[]): CourseContent | null => {
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
  }, []);

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
  }, [findContentById]);

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
      if (!response.ok) {
        throw new Error('Failed to fetch contents');
      }
      const data = await response.json();
      setMainContents(data);
    } catch (error) {
      console.error('Error fetching contents:', error);
      setAlertMessage({
        type: 'error',
        message: 'Failed to load course contents. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [params.courseId]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchContents();
    }
  }, [status, fetchContents]);

  useEffect(() => {
    fetchContents();
  }, [fetchContents]);

  // Add this to your existing useEffect block or create a new one
  useEffect(() => {
    const expandTopicForSelectedContent = () => {
      if (selectedContentId) {
        const content = findContentById(selectedContentId, mainContents);
        if (content?.parentId) {
          setExpandedTopics(prev => new Set([...prev, content.parentId]));
        }
      }
    };

    expandTopicForSelectedContent();
  }, [selectedContentId, mainContents, findContentById]);

  // Handler zum Hinzufügen eines neuen Hauptthemas
  const handleMainContentSubmit = useCallback(async (title: string) => {
    if (!title.trim()) return;
    
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents`, {
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
  }, [params.courseId]);

  // Handler zum Hinzufügen eines neuen Unterthemas
  const handleContentSubmit = useCallback(async (title: string) => {
    if (!isAddingSubContent || typeof isAddingSubContent !== 'string') return;
    // Show type selector only for subtopics
    setNewMainContentTitle(title);
  }, [isAddingSubContent]);

  // Handler for content type selection
  const handleTypeSelection = useCallback(async (selectedType: 'TEXT' | 'VIDEO' | 'AUDIO') => {
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents`, {
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
  }, [params.courseId, mainContents, newMainContentTitle, isAddingSubContent]);

  const handleSubContentSubmit = useCallback(async (title: string) => {
    if (!currentMainContentId) return;
    
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents`, {
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

      setForceUpdateValue(prev => prev + 1);
      
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
  }, [params.courseId, currentMainContentId]);

  // Handler zum Aktualisieren eines Inhalts (Hauptthema oder Unterthema)
  const handleContentUpdate = useCallback(async (updatedContent: CourseContent) => {
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents/${updatedContent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedContent),
      });

      if (!response.ok) {
        throw new Error('Failed to update content');
      }

      const updatedData = await response.json();
      
      // Aktualisiere den State mit dem aktualisierten Inhalt
      setMainContents(prev =>
        prev.map(content => {
          if (content.id === updatedContent.id) {
            return updatedData;
          }
          if (content.subContents) {
            return {
              ...content,
              subContents: content.subContents.map(sub =>
                sub.id === updatedContent.id ? updatedData : sub
              ),
            };
          }
          return content;
        })
      );

      setIsEditing(false);
      setEditingContentId(null);
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
    }
  }, [params.courseId]);

  // Handler zum Initiieren des Löschvorgangs
  const handleDeleteContent = useCallback(async (content: CourseContent) => {
    try {
      // Sofortige lokale State-Aktualisierung für bessere UX
      setMainContents(prev => {
        // Kopie des States erstellen
        const newContents = [...prev];
        
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
      const response = await fetch(`/api/courses/${params.courseId}/contents/${content.id}`, {
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
  }, [params.courseId, selectedContentId, fetchContents]);

  // Handler zum Bestätigen des Löschvorgangs
  const confirmDeleteContent = useCallback(async () => {
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
  }, [params.courseId, mainContents, selectedContentId]);

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
  }, [params.courseId, mainContents]);

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
  }, [params.courseId, mainContents]);

  // Handler zum Bearbeiten eines Inhalts
  const handleEditContent = useCallback((content: CourseContent) => {
    setSelectedContentId(content.id);
    setEditingContentId(content.id);
  }, []);

  // Handler for inline title editing
  const handleInlineEditSubmit = useCallback(async (contentId: string, newTitle: string) => {
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents/${contentId}`, {
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
  }, [params.courseId, mainContents]);

  const handleContentSelect = useCallback((contentId: string) => {
    setSelectedContentId(contentId);
    
    // Mark as visited if it's not null
    if (contentId) {
      markPageAsVisited(params.courseId, contentId);
    }
    
    // Find the selected content
    const content = findContentById(contentId, mainContents);
    
    // If content is empty, automatically enter edit mode
    if (content && (!content.content || content.content.trim() === '')) {
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
  }, [params.courseId, mainContents, findContentById]);

  const handleContentDrop = async (draggedId: string, targetId: string, position: "before" | "after" | "inside") => {
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents/${draggedId}/move`, {
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

  const handleVisitedToggle = async (contentId: string) => {
    // Update local state
    setMainContents(prevContents => {
      const newContents = [...prevContents];
      const content = findContentById(newContents, contentId);
      if (content) {
        content.completed = !content.completed;
      }
      return newContents;
    });

    // Force sidebar to update
    setForceUpdateValue(prev => prev + 1);
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
  if (status === 'loading' || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin h-8 w-8 text-gray-500" />
      </div>
    );
  }

  // Redirect if not authenticated
  if (status === "unauthenticated") {
    router.push('/auth/signin');
    return null;
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-gradient-to-br from-background via-background/95 to-accent/10 dark:from-gray-900 dark:via-gray-900/95 dark:to-gray-800/10 transition-all duration-300">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-background/80 dark:bg-gray-800/80 backdrop-blur-lg border-b border-border/40 shadow-sm sticky top-0 z-40 transition-colors duration-300">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent transition-colors duration-300">{course?.name}</h2>
              <div className="hidden sm:flex items-center">
                <span className="text-xs text-primary/90">•</span>
                <span className="ml-2 text-sm font-semibold text-primary">Kursinhalt</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="flex h-full">
            <div 
              className="relative transition-all duration-300 ease-in-out"
              style={{ width: isTopicsSidebarOpen ? `${sidebarWidth}px` : '0px' }}
            >
              <div className="absolute -right-4 top-4 z-50">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsTopicsSidebarOpen(!isTopicsSidebarOpen)}
                  className="bg-background dark:bg-gray-800 border border-primary/20 hover:border-primary/50 rounded-full shadow-sm hover:shadow-md transition-all duration-200 text-primary/80 hover:text-primary"
                >
                  {isTopicsSidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
              <div className={cn(
                "h-full overflow-hidden transition-all duration-300",
                isTopicsSidebarOpen ? "opacity-100 w-full" : "opacity-0 w-0"
              )}>
                <CourseContentsSidebar
                  contents={mainContents || []}
                  selectedContentId={selectedContentId}
                  onContentSelect={handleContentSelect}
                  onEditClick={handleEditContent}
                  onDeleteClick={handleDeleteContent}
                  isInlineEditing={isInlineEditing}
                  inlineEditTitle={inlineEditTitle}
                  onInlineEditSubmit={handleInlineEditSubmit}
                  setIsInlineEditing={setIsInlineEditing}
                  setInlineEditTitle={setInlineEditTitle}
                  onMoveUp={handleMoveSubContentUp}
                  onMoveDown={handleMoveSubContentDown}
                  mainContentId={currentMainContentId}
                  mainTopicIndex={null}
                  courseId={params.courseId}
                  courseName={course?.name || ''}
                  isLoading={isLoading}
                  forceUpdate={forceUpdateValue}
                  onVisitedToggle={handleVisitedToggle}
                  onSubContentSubmit={handleSubContentSubmit}
                  onMainContentSelect={setCurrentMainContentId}
                />
              </div>
              <div
                className="absolute top-0 right-0 h-full w-2 cursor-col-resize bg-transparent"
                onMouseDown={startResizing}
              />
            </div>
            
            <div className={cn(
              "flex-1 overflow-y-auto transition-all duration-300 ease-in-out",
              !isTopicsSidebarOpen && "px-4 md:px-8 lg:px-12"
            )}>
              <div className={cn(
                "h-full transition-all duration-300 ease-in-out",
                !isTopicsSidebarOpen ? "max-w-4xl mx-auto" : "max-w-full"
              )}>
                {selectedMainContent ? (
                  <div className={cn(
                    "w-full transition-all duration-300 ease-in-out",
                    isTopicsSidebarOpen ? "px-6 py-6" : "px-0 py-6"
                  )}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-card to-card/80 rounded-xl border border-border/50 shadow-sm p-6 mb-6 relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/3 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                      <div className="relative space-y-1.5">
                        <div className="flex items-center gap-2">
                          <h1 className="text-2xl font-semibold tracking-tight">
                            {selectedMainContent.title}
                          </h1>
                        </div>
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 bg-gradient-to-r from-primary/10 to-primary/5 text-primary px-3 py-1 rounded-full text-xs font-medium">
                            {selectedMainContent.type === 'TEXT' && (
                              <>
                                <FileText className="h-3.5 w-3.5" />
                                Textinhalt
                              </>
                            )}
                            {selectedMainContent.type === 'VIDEO' && (
                              <>
                                <Video className="h-3.5 w-3.5" />
                                Videoinhalt
                              </>
                            )}
                            {selectedMainContent.type === 'AUDIO' && (
                              <>
                                <Music className="h-3.5 w-3.5" />
                                Audioinhalt
                              </>
                            )}
                            {selectedMainContent.type === 'H5P' && (
                              <>
                                <Box className="h-3.5 w-3.5" />
                                Interaktiver Inhalt
                              </>
                            )}
                          </span>
                          <span className="text-xs">•</span>
                          <span>Lerninhalt</span>
                        </p>
                      </div>
                      <div className="relative flex items-center gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingContentId(selectedMainContent.id);
                            setIsEditing(true);
                          }}
                          className="group/btn bg-background/50 hover:bg-primary/5 hover:text-primary border-border/50 transition-all duration-200"
                        >
                          <Edit className="h-4 w-4 mr-2 transition-transform duration-200 group-hover/btn:scale-110" />
                          <span>Bearbeiten</span>
                        </Button>
                      </div>
                    </div>

                    <div className="relative">
                      {isEditing && editingContentId === selectedMainContent.id ? (
                        <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden backdrop-blur-sm">
                          <EditContentForm
                            content={selectedMainContent}
                            onSubmit={handleContentUpdate}
                            onContentChange={(updatedContent) => {
                              const newContent = {
                                ...selectedMainContent,
                                ...updatedContent
                              };
                              
                              setMainContents(prev =>
                                prev.map(content => {
                                  if (content.id === selectedMainContent.id) {
                                    return newContent;
                                  }
                                  if (content.subContents) {
                                    return {
                                      ...content,
                                      subContents: content.subContents.map(sub =>
                                        sub.id === selectedMainContent.id ? newContent : sub
                                      ),
                                    };
                                  }
                                  return content;
                                })
                              );
                            }}
                            onCancel={() => {
                              setEditingContentId(null);
                              setIsEditing(false);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden backdrop-blur-sm">
                          <ContentRenderer content={selectedMainContent} />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center space-y-4 max-w-md mx-auto p-8">
                      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-muted/80 to-muted/50 flex items-center justify-center mx-auto mb-6 shadow-sm">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                      </div>
                      <h2 className="text-2xl font-semibold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                        Wählen Sie einen Inhalt aus
                      </h2>
                      <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
                        Wählen Sie einen Inhalt aus der Seitenleiste aus, um ihn anzuzeigen. Sie können die Inhalte bearbeiten und neu anordnen.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
