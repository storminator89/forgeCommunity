'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import { UserNav } from "@/components/user-nav";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Calendar, Users, Search, BookOpen, PlusCircle, Trash2, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Course {
  id: string;
  title: string;
  instructor: string;
  duration: string;
  startDate: string | null;
  endDate: string | null;
  category: string;
  participants: number;
  imageUrl: string | null;
}

export default function CourseClient() {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [categories, setCategories] = useState<string[]>([]);
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    }
  }, [status, router]);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await fetch('/api/courses');
        if (!response.ok) {
          throw new Error('Failed to fetch courses');
        }
        const data = await response.json();
        setCourses(data);
        // Extract unique categories
        const uniqueCategories = Array.from(new Set(data.map((course: Course) => course.category)));
        setCategories(['Alle', ...uniqueCategories]);
      } catch (error) {
        console.error('Error fetching courses:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCourses();
  }, []);

  const filteredCourses = courses.filter(course =>
    (course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    course.instructor.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (categoryFilter === '' || categoryFilter === 'Alle' || course.category === categoryFilter)
  );

  const handleDeleteCourse = async (courseId: string) => {
    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete course');
      }
      setCourses(courses.filter(course => course.id !== courseId));
    } catch (error) {
      console.error('Error deleting course:', error);
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
              <BookOpen className="mr-2 h-6 w-6" />
              Entdecke unsere Kurse
            </h2>
            <div className="flex items-center space-x-4">
              <Link href="/courses/new">
                <Button variant="outline" className="flex items-center">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Neuer Kurs
                </Button>
              </Link>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-8 flex flex-col md:flex-row md:items-center md:space-x-4">
              <div className="relative flex-grow mb-4 md:mb-0">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Suche nach Kursen oder Dozenten"
                  value={searchTerm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 rounded-full w-full"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Filter className="text-gray-400" />
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Kategorie wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <AnimatePresence>
              <motion.div 
                className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {filteredCourses.map((course) => (
                  <CourseCard key={course.id} course={course} onDelete={handleDeleteCourse} />
                ))}
              </motion.div>
            </AnimatePresence>
            {filteredCourses.length === 0 && (
              <motion.div 
                className="text-center py-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <Search className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Keine Kurse gefunden</h3>
                <p className="text-gray-500 dark:text-gray-400">Versuchen Sie es mit anderen Suchbegriffen oder ändern Sie die Kategorie.</p>
              </motion.div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

interface CourseCardProps {
  course: Course;
  onDelete: (courseId: string) => void;
}

function CourseCard({ course, onDelete }: CourseCardProps) {
  const router = useRouter();

  const handleCourseAction = () => {
    router.push(`/courses/${course.id}/contents`);
  };

  return (
    <motion.div 
      className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl flex flex-col h-full"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="relative h-48 w-full">
        {course.imageUrl ? (
          <Image
            src={course.imageUrl}
            alt={course.title}
            layout="fill"
            objectFit="cover"
            className="rounded-t-lg"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-blue-400 to-purple-500 rounded-t-lg" />
        )}
        <Badge className="absolute top-2 right-2 z-10" variant="secondary">
          {course.category}
        </Badge>
      </div>
      <div className="p-6 flex-grow flex flex-col">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{course.title}</h3>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-gray-500 hover:text-red-500">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
                <AlertDialogDescription>
                  Diese Aktion kann nicht rückgängig gemacht werden. Der Kurs wird dauerhaft aus unserer Datenbank entfernt.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(course.id)}>Löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <p className="text-gray-600 dark:text-gray-300 mb-4">{course.instructor}</p>
        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-2">
          <Clock className="w-4 h-4 mr-2" />
          <span>{course.duration}</span>
        </div>
        {course.startDate && (
          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-2">
            <Calendar className="w-4 h-4 mr-2" />
            <span>Startet am {new Date(course.startDate).toLocaleDateString('de-DE')}</span>
          </div>
        )}
        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-4">
          <Users className="w-4 h-4 mr-2" />
          <span>{course.participants} Teilnehmer</span>
        </div>
        <div className="mt-auto">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-300"
                  onClick={handleCourseAction}
                >
                  Kurs beitreten
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Klicken Sie hier, um sich für den Kurs anzumelden und die Inhalte anzuzeigen</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </motion.div>
  );
}