// app/events/page.tsx

"use client";

import { useState, useEffect } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths, 
  getDay 
} from 'date-fns';
import { de } from 'date-fns/locale';
import { UserNav } from "@/components/user-nav";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  ChevronLeft, 
  ChevronRight, 
  MapPin, 
  Clock, 
  Calendar as CalendarIcon, 
  Search, 
  Plus, 
  Edit, 
  Trash2 
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { motion } from 'framer-motion';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import EventForm from '@/components/EventForm';
import { useToast } from '@/hooks/use-toast'; // Stellen Sie sicher, dass diese Hook vorhanden ist

interface Event {
  id: string;
  title: string;
  date: string; // ISO-String von der API
  description: string;
  location: string;
  time?: string;
  category?: string;
}

export default function Events() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null); // Für Bearbeitung
  const [searchTerm, setSearchTerm] = useState('');
  const [eventsData, setEventsData] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();
  
  // Benutzer-Session (optional, für Autorisierung)
  // import { useSession } from 'next-auth/react';
  // const { data: session } = useSession();

  const handlePreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const firstDayOfMonth = startOfMonth(currentMonth);
  const lastDayOfMonth = endOfMonth(currentMonth);
  const startingDayIndex = getDay(firstDayOfMonth);

  const days = eachDayOfInterval({ start: firstDayOfMonth, end: lastDayOfMonth });

  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
    setSelectedEvent(null); // Zurücksetzen beim Auswählen eines neuen Datums
  };

  const handleCloseDialog = () => {
    setSelectedDate(null);
    setSelectedEvent(null);
  };

  const handleOpenAddDialog = () => {
    setIsAddDialogOpen(true);
  };

  const handleCloseAddDialog = () => {
    setIsAddDialogOpen(false);
  };

  const handleOpenEditDialog = (event: Event) => {
    setSelectedEvent(event);
    setIsEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setIsEditDialogOpen(false);
    setSelectedEvent(null);
  };

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/events');
      if (!res.ok) {
        throw new Error('Network response was not ok');
      }
      const data: Event[] = await res.json();
      setEventsData(data);
    } catch (err) {
      console.error('Failed to fetch events:', err);
      setError('Failed to fetch events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const filteredEvents = eventsData.filter(event =>
    event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    event.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (event.category && event.category.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getEventsForDate = (date: Date) => {
    return filteredEvents.filter(event => isSameDay(new Date(event.date), date));
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('Sind Sie sicher, dass Sie dieses Event löschen möchten?')) {
      return;
    }

    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Etwas ist schief gelaufen');
      }

      toast({
        title: 'Event gelöscht',
        description: 'Das Event wurde erfolgreich gelöscht.',
        variant: 'success',
      });

      fetchEvents();
    } catch (error: any) {
      console.error('Error deleting event:', error);
      toast({
        title: 'Fehler',
        description: error.message || 'Etwas ist schief gelaufen.',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-gray-500 dark:text-gray-400">Lade Ereignisse...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-red-500 dark:text-red-400">Fehler: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white ml-12 lg:ml-0 flex items-center">
              <CalendarIcon className="mr-2 h-6 w-6" />
              Events
            </h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Suche nach Events..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-64 rounded-full"
                />
              </div>
              {/* "Add Event"-Button nur für Admins anzeigen */}
              {/* Uncomment and adjust if using authentication
              {session?.user?.role === 'ADMIN' && (
                <Button variant="secondary" size="sm" onClick={handleOpenAddDialog} className="flex items-center">
                  <Plus className="mr-2 h-4 w-4" />
                  Hinzufügen
                </Button>
              )}
              */}
              {/* Temporär den Button anzeigen, falls keine Authentifizierung vorhanden ist */}
              <Button variant="secondary" size="sm" onClick={handleOpenAddDialog} className="flex items-center">
                <Plus className="mr-2 h-4 w-4" />
                Hinzufügen
              </Button>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <motion.div 
            className="max-w-6xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
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
                const dayEvents = getEventsForDate(day);
                const hasEvents = dayEvents.length > 0;
                return (
                  <div
                    key={day.toString()}
                    className={cn(
                      "bg-white dark:bg-gray-800 p-2 lg:p-4 h-24 lg:h-32 relative cursor-pointer",
                      !isSameMonth(day, currentMonth) && "text-gray-400 dark:text-gray-600",
                      isSameDay(day, new Date()) && "bg-blue-50 dark:bg-blue-900"
                    )}
                    onClick={() => handleSelectDate(day)}
                  >
                    <div className={cn(
                      "w-8 h-8 flex items-center justify-center rounded-full",
                      hasEvents && "bg-blue-500 text-white"
                    )}>
                      <time dateTime={format(day, 'yyyy-MM-dd')} className="font-semibold text-sm lg:text-base">
                        {format(day, 'd')}
                      </time>
                    </div>
                    {hasEvents && (
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {dayEvents.length} Event{dayEvents.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </main>
      </div>

      {/* Dialog für das Hinzufügen von Events */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Neues Event hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <EventForm
              onSuccess={fetchEvents}
              onClose={handleCloseAddDialog}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog für das Bearbeiten von Events */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Event bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {selectedEvent && (
              <EventForm
                initialData={selectedEvent}
                onSuccess={fetchEvents}
                onClose={handleCloseEditDialog}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog für die Anzeige der Events an einem ausgewählten Datum */}
      <Dialog open={!!selectedDate} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {selectedDate && format(selectedDate, 'dd. MMMM yyyy', { locale: de })}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {selectedDate && getEventsForDate(selectedDate).map((event) => (
              <div key={event.id} className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">{event.title}</h3>
                    <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                      {event.time && (
                        <div className="flex items-center">
                          <Clock className="mr-2 h-4 w-4 flex-shrink-0" />
                          <span>{event.time}</span>
                        </div>
                      )}
                      <div className="flex items-center">
                        <MapPin className="mr-2 h-4 w-4 flex-shrink-0" />
                        <span>{event.location}</span>
                      </div>
                      <p>{event.description}</p>
                      {event.category && <Badge variant="secondary">{event.category}</Badge>}
                    </div>
                  </div>
                  {/* "Edit" und "Delete" Buttons nur für Admins anzeigen */}
                  {/* Uncomment and adjust if using authentication
                  {session?.user?.role === 'ADMIN' && (
                    <div className="flex space-x-2">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenEditDialog(event)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteEvent(event.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  */}
                  {/* Temporär die Buttons anzeigen, falls keine Authentifizierung vorhanden ist */}
                  <div className="flex space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenEditDialog(event)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteEvent(event.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {selectedDate && getEventsForDate(selectedDate).length === 0 && (
              <p className="text-center text-gray-500 dark:text-gray-400">Keine Events an diesem Tag.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
