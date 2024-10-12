'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { PlusCircle, X, Edit, Trash2, FileText, Video, Music, ChevronLeft, ChevronRight } from 'lucide-react';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

interface CourseContent {
  id: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO';
  content: string;
  order: number;
}

export default function CourseContentsPage({ params }: { params: { courseId: string } }) {
  const [contents, setContents] = useState<CourseContent[]>([]);
  const [newContent, setNewContent] = useState<CourseContent>({ id: '', title: '', type: 'TEXT', content: '', order: 0 });
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [selectedContent, setSelectedContent] = useState<CourseContent | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    }
  }, [status, router]);

  useEffect(() => {
    fetchContents();
  }, [params.courseId]);

  const fetchContents = async () => {
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents`);
      if (response.ok) {
        const data = await response.json();
        setContents(data);
        if (data.length > 0 && !selectedContent) {
          setSelectedContent(data[0]);
        }
      } else {
        throw new Error('Failed to fetch contents');
      }
    } catch (error) {
      console.error('Error fetching contents:', error);
      setMessage({ type: 'error', text: 'Failed to load course contents.' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let contentToSend = newContent.content;
      if (newContent.type === 'VIDEO') {
        contentToSend = getYouTubeEmbedUrl(newContent.content);
      }

      const method = newContent.id ? 'PUT' : 'POST';
      const url = newContent.id 
        ? `/api/courses/${params.courseId}/contents/${newContent.id}`
        : `/api/courses/${params.courseId}/contents`;

      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newContent,
          content: contentToSend,
          order: newContent.id ? newContent.order : contents.length + 1
        }),
      });

      if (response.ok) {
        setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0 });
        setMessage({ type: 'success', text: `Content ${newContent.id ? 'updated' : 'added'} successfully.` });
        fetchContents();
        setIsEditing(false);
      } else {
        throw new Error(`Failed to ${newContent.id ? 'update' : 'create'} content`);
      }
    } catch (error) {
      console.error(`Error ${newContent.id ? 'updating' : 'creating'} content:`, error);
      setMessage({ type: 'error', text: `Failed to ${newContent.id ? 'update' : 'add'} content.` });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/courses/${params.courseId}/contents/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setMessage({ type: 'success', text: 'Content deleted successfully.' });
        fetchContents();
        setSelectedContent(null);
      } else {
        throw new Error('Failed to delete content');
      }
    } catch (error) {
      console.error('Error deleting content:', error);
      setMessage({ type: 'error', text: 'Failed to delete content.' });
    }
  };

  const getYouTubeEmbedUrl = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      return `https://www.youtube.com/embed/${match[2]}`;
    }
    return url;
  };

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
              className="absolute top-0 left-0 w-full h-full"
            ></iframe>
          </div>
        );
      case 'AUDIO':
        return <audio src={content.content} controls className="w-full" />;
      default:
        return <p>{content.content}</p>;
    }
  };

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

  if (status === 'loading') {
    return <div>Loading...</div>;
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Kursinhalte</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-hidden flex">
          {/* Zeitstrahl */}
          <div className={`${isSidebarOpen ? 'w-1/4' : 'w-16'} bg-white dark:bg-gray-800 overflow-y-auto border-r border-gray-200 dark:border-gray-700 transition-all duration-300`}>
            <div className="p-4">
              {isSidebarOpen && <h3 className="text-lg font-semibold mb-4">Lernpfad</h3>}
              <ul className="space-y-2">
                {contents.map((content, index) => (
                  <li 
                    key={content.id} 
                    className={`p-2 rounded-md cursor-pointer flex justify-between items-center ${selectedContent?.id === content.id ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    onClick={() => setSelectedContent(content)}
                  >
                    <span className="flex items-center">
                      <span className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 flex items-center justify-center mr-2 text-sm font-medium">{index + 1}</span>
                      {isSidebarOpen && <span className="truncate">{content.title}</span>}
                    </span>
                    {isSidebarOpen && (
                      <span className="flex items-center space-x-2">
                        {getContentTypeIcon(content.type)}
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleDelete(content.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {isSidebarOpen && (
                <Button className="mt-4 w-full" onClick={() => { setIsEditing(true); setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0 }); setSelectedContent(null); }}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Neuer Inhalt
                </Button>
              )}
            </div>
          </div>

          {/* Toggle sidebar button */}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-white dark:bg-gray-800 p-2 rounded-r-md shadow-md"
          >
            {isSidebarOpen ? <ChevronLeft /> : <ChevronRight />}
          </button>

          {/* Hauptinhalt */}
          <div className="flex-1 p-6 overflow-y-auto">
            {message && (
              <div className={`p-4 rounded-md mb-4 ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {message.text}
              </div>
            )}
            
            {selectedContent && !isEditing && (
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                <h3 className="text-2xl font-bold mb-4">{selectedContent.title}</h3>
                <p className="text-sm text-gray-500 mb-4 flex items-center">
                  {getContentTypeIcon(selectedContent.type)}
                  <span className="ml-2">{selectedContent.type}</span>
                </p>
                {renderContent(selectedContent)}
                <div className="mt-4 flex space-x-2">
                  <Button onClick={() => { setIsEditing(true); setNewContent(selectedContent); }}>
                    <Edit className="mr-2 h-4 w-4" /> Bearbeiten
                  </Button>
                  <Button variant="destructive" onClick={() => handleDelete(selectedContent.id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Löschen
                  </Button>
                </div>
              </div>
            )}

            {isEditing && (
              <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
                <div>
                  <Label htmlFor="title">Titel</Label>
                  <Input
                    id="title"
                    value={newContent.title}
                    onChange={(e) => setNewContent({...newContent, title: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="type">Typ</Label>
                  <select
                    id="type"
                    value={newContent.type}
                    onChange={(e) => setNewContent({...newContent, type: e.target.value as 'TEXT' | 'VIDEO' | 'AUDIO'})}
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
                      onChange={(content) => setNewContent({...newContent, content})}
                      modules={{
                        toolbar: [
                          [{ 'header': [1, 2, false] }],
                          ['bold', 'italic', 'underline','strike', 'blockquote'],
                          [{'list': 'ordered'}, {'list': 'bullet'}, {'indent': '-1'}, {'indent': '+1'}],
                          ['link', 'image'],
                          ['clean']
                        ],
                      }}
                    />
                  ) : (
                    <Input
                      id="content"
                      value={newContent.content}
                      onChange={(e) => setNewContent({...newContent, content: e.target.value})}
                      placeholder={newContent.type === 'VIDEO' ? "YouTube URL" : "Audio URL"}
                      required
                    />
                  )}
                </div>
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => { setIsEditing(false); setNewContent({ id: '', title: '', type: 'TEXT', content: '', order: 0 }); }}>
                    <X className="mr-2 h-4 w-4" /> Abbrechen
                  </Button>
                  <Button type="submit">
                    <PlusCircle className="mr-2 h-4 w-4" /> {newContent.id ? 'Aktualisieren' : 'Hinzufügen'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}