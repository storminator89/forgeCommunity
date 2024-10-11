'use client'

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { UserNav } from "@/components/user-nav";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Clock, Calendar, Users, Search, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Course {
  id: number;
  title: string;
  instructor: string;
  duration: string;
  startDate: string;
  category: string;
  participants: number;
}

const coursesData: Course[] = [
  { 
    id: 1, 
    title: "Einführung in React", 
    instructor: "Max Mustermann", 
    duration: "4 Wochen", 
    startDate: "2024-11-01", 
    category: "Webentwicklung",
    participants: 45,
  },
  { 
    id: 2, 
    title: "Machine Learning Grundlagen", 
    instructor: "Anna Schmidt", 
    duration: "6 Wochen", 
    startDate: "2024-11-15", 
    category: "Data Science",
    participants: 30,
  },
  { 
    id: 3, 
    title: "UX Design Prinzipien", 
    instructor: "Lena Weber", 
    duration: "3 Wochen", 
    startDate: "2024-12-01", 
    category: "Design",
    participants: 25,
  },
];

export default function CourseClient() {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    }
  }, [status, router]);

  const filteredCourses = coursesData.filter(course =>
    course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    course.instructor.toLowerCase().includes(searchTerm.toLowerCase()) ||
    course.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (status === 'loading') {
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
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
              <BookOpen className="mr-2 h-6 w-6" />
              Entdecke unsere Kurse
            </h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-8 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                placeholder="Suche nach Kursen, Dozenten oder Kategorien"
                value={searchTerm}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                className="w-full max-w-md mx-auto pl-10 pr-4 py-2 rounded-full"
              />
            </div>
            <AnimatePresence>
              <motion.div 
                className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {filteredCourses.map((course) => (
                  <CourseCard key={course.id} course={course} />
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
                <p className="text-gray-500 dark:text-gray-400">Versuchen Sie es mit anderen Suchbegriffen oder schauen Sie später wieder vorbei.</p>
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
}

function CourseCard({ course }: CourseCardProps) {
  return (
    <motion.div 
      className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="relative h-48">
        <div className="w-full h-full bg-gradient-to-br from-blue-400 to-purple-500" />
        <Badge className="absolute top-2 right-2" variant="secondary">
          {course.category}
        </Badge>
      </div>
      <div className="p-6">
        <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">{course.title}</h3>
        <p className="text-gray-600 dark:text-gray-300 mb-4">{course.instructor}</p>
        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-2">
          <Clock className="w-4 h-4 mr-2" />
          <span>{course.duration}</span>
        </div>
        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-2">
          <Calendar className="w-4 h-4 mr-2" />
          <span>Startet am {new Date(course.startDate).toLocaleDateString('de-DE')}</span>
        </div>
        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-4">
          <Users className="w-4 h-4 mr-2" />
          <span>{course.participants} Teilnehmer</span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-300">
                Kurs beitreten
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Klicken Sie hier, um sich für den Kurs anzumelden</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </motion.div>
  );
}