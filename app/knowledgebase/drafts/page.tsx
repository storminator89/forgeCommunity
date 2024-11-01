'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Loader2, 
  Edit, 
  Trash2, 
  BookOpen, 
  Plus, 
  FileText,
  Calendar,
  Tag,
  Search
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/utils";
import { toast } from 'sonner';
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Draft {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  featuredImage: string | null;
  content: string; // Hinzufügen für Vorschau
}

export default function DraftsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');

  useEffect(() => {
    const fetchDrafts = async () => {
      try {
        const response = await fetch('/api/articles/drafts');
        if (response.ok) {
          const data = await response.json();
          setDrafts(data);
        }
      } catch (error) {
        toast.error('Fehler beim Laden der Entwürfe');
      } finally {
        setIsLoading(false);
      }
    };

    if (session) {
      fetchDrafts();
    }
  }, [session]);

  const handleDelete = async (id: string) => {
    setActionInProgress(id);
    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setDrafts(drafts.filter(draft => draft.id !== id));
        toast.success('Entwurf wurde gelöscht');
      } else {
        throw new Error('Fehler beim Löschen');
      }
    } catch (error) {
      toast.error('Fehler beim Löschen des Entwurfs');
    } finally {
      setActionInProgress(null);
      setShowDeleteDialog(false);
    }
  };

  const filteredAndSortedDrafts = drafts
    .filter(draft => 
      draft.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      draft.category.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'oldest':
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

  const LoadingSkeleton = () => (
    <div className="space-y-6">
      {[1, 2, 3].map((n) => (
        <Card key={n}>
          <CardHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );

  const EmptyState = () => (
    <Card className="text-center p-12">
      <div className="flex flex-col items-center gap-4">
        <FileText className="h-12 w-12 text-gray-400" />
        <CardTitle>Keine Entwürfe vorhanden</CardTitle>
        <CardDescription>
          Erstellen Sie Ihren ersten Artikel-Entwurf, um ihn später zu veröffentlichen.
        </CardDescription>
        <Button
          onClick={() => router.push('/knowledgebase/new-article')}
          className="mt-4"
        >
          <Plus className="mr-2 h-4 w-4" />
          Neuen Artikel erstellen
        </Button>
      </div>
    </Card>
  );

  const pageVariants = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 }
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center">
                  <BookOpen className="mr-2 h-6 w-6" />
                  Meine Entwürfe
                </h2>
                {!isLoading && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {drafts.length} {drafts.length === 1 ? 'Entwurf' : 'Entwürfe'} gespeichert
                  </p>
                )}
              </div>
              <div className="flex items-center space-x-4">
                <Button
                  onClick={() => router.push('/knowledgebase/new-article')}
                  className="shadow-sm"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Neuer Artikel
                </Button>
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </div>
        </header>

        <div className="bg-white/50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  type="search"
                  placeholder="Entwürfe durchsuchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Sortieren
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Sortieren nach</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSortBy('newest')}>
                    Neueste zuerst
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('oldest')}>
                    Älteste zuerst
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('title')}>
                    Titel A-Z
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <motion.div 
            className="max-w-5xl mx-auto"
            initial="initial"
            animate="animate"
            exit="exit"
            variants={pageVariants}
          >
            {isLoading ? (
              <LoadingSkeleton />
            ) : filteredAndSortedDrafts.length === 0 ? (
              searchQuery ? (
                <Card className="text-center p-12">
                  <div className="flex flex-col items-center gap-4">
                    <Search className="h-12 w-12 text-gray-400" />
                    <CardTitle>Keine Ergebnisse gefunden</CardTitle>
                    <CardDescription>
                      Keine Entwürfe gefunden für "{searchQuery}"
                    </CardDescription>
                  </div>
                </Card>
              ) : (
                <EmptyState />
              )
            ) : (
              <div className="grid gap-6">
                {filteredAndSortedDrafts.map((draft, index) => (
                  <motion.div
                    key={draft.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className="group hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1">
                      <CardHeader>
                        <div className="flex justify-between items-start gap-4">
                          <div className="space-y-1.5 flex-1">
                            <CardTitle className="group-hover:text-blue-600 transition-colors line-clamp-2">
                              {draft.title}
                            </CardTitle>
                            <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                              <Calendar className="h-4 w-4 flex-shrink-0" />
                              <span>Zuletzt bearbeitet: {formatDate(draft.updatedAt)}</span>
                            </div>
                          </div>
                          {draft.featuredImage && (
                            <div className="w-20 h-20 rounded-md overflow-hidden flex-shrink-0">
                              <img 
                                src={draft.featuredImage} 
                                alt={draft.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center space-x-2">
                          <Tag className="h-4 w-4 text-gray-500" />
                          <Badge variant="secondary">{draft.category}</Badge>
                        </div>
                        {draft.content && (
                          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                            {draft.content.replace(/<[^>]*>/g, '')}
                          </p>
                        )}
                      </CardContent>
                      <CardFooter className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/knowledgebase/edit/${draft.id}`)}
                          disabled={!!actionInProgress}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Bearbeiten
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setDeletingId(draft.id);
                            setShowDeleteDialog(true);
                          }}
                          disabled={!!actionInProgress}
                        >
                          {actionInProgress === draft.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 mr-2" />
                          )}
                          Löschen
                        </Button>
                      </CardFooter>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </main>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Entwurf löschen</AlertDialogTitle>
              <AlertDialogDescription>
                Möchten Sie diesen Entwurf wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deletingId && handleDelete(deletingId)}
                className="bg-red-600 hover:bg-red-700"
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
