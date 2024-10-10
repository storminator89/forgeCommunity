"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { UserNav } from "@/components/user-nav";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Clock, Calendar, Users } from 'lucide-react';

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

export default function Courses() {
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredCourses = coursesData.filter(course =>
    course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    course.instructor.toLowerCase().includes(searchTerm.toLowerCase()) ||
    course.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Entdecke unsere Kurse</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-8">
              <Input
                type="text"
                placeholder="Suche nach Kursen, Dozenten oder Kategorien"
                value={searchTerm}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                className="w-full max-w-md mx-auto"
              />
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredCourses.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>
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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl hover:scale-105">
      <div className="relative h-48">
        <div className="w-full h-full bg-gradient-to-br from-blue-400 to-purple-500" />
        <div className="absolute top-0 right-0 bg-blue-600 text-white px-2 py-1 m-2 rounded-full text-sm font-semibold">
          {course.category}
        </div>
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
        <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-300">
          Kurs beitreten
        </Button>
      </div>
    </div>
  );
}