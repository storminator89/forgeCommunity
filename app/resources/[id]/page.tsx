'use client';

// Erweitere die Imports
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useCallback, useEffectEvent, useRef } from 'react';
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
import { getSafeNavigationUrl } from '@/lib/security';

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
  const resourceId = typeof params.id === 'string' ? params.id : params.id?.[0];
  const [resource, setResource] = useState<Resource | null>(null);
  const safeResourceUrl = getSafeNavigationUrl(resource?.url);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  const fetchResource = useCallback(async (
    id: string,
    signal: AbortSignal,
    requestId: number,
  ) => {
    try {
      const response = await axios.get(`/api/resources/${id}`, { signal });

      if (signal.aborted || requestIdRef.current !== requestId) return;
      setResource(response.data);
      setLoadedForId(id);
    } catch (error) {
      if (signal.aborted || requestIdRef.current !== requestId) return;
      console.error('Fehler beim Laden der Ressource:', error);
      toast.error('Ressource konnte nicht geladen werden.');
      setResource(null);
      setLoadedForId(id);
    } finally {
      if (!signal.aborted && requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const startResourceFetch = useEffectEvent(() => {
    if (!resourceId) return;

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    void fetchResource(resourceId, controller.signal, requestId);
  });

  useEffect(() => {
    startResourceFetch();

    return () => {
      activeControllerRef.current?.abort();
      requestIdRef.current += 1;
    };
  }, [resourceId]);

  const getIcon = (type: ResourceType) => {
    const iconClass = "h-6 w-6 shrink-0 text-primary";
    switch (type) {
      case 'ARTICLE': return <File className={iconClass} />;
      case 'VIDEO': return <Video className={iconClass} />;
      case 'EBOOK': return <Book className={iconClass} />;
      default: return <Link className={iconClass} />;
    }
  };

  return (
    <AppShell>
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">

              <Button
                variant="ghost"
                onClick={() => router.push('/resources')}
                className="flex items-center"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zurück zur Übersicht
              </Button>
            </div>
            <div className="flex min-w-0 items-start gap-3">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Loading State */}
          {(loading || loadedForId !== resourceId) && (
            <div className="flex justify-center items-center h-[calc(100vh-4rem)]">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
          )}

          {/* Error State */}
          {loadedForId === resourceId && !loading && !resource && (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
              <div className="text-center space-y-4">
                <h1 className="text-3xl font-bold text-foreground">
                  Ressource nicht gefunden
                </h1>
                <p className="text-muted-foreground">
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
          {loadedForId === resourceId && !loading && resource && (
            <main id="page-content" tabIndex={-1} className="w-full min-h-0 flex-1 overflow-y-auto mx-auto px-4 py-8">
              <ToastContainer />
              <Card className="max-w-4xl mx-auto overflow-hidden shadow-sm">
                <CardHeader className="border-b border-border bg-muted/40 p-5 sm:p-8">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {getIcon(resource.type)}
                      <h1 className="break-words text-2xl sm:text-3xl font-bold text-foreground">{resource.title}</h1>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label="Teilen" variant="ghost" size="icon" className="shrink-0 text-foreground">
                          <Share2 className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(window.location.href);
                            toast.success('Link kopiert!');
                          } catch {
                            toast.error('Der Link konnte nicht kopiert werden.');
                          }
                        }}>
                          Link kopieren
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>

                <CardContent className="p-5 sm:p-8">
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <h2 className="text-sm font-medium text-muted-foreground">
                            Kategorie
                          </h2>
                          <p className="mt-1 break-words text-lg font-medium text-foreground">
                            {resource.category}
                          </p>
                        </div>
                        <div>
                          <h2 className="text-sm font-medium text-muted-foreground">
                            Typ
                          </h2>
                          <p className="mt-1 break-words text-lg font-medium text-foreground">
                            {resource.type}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <h2 className="text-sm font-medium text-muted-foreground">
                            Autor
                          </h2>
                          <p className="mt-1 break-words text-lg font-medium text-foreground">
                            {resource.author.name || resource.author.email}
                          </p>
                        </div>
                        <div>
                          <h2 className="text-sm font-medium text-muted-foreground">
                            Erstellt am
                          </h2>
                          <p className="mt-1 break-words text-lg font-medium text-foreground">
                            {new Date(resource.createdAt).toLocaleDateString('de-DE')}
                          </p>
                        </div>
                      </div>
                    </div>

                    {safeResourceUrl && <div className="pt-6">
                      <Button
                        className="w-full h-12 text-lg"
                        onClick={() => window.open(safeResourceUrl, '_blank', 'noopener,noreferrer')}
                      >
                        <ExternalLink className="mr-2 h-5 w-5" />
                        Ressource öffnen
                      </Button>
                    </div>}
                  </div>
                </CardContent>
              </Card>
            </main>
          )}
        </div>
      </div>
    </AppShell>
  );
}
