"use client";

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  ThumbsUp,
  Users,
  Book,
  Code,
  Calendar,
  Loader2,
  ChevronDown
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'dompurify';

interface Activity {
  type: 'post' | 'comment' | 'project' | 'course';
  id: string;
  title?: string;
  content?: string;
  description?: string;
  author?: {
    name: string;
    image: string | null;
  };
  instructor?: {
    name: string;
    image: string | null;
  };
  postTitle?: string;
  postId?: string;
  stats?: {
    comments?: number;
    likes?: number;
    enrollments?: number;
  };
  createdAt: Date;
}

interface ActivityFeedProps {
  userId: string;
}

export function ActivityFeed({ userId }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchActivities = useCallback(async (pageNum: number) => {
    try {
      const response = await fetch(
        `/api/users/${userId}/activity?page=${pageNum}&limit=10`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) throw new Error('Failed to fetch activities');

      const data = await response.json();

      if (pageNum === 1) {
        setActivities(data.activities);
      } else {
        setActivities(prev => [...prev, ...data.activities]);
      }

      setHasMore(data.pagination.hasMore);
    } catch (error) {
      console.error('Error fetching activities:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchActivities(1);
  }, [fetchActivities]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchActivities(nextPage);
  };

  const getTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 60) return `vor ${minutes} Minuten`;
    if (hours < 24) return `vor ${hours} Stunden`;
    if (days === 1) return 'gestern';
    if (days < 7) return `vor ${days} Tagen`;
    return format(new Date(date), 'dd. MMMM yyyy', { locale: de });
  };

  const renderActivityIcon = (type: string) => {
    switch (type) {
      case 'post':
        return <MessageSquare className="h-5 w-5 text-blue-500" />;
      case 'comment':
        return <MessageSquare className="h-5 w-5 text-green-500" />;
      case 'project':
        return <Code className="h-5 w-5 text-purple-500" />;
      case 'course':
        return <Book className="h-5 w-5 text-yellow-500" />;
      default:
        return null;
    }
  };

  const sanitizeHtml = (html: string) => {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a'],
      ALLOWED_ATTR: ['href', 'target'],
    });
  };

  const renderActivityContent = (activity: Activity) => {
    const author = activity.author || activity.instructor;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="flex items-start space-x-4"
      >
        <Avatar className="h-10 w-10">
          <AvatarImage src={author?.image || ''} alt={author?.name} />
          <AvatarFallback>
            {author?.name?.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="font-medium">{author?.name}</span>
              <Badge variant="secondary">
                {activity.type}
              </Badge>
            </div>
            <span className="text-sm text-gray-500">
              {getTimeAgo(activity.createdAt)}
            </span>
          </div>

          {activity.type === 'post' && (
            <div>
              <h4 className="font-medium">{activity.title}</h4>
              <p className="text-gray-600 dark:text-gray-300 line-clamp-2">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(activity.content || '') }} />
              </p>
              {activity.stats && (
                <div className="flex space-x-4 mt-2 text-sm text-gray-500">
                  <span className="flex items-center">
                    <ThumbsUp className="h-4 w-4 mr-1" />
                    {activity.stats.likes}
                  </span>
                  <span className="flex items-center">
                    <MessageSquare className="h-4 w-4 mr-1" />
                    {activity.stats.comments}
                  </span>
                </div>
              )}
            </div>
          )}

          {activity.type === 'comment' && (
            <div>
              <p className="text-gray-600 dark:text-gray-300">
                Hat auf <span className="font-medium">{activity.postTitle}</span> kommentiert:
              </p>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(activity.content || '') }} />
              </p>
            </div>
          )}

          {activity.type === 'project' && (
            <div>
              <h4 className="font-medium">{activity.title}</h4>
              <p className="text-gray-600 dark:text-gray-300 line-clamp-2">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(activity.description || '') }} />
              </p>
              {activity.stats && (
                <div className="flex space-x-4 mt-2 text-sm text-gray-500">
                  <span className="flex items-center">
                    <ThumbsUp className="h-4 w-4 mr-1" />
                    {activity.stats.likes}
                  </span>
                  <span className="flex items-center">
                    <MessageSquare className="h-4 w-4 mr-1" />
                    {activity.stats.comments}
                  </span>
                </div>
              )}
            </div>
          )}

          {activity.type === 'course' && (
            <div>
              <h4 className="font-medium">{activity.title}</h4>
              <p className="text-gray-600 dark:text-gray-300 line-clamp-2">
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(activity.description || '') }} />
              </p>
              {activity.stats && (
                <div className="flex space-x-4 mt-2 text-sm text-gray-500">
                  <span className="flex items-center">
                    <Users className="h-4 w-4 mr-1" />
                    {activity.stats.enrollments} Teilnehmer
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <AnimatePresence mode="popLayout">
          {activities.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-8"
            >
              <Calendar className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Keine Aktivitäten
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Hier erscheinen zukünftige Aktivitäten.
              </p>
            </motion.div>
          ) : (
            <>
              {activities.map((activity) => (
                <div
                  key={`${activity.type}-${activity.id}`}
                  className="border-b border-gray-200 dark:border-gray-700 last:border-0 pb-6 last:pb-0"
                >
                  {renderActivityContent(activity)}
                </div>
              ))}

              {hasMore && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                    className="w-full sm:w-auto"
                  >
                    <ChevronDown className="h-4 w-4 mr-2" />
                    Mehr laden
                  </Button>
                </div>
              )}
            </>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}