"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  BookOpen, 
  Users, 
  Calendar,
  Clock,
  DollarSign,
  Loader2,
  Star,
  Share2,
  ArrowRight,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'react-toastify';
import Image from 'next/image';

interface Course {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  instructor: {
    id: string;
    name: string;
    image?: string;
  };
  price?: number;
  currency?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
  stats: {
    enrollments: number;
    maxStudents?: number;
    completionRate: number;
    rating: number;
    ratingCount: number;
    lessonsCount: number;
  };
  progress?: {
    completed: number;
    total: number;
    lastAccessed?: string;
  };
  enrolled?: boolean;
}

interface CoursesListProps {
  userId: string;
  isInstructor: boolean;
  showEnrolled?: boolean;
}

export function CoursesList({ userId, isInstructor, showEnrolled = false }: CoursesListProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchCourses = async (pageNum: number) => {
    try {
      const endpoint = showEnrolled 
        ? `/api/users/${userId}/enrollments`
        : `/api/users/${userId}/courses`;
        
      const response = await fetch(
        `${endpoint}?page=${pageNum}&limit=6`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) throw new Error('Failed to fetch courses');

      const data = await response.json();
      
      if (pageNum === 1) {
        setCourses(data.courses);
      } else {
        setCourses(prev => [...prev, ...data.courses]);
      }
      
      setHasMore(data.pagination.hasMore);
    } catch (error) {
      console.error('Error fetching courses:', error);
      toast.error('Fehler beim Laden der Kurse');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses(1);
  }, [userId, showEnrolled]);

  const handleShare = async (course: Course) => {
    try {
      await navigator.share({
        title: course.title,
        text: course.description,
        url: `/courses/${course.id}`,
      });
    } catch (error) {
      console.error('Error sharing course:', error);
      navigator.clipboard.writeText(window.location.origin + `/courses/${course.id}`);
      toast.success('Link in die Zwischenablage kopiert');
    }
  };

  const renderRating = (rating: number, count: number) => {
    return (
      <div className="flex items-center space-x-1">
        <div className="flex">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={`h-4 w-4 ${
                star <= rating
                  ? 'text-yellow-400 fill-current'
                  : 'text-gray-300'
              }`}
            />
          ))}
        </div>
        <span className="text-sm text-gray-500">({count})</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          {courses.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                {showEnrolled
                  ? 'Keine eingeschriebenen Kurse'
                  : isInstructor
                    ? 'Keine erstellten Kurse'
                    : 'Keine Kurse vorhanden'}
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                {showEnrolled
                  ? 'Schreiben Sie sich in Kurse ein, um Ihre Fähigkeiten zu erweitern'
                  : isInstructor
                    ? 'Erstellen Sie Ihren ersten Kurs'
                    : 'Dieser Benutzer hat noch keine Kurse erstellt'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {courses.map((course) => (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="group"
                  >
                    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                      <div className="relative h-48">
                        {course.imageUrl ? (
                          <Image
                            src={course.imageUrl}
                            alt={course.title}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="h-full bg-gradient-to-br from-blue-500 to-purple-600" />
                        )}
                        {course.enrolled && course.progress && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white p-2">
                            <div className="flex justify-between items-center text-sm mb-1">
                              <span>Fortschritt</span>
                              <span>{Math.round((course.progress.completed / course.progress.total) * 100)}%</span>
                            </div>
                            <Progress 
                              value={(course.progress.completed / course.progress.total) * 100}
                              className="h-1"
                            />
                          </div>
                        )}
                      </div>
                      <CardContent className="p-4">
                        <div className="mb-4">
                          {course.category && (
                            <Badge variant="secondary" className="mb-2">
                              {course.category}
                            </Badge>
                          )}
                          <h3 className="text-lg font-semibold mb-1">{course.title}</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                            {course.description}
                          </p>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center text-gray-500">
                              <Users className="h-4 w-4 mr-1" />
                              {course.stats.enrollments}
                              {course.stats.maxStudents && (
                                <span>/{course.stats.maxStudents}</span>
                              )}
                            </div>
                            <div className="flex items-center text-gray-500">
                              <BookOpen className="h-4 w-4 mr-1" />
                              {course.stats.lessonsCount} Lektionen
                            </div>
                          </div>

                          {renderRating(course.stats.rating, course.stats.ratingCount)}

                          {course.startDate && (
                            <div className="flex items-center text-sm text-gray-500">
                              <Calendar className="h-4 w-4 mr-1" />
                              Start: {format(new Date(course.startDate), 'dd.MM.yyyy', { locale: de })}
                            </div>
                          )}

                          {course.price !== undefined && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center text-lg font-bold">
                                <DollarSign className="h-5 w-5" />
                                {course.price}
                                {course.currency && <span className="text-sm ml-1">{course.currency}</span>}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex justify-between items-center">
                          <Button
                            variant="default"
                            onClick={() => window.location.href = `/courses/${course.id}`}
                          >
                            {course.enrolled ? (
                              <>
                                <Play className="h-4 w-4 mr-2" />
                                Fortsetzen
                              </>
                            ) : (
                              <>
                                Mehr erfahren
                                <ArrowRight className="h-4 w-4 ml-2" />
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleShare(course)}
                          >
                            <Share2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {course.progress?.lastAccessed && (
                          <div className="mt-3 text-xs text-gray-500">
                            <Clock className="h-3 w-3 inline mr-1" />
                            Zuletzt bearbeitet: {format(new Date(course.progress.lastAccessed), 'dd.MM.yyyy HH:mm', { locale: de })}
                          </div>
                        )}
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
                  fetchCourses(page + 1);
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