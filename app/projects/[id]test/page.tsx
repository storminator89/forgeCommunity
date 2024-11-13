"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThumbsUp, MessageSquare, ExternalLink, Edit, Trash, ArrowLeft, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface Tag {
  id: string;
  name: string;
}

interface Like {
  userId: string;
}

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: {
    name?: string;
    image?: string;
  };
}

interface Project {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  link?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name?: string;
    image?: string;
  };
  tags: Tag[];
  likes: Like[];
  comments: Comment[];
}

const ProjectDetail = ({ params }: { params: { id: string } }) => {
  const { data: session } = useSession();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [commentContent, setCommentContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLike = async (projectId?: string) => {
    if (!projectId) return;
    // Implement like functionality
  };

  const handleEdit = (project?: Project) => {
    if (!project) return;
    router.push(`/projects/${project.id}/edit`);
  };

  const handleDelete = async (project?: Project) => {
    if (!project) return;
    if (window.confirm('Are you sure you want to delete this project?')) {
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete project');
        router.push('/showcases');
      } catch (error) {
        console.error('Error deleting project:', error);
      }
    }
  };

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await fetch(`/api/projects/${params.id}`);
        if (!res.ok) throw new Error('Project not found');
        const data = await res.json();
        setProject(data);
      } catch (error) {
        console.error('Error fetching project:', error);
        router.push('/showcases');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [params.id]);

  if (isLoading) {
    return (
      <div className="flex h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="animate-pulse">
            <div className="h-[500px] bg-gray-200 dark:bg-gray-700" />
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
                  <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
                </div>
                <div className="space-y-6">
                  <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
                  <div className="h-60 bg-gray-200 dark:bg-gray-700 rounded-2xl" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) return null;

  const handleAddComment = async (projectId: string) => {
    if (!commentContent.trim() || !projectId) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: commentContent,
        }),
      });

      if (!res.ok) throw new Error('Failed to add comment');
      
      const newComment = await res.json();
      setProject(prev => prev ? {
        ...prev,
        comments: [...prev.comments, newComment]
      } : null);
      setCommentContent('');
    } catch (error) {
      setError('Failed to add comment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Enhanced Header */}
        <header className="bg-white/80 backdrop-blur-md dark:bg-gray-800/80 shadow-lg z-10 sticky top-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-8">
                <Link 
                  href="/showcases" 
                  className="group flex items-center text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-all duration-200"
                >
                  <div className="relative w-8 h-8 mr-2 rounded-full bg-gray-100 dark:bg-gray-700 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 transition-colors duration-200 flex items-center justify-center">
                    <ArrowLeft className="h-5 w-5 transform group-hover:translate-x-[-2px] transition-transform duration-200" />
                  </div>
                  <span className="font-medium">Projekte</span>
                </Link>
                {project && (
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 hidden md:block">
                    {project.title}
                  </h1>
                )}
              </div>
              <div className="flex items-center space-x-4">
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {/* Enhanced Hero Section */}
          <div className="relative h-[500px] bg-gradient-to-br from-gray-900 to-gray-800">
            {project?.imageUrl ? (
              <>
                <div className="absolute inset-0 overflow-hidden">
                  <img
                    src={project.imageUrl}
                    alt={project.title}
                    className="w-full h-full object-cover transform scale-105 filter blur-sm opacity-40"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-transparent" />
                <div className="relative h-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center">
                  <div className="w-full md:w-2/3">
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                      className="space-y-6"
                    >
                      <div className="flex flex-wrap gap-2">
                        {project.tags.map((tag) => (
                          <Badge 
                            key={tag.id} 
                            className="bg-white/10 hover:bg-white/20 text-white transition-colors duration-200"
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                      <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
                        {project.title}
                      </h1>
                      <p className="text-xl text-gray-300 leading-relaxed max-w-2xl">
                        {project.description}
                      </p>
                      <div className="flex items-center space-x-6">
                        <div className="flex items-center">
                          <Avatar className="h-12 w-12 ring-4 ring-white/10">
                            <AvatarImage src={project.author.image || undefined} />
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500">
                              {project.author.name?.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="ml-3">
                            <p className="text-white font-medium">{project.author.name}</p>
                            <p className="text-gray-400 text-sm">
                              {new Date(project.createdAt).toLocaleDateString('de-DE', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900" />
                <div className="relative h-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center">
                  <div className="w-full md:w-2/3">
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                      className="space-y-6"
                    >
                      <div className="flex flex-wrap gap-2">
                        {project.tags.map((tag) => (
                          <Badge 
                            key={tag.id} 
                            className="bg-white/10 hover:bg-white/20 text-white transition-colors duration-200"
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                      <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
                        {project.title}
                      </h1>
                      <p className="text-xl text-gray-300 leading-relaxed max-w-2xl">
                        {project.description}
                      </p>
                      <div className="flex items-center space-x-6">
                        <div className="flex items-center">
                          <Avatar className="h-12 w-12 ring-4 ring-white/10">
                            <AvatarImage src={project.author.image || undefined} />
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500">
                              {project.author.name?.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="ml-3">
                            <p className="text-white font-medium">{project.author.name}</p>
                            <p className="text-gray-400 text-sm">
                              {new Date(project.createdAt).toLocaleDateString('de-DE', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric'
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Enhanced Content Section */}
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Main Content */}
              <div className="lg:col-span-2 space-y-8">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                  <div className="prose dark:prose-invert max-w-none">
                    <h2 className="text-2xl font-semibold mb-4">Über das Projekt</h2>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                      {project?.description}
                    </p>
                  </div>
                </div>

                {/* Comments Section */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                  <h2 className="text-2xl font-semibold mb-6 flex items-center">
                    <MessageSquare className="h-6 w-6 mr-2 text-blue-500" />
                    Kommentare
                    <motion.span
                      key={project?.comments.length}
                      initial={{ scale: 1 }}
                      animate={{ scale: [1, 1.2, 1] }}
                      className="ml-2 text-gray-400 text-sm font-normal"
                    >
                      ({project?.comments.length})
                    </motion.span>
                  </h2>
                  
                  {session && (
                    <div className="mb-8">
                      <Textarea
                        placeholder="Teile deine Gedanken zum Projekt..."
                        value={commentContent}
                        onChange={(e) => setCommentContent(e.target.value)}
                        className="min-h-[120px] mb-4 resize-none focus:ring-2 focus:ring-blue-500 transition-shadow duration-200"
                        disabled={isSubmitting}
                      />
                      {error && (
                        <p className="text-red-500 text-sm mb-2">{error}</p>
                      )}
                      <Button 
                        onClick={() => handleAddComment(project?.id)}
                        className="bg-blue-500 hover:bg-blue-600 transition-all duration-200"
                        disabled={isSubmitting || !commentContent.trim()}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Wird hinzugefügt...
                          </>
                        ) : (
                          'Kommentar hinzufügen'
                        )}
                      </Button>
                    </div>
                  )}

                  <div className="space-y-6">
                    {project?.comments.map((comment, index) => (
                      <motion.div
                        key={comment.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 transition-all duration-200 hover:shadow-md hover:bg-gray-100 dark:hover:bg-gray-700/70"
                      >
                        <div className="flex items-start space-x-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={comment.author.image || undefined} />
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500">
                              {comment.author.name?.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-gray-900 dark:text-gray-100">
                                {comment.author.name}
                              </p>
                              <p className="text-sm text-gray-500">
                                {new Date(comment.createdAt).toLocaleDateString('de-DE', {
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric'
                                })}
                              </p>
                            </div>
                            <p className="mt-2 text-gray-600 dark:text-gray-300">
                              {comment.content}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sidebar Content */}
              <div className="space-y-6">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-2">
                      <ThumbsUp className={`h-5 w-5 ${
                        project?.likes.some((like) => like.userId === session?.user?.id)
                          ? 'text-blue-500'
                          : 'text-gray-400'
                      }`} />
                      <span className="font-medium">{project?.likes.length} Likes</span>
                    </div>
                    <Button
                      onClick={() => handleLike(project?.id)}
                      variant={project?.likes.some((like) => like.userId === session?.user?.id)
                        ? "secondary"
                        : "default"}
                      className="w-full mt-2 transition-all duration-200 transform hover:scale-102 active:scale-98"
                    >
                      {project?.likes.some((like) => like.userId === session?.user?.id)
                        ? "Liked"
                        : "Like"}
                    </Button>
                  </div>

                  <div className="space-y-4">
                    <Button 
                      asChild 
                      className="w-full bg-blue-500 hover:bg-blue-600 transition-colors"
                    >
                      <a
                        href={project?.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center"
                      >
                        Projekt ansehen
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </a>
                    </Button>

                    {session?.user?.id === project?.author.id && (
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => handleEdit(project)}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Bearbeiten
                        </Button>
                        <Button
                          variant="destructive"
                          className="flex-1"
                          onClick={() => handleDelete(project)}
                        >
                          <Trash className="h-4 w-4 mr-2" />
                          Löschen
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                  <h3 className="font-semibold mb-4">Projekt Details</h3>
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Erstellt am</span>
                      <span className="font-medium">{new Date(project?.createdAt || '').toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Zuletzt aktualisiert</span>
                      <span className="font-medium">{new Date(project?.updatedAt || '').toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Kategorie</span>
                      <span className="font-medium">{project?.category}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default ProjectDetail;

