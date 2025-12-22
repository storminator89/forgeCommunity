"use client";

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  MessageSquare,
  ExternalLink,
  Github,
  Loader2,
  ThumbsUp,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'react-toastify';

interface Project {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  link: string;
  githubUrl?: string;
  category?: string;
  gradientFrom: string;
  gradientTo: string;
  tags: string[];
  createdAt: string;
  stats: {
    likes: number;
    comments: number;
  };
  isLiked: boolean;
}

interface ProjectsListProps {
  userId: string;
  isOwner: boolean;
}

export function ProjectsList({ userId, isOwner }: ProjectsListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchProjects = useCallback(async (pageNum: number) => {
    try {
      const response = await fetch(
        `/api/users/${userId}/projects?page=${pageNum}&limit=6`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) throw new Error('Failed to fetch projects');

      const data = await response.json();

      if (pageNum === 1) {
        setProjects(data.projects);
      } else {
        setProjects(prev => [...prev, ...data.projects]);
      }

      setHasMore(data.pagination.hasMore);
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast.error('Fehler beim Laden der Projekte');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchProjects(1);
  }, [fetchProjects]);

  const handleLike = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/like`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to like project');

      setProjects(prev =>
        prev.map(project =>
          project.id === projectId
            ? {
              ...project,
              isLiked: !project.isLiked,
              stats: {
                ...project.stats,
                likes: project.stats.likes + (project.isLiked ? -1 : 1),
              },
            }
            : project
        )
      );
    } catch (error) {
      console.error('Error liking project:', error);
      toast.error('Fehler beim Liken des Projekts');
    }
  };

  const handleShare = async (project: Project) => {
    try {
      await navigator.share({
        title: project.title,
        text: project.description,
        url: `/projects/${project.id}`,
      });
    } catch (error) {
      console.error('Error sharing project:', error);
      // Fallback für Browser ohne Share API
      navigator.clipboard.writeText(window.location.origin + `/projects/${project.id}`);
      toast.success('Link in die Zwischenablage kopiert');
    }
  };

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          {projects.length === 0 ? (
            <div className="text-center py-12">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Keine Projekte vorhanden
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                {isOwner
                  ? 'Erstellen Sie Ihr erstes Projekt'
                  : 'Dieser Benutzer hat noch keine Projekte erstellt'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {projects.map((project) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="group"
                  >
                    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                      <div
                        className="h-48 relative bg-gradient-to-br"
                        style={{
                          backgroundImage: project.imageUrl
                            ? `url(${project.imageUrl})`
                            : `linear-gradient(to bottom right, ${project.gradientFrom}, ${project.gradientTo})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                      >
                        <div className="absolute inset-0 bg-black bg-opacity-40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center space-x-4">
                          {project.link && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => window.open(project.link, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Demo
                            </Button>
                          )}
                          {project.githubUrl && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => window.open(project.githubUrl, '_blank')}
                            >
                              <Github className="h-4 w-4 mr-2" />
                              Code
                            </Button>
                          )}
                        </div>
                      </div>
                      <CardContent className="p-4">
                        <div className="mb-2">
                          {project.category && (
                            <Badge variant="secondary" className="mb-2">
                              {project.category}
                            </Badge>
                          )}
                          <h3 className="text-lg font-semibold mb-1">{project.title}</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                            {project.description}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2 mb-4">
                          {project.tags.map((tag, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>

                        <div className="flex items-center justify-between text-sm text-gray-500">
                          <div className="flex items-center space-x-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={project.isLiked ? 'text-red-500' : ''}
                              onClick={() => handleLike(project.id)}
                            >
                              <Heart className="h-4 w-4 mr-1" />
                              {project.stats.likes}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.location.href = `/projects/${project.id}#comments`}
                            >
                              <MessageSquare className="h-4 w-4 mr-1" />
                              {project.stats.comments}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleShare(project)}
                            >
                              <Share2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <span className="text-xs">
                            {format(new Date(project.createdAt), 'dd.MM.yyyy', { locale: de })}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {hasMore && (
            <div className="text-center mt-8">
              <Button
                variant="outline"
                onClick={() => {
                  setPage(p => p + 1);
                  fetchProjects(page + 1);
                }}
              >
                Mehr laden
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}