'use client';

// Erweitere die Imports
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ThemeToggle } from "@/components/theme-toggle";
import { UserNav } from "@/components/user-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Book, File, Video, Link, ArrowLeft, Share2, ExternalLink, Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import axios from 'axios';
import { ResourceType } from '@prisma/client';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Sidebar } from "@/components/Sidebar";

interface Resource {
  id: string;
  title: string;
  type: ResourceType;
  category: string;
  author: {
    id: string;
    name: string | null;
    email: string;
  };
  url: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export default function ResourcePage() {
  const params = useParams();
  const router = useRouter();
  const [resource, setResource] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetchResource();
  }, []);

  const fetchResource = async () => {
    try {
      const response = await axios.get(`/api/resources/${params.id}`);
      setResource(response.data);
    } catch (error) {
      console.error('Fehler beim Laden der Ressource:', error);
      toast.error('Ressource konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type: ResourceType) => {
    const iconClass = "h-6 w-6 text-white";
    switch(type) {
      case 'ARTICLE': return <File className={iconClass} />;
      case 'VIDEO': return <Video className={iconClass} />;
      case 'EBOOK': return <Book className={iconClass} />;
      default: return <Link className={iconClass} />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              <Button 
                variant="ghost" 
                size="icon" 
                className="lg:hidden mr-2" 
                onClick={() => setIsSidebarOpen(true)}
              >
                <Menu className="h-6 w-6" />
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => router.push('/resources')}
                className="flex items-center"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zurück zur Übersicht
              </Button>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Loading State */}
          {loading && (
            <div className="flex justify-center items-center h-[calc(100vh-4rem)]">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
          )}

          {/* Error State */}
          {!loading && !resource && (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
              <div className="text-center space-y-4">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  Ressource nicht gefunden
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Die angeforderte Ressource existiert nicht oder wurde entfernt.
                </p>
                <Button onClick={() => router.push('/resources')} variant="default">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Zur Ressourcen-Übersicht
                </Button>
              </div>
            </div>
          )}

          {/* Resource Content */}
          {!loading && resource && (
            <main className="max-w-4xl mx-auto px-4 py-8">
              <ToastContainer />
              <Card className="overflow-hidden shadow-xl">
                <CardHeader className={`${resource.color} p-8`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {getIcon(resource.type)}
                      <h1 className="text-3xl font-bold text-white">{resource.title}</h1>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-white">
                          <Share2 className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => {
                          navigator.clipboard.writeText(window.location.href);
                          toast.success('Link kopiert!');
                        }}>
                          Link kopieren
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                
                <CardContent className="p-8">
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            Kategorie
                          </h2>
                          <p className="mt-1 text-lg font-medium text-gray-900 dark:text-gray-100">
                            {resource.category}
                          </p>
                        </div>
                        <div>
                          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            Typ
                          </h2>
                          <p className="mt-1 text-lg font-medium text-gray-900 dark:text-gray-100">
                            {resource.type}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            Autor
                          </h2>
                          <p className="mt-1 text-lg font-medium text-gray-900 dark:text-gray-100">
                            {resource.author.name || resource.author.email}
                          </p>
                        </div>
                        <div>
                          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            Erstellt am
                          </h2>
                          <p className="mt-1 text-lg font-medium text-gray-900 dark:text-gray-100">
                            {new Date(resource.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-6">
                      <Button 
                        className="w-full h-12 text-lg"
                        onClick={() => window.open(resource.url, '_blank')}
                      >
                        <ExternalLink className="mr-2 h-5 w-5" />
                        Ressource öffnen
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
