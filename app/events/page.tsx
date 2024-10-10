"use client";

import { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, getDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { UserNav } from "@/components/user-nav";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, MapPin, Clock, Calendar as CalendarIcon, Menu } from 'lucide-react';
import { cn } from "@/lib/utils";

interface Event {
  id: number;
  title: string;
  date: Date;
  description: string;
  location: string;
  time: string;
}

const eventsData: Event[] = [
  {
    id: 1,
    title: 'Webentwicklung Workshop',
    date: new Date(2024, 9, 15),
    description: 'Ein ganztägiger Workshop zu modernen Webentwicklungstechniken.',
    location: 'Online',
    time: '10:00 - 16:00'
  },
  {
    id: 2,
    title: 'Data Science Meetup',
    date: new Date(2024, 9, 20),
    description: 'Netzwerken und Austausch für Data Science Enthusiasten.',
    location: 'TechHub Berlin',
    time: '18:00 - 20:00'
  },
  {
    id: 3,
    title: 'UX Design Konferenz',
    date: new Date(2024, 10, 5),
    description: 'Dreitägige Konferenz über die neuesten Trends im UX Design.',
    location: 'Designzentrum Hamburg',
    time: '09:00 - 17:00'
  },
];

export default function Events() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handlePreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const firstDayOfMonth = startOfMonth(currentMonth);
  const lastDayOfMonth = endOfMonth(currentMonth);
  const startingDayIndex = getDay(firstDayOfMonth);

  const days = eachDayOfInterval({ start: firstDayOfMonth, end: lastDayOfMonth });

  const handleSelectEvent = (event: Event) => {
    setSelectedEvent(event);
  };

  const handleCloseDialog = () => {
    setSelectedEvent(null);
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />
      <div className="flex-1 flex flex-col">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-40 sticky top-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={toggleSidebar}>
                <Menu className="h-6 w-6" />
              </Button>
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Events</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-6xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 lg:p-6 border-b border-gray-200 dark:border-gray-700">
              <Button variant="outline" size="sm" onClick={handlePreviousMonth}>
                <ChevronLeft className="h-4 w-4 mr-2" />
                Vorheriger
              </Button>
              <h2 className="text-lg lg:text-2xl font-semibold text-gray-800 dark:text-white">
                {format(currentMonth, 'MMMM yyyy', { locale: de })}
              </h2>
              <Button variant="outline" size="sm" onClick={handleNextMonth}>
                Nächster
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
              {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day) => (
                <div key={day} className="text-center font-medium text-sm py-2 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
              {Array.from({ length: startingDayIndex }).map((_, index) => (
                <div key={`empty-${index}`} className="bg-white dark:bg-gray-800 p-2 lg:p-4 h-24 lg:h-32" />
              ))}
              {days.map((day, dayIdx) => {
                const dayEvents = eventsData.filter(event => isSameDay(day, event.date));
                return (
                  <div
                    key={day.toString()}
                    className={cn(
                      "bg-white dark:bg-gray-800 p-2 lg:p-4 h-24 lg:h-32 overflow-y-auto",
                      !isSameMonth(day, currentMonth) && "text-gray-400 dark:text-gray-600",
                      isSameDay(day, new Date()) && "bg-blue-50 dark:bg-blue-900"
                    )}
                  >
                    <time dateTime={format(day, 'yyyy-MM-dd')} className="font-semibold text-sm lg:text-base">
                      {format(day, 'd')}
                    </time>
                    {dayEvents.map(event => (
                      <div
                        key={event.id}
                        className="mt-1 px-2 py-1 text-xs lg:text-sm rounded-md bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-700 transition-colors truncate"
                        onClick={() => handleSelectEvent(event)}
                      >
                        {event.title}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>
      <Dialog open={!!selectedEvent} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{selectedEvent?.title}</DialogTitle>
            <DialogDescription>
              <div className="mt-2 space-y-2">
                <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                  <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{selectedEvent?.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                  <Clock className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span>{selectedEvent?.time}</span>
                </div>
                <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                  <MapPin className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{selectedEvent?.location}</span>
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {selectedEvent?.description}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}