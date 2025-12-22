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
  getISODay, // Verwenden Sie getISODay statt getDay
  startOfWeek,
  addDays,
  isAfter,
  startOfToday
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
  Trash2,
  Download,
  CalendarDays,
  List
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import EventForm from '@/components/EventForm';
import { useToast } from '@/hooks/use-toast';
import { SanitizedHtml } from '@/components/SanitizedHtml';

interface Event {
  id: string;
  title: string;
  date: string;
  description: string;
  location: string;
  startTime?: string;
  endTime?: string;
  category?: string;
  timezone: string;
}


type ViewType = 'month' | 'week' | 'list';

export default function Events() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [eventsData, setEventsData] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();
  const [view, setView] = useState<ViewType>('month');

  const handlePreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const firstDayOfMonth = startOfMonth(currentMonth);
  const lastDayOfMonth = endOfMonth(currentMonth);
  // Berechnung der Startposition basierend auf ISO-Tag (Montag = 1, Sonntag = 7)
  const startingDayIndex = getISODay(firstDayOfMonth) - 1; // 0 für Montag, 6 für Sonntag

  const days = eachDayOfInterval({ start: firstDayOfMonth, end: lastDayOfMonth });

  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
    setSelectedEvent(null);
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
        throw new Error('Netzwerkantwort war nicht ok');
      }
      const data: Event[] = await res.json();
      setEventsData(data);
    } catch (err) {
      console.error('Fehler beim Abrufen der Events:', err);
      setError('Fehler beim Abrufen der Events');
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

  const getEventsForWeek = (date: Date) => {
    const weekStart = startOfWeek(date, { locale: de, weekStartsOn: 1 }); // Woche beginnt am Montag
    const weekEnd = addDays(weekStart, 6);
    return filteredEvents.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= weekStart && eventDate <= weekEnd;
    });
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
      console.error('Fehler beim Löschen des Events:', error);
      toast({
        title: 'Fehler',
        description: error.message || 'Etwas ist schief gelaufen.',
        variant: 'destructive',
      });
    }
  };

  const handleDownloadICS = async (event: Event) => {
    try {
      const response = await fetch(`/api/events/${event.id}/ics`);
      if (!response.ok) {
        throw new Error('Fehler beim Generieren der ICS-Datei');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${event.title.replace(/\s+/g, '_')}.ics`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      toast({
        title: 'ICS-Datei heruntergeladen',
        description: 'Die Kalenderdatei wurde erfolgreich heruntergeladen.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Fehler beim Herunterladen der ICS-Datei:', error);
      toast({
        title: 'Fehler',
        description: 'Beim Herunterladen der ICS-Datei ist ein Fehler aufgetreten.',
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

  // Komponenten für verschiedene Ansichten
  const MonthView = () => (
    <div className="max-w-6xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="flex items-center justify-between p-4 lg:p-6 border-b border-gray-200 dark:border-gray-700">
        <Button variant="outline" size="sm" onClick={handlePreviousMonth} className="flex items-center">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Vorheriger
        </Button>
        <h2 className="text-lg lg:text-2xl font-semibold text-gray-800 dark:text-white">
          {format(currentMonth, 'MMMM yyyy', { locale: de })}
        </h2>
        <Button variant="outline" size="sm" onClick={handleNextMonth} className="flex items-center">
          Nächster
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day) => (
          <div key={day} className="text-center font-medium text-sm py-2 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
        {Array.from({ length: startingDayIndex }).map((_, index) => (
          <div key={`empty-${index}`} className="bg-white dark:bg-gray-800 p-2 lg:p-4 h-24 lg:h-32" />
        ))}
        {days.map((day) => {
          const dayEvents = getEventsForDate(day);
          const hasEvents = dayEvents.length > 0;
          return (
            <div
              key={day.toString()}
              className={cn(
                "bg-white dark:bg-gray-800 p-2 lg:p-4 h-24 lg:h-32 relative cursor-pointer border border-gray-200 dark:border-gray-700 rounded-md",
                !isSameMonth(day, currentMonth) && "text-gray-400 dark:text-gray-600",
                isSameDay(day, new Date()) && "bg-blue-50 dark:bg-blue-900"
              )}
              onClick={() => handleSelectDate(day)}
            >
              {hasEvents ? (
                <div className="flex justify-center items-center bg-black text-white rounded-full w-8 h-8 mx-auto">
                  <time dateTime={format(day, 'yyyy-MM-dd')} className="font-semibold text-sm lg:text-base">
                    {format(day, 'd')}
                  </time>
                </div>
              ) : (
                <div className="flex justify-center">
                  <time dateTime={format(day, 'yyyy-MM-dd')} className="font-semibold text-sm lg:text-base">
                    {format(day, 'd')}
                  </time>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const WeekView = () => {
    const weekStart = startOfWeek(currentMonth, { locale: de, weekStartsOn: 1 }); // Woche beginnt am Montag
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));
    const weekEvents = getEventsForWeek(weekStart);

    return (
      <div className="max-w-6xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="flex items-center justify-between p-4 lg:p-6 border-b border-gray-200 dark:border-gray-700">
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="flex items-center">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Vorherige Woche
          </Button>
          <h2 className="text-lg lg:text-2xl font-semibold text-gray-800 dark:text-white">
            Woche: {format(weekStart, 'dd. MMM yyyy', { locale: de })} - {format(addDays(weekStart, 6), 'dd. MMM yyyy', { locale: de })}
          </h2>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="flex items-center">
            Nächste Woche
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day) => (
            <div key={day} className="text-center font-medium text-sm py-2 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
          {weekDays.map((day) => {
            const dayEvents = getEventsForDate(day);
            const hasEvents = dayEvents.length > 0;
            return (
              <div
                key={day.toString()}
                className={cn(
                  "bg-white dark:bg-gray-800 p-2 lg:p-4 h-32 relative cursor-pointer border border-gray-200 dark:border-gray-700 rounded-md",
                  isSameDay(day, new Date()) && "bg-blue-50 dark:bg-blue-900"
                )}
                onClick={() => handleSelectDate(day)}
              >
                {hasEvents ? (
                  <div className="flex justify-center items-center bg-black text-white rounded-full w-8 h-8 mx-auto">
                    <time dateTime={format(day, 'yyyy-MM-dd')} className="font-semibold text-sm lg:text-base">
                      {format(day, 'd')}
                    </time>
                  </div>
                ) : (
                  <div className="flex justify-center">
                    <time dateTime={format(day, 'yyyy-MM-dd')} className="font-semibold text-sm lg:text-base">
                      {format(day, 'd')}
                    </time>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const ListView = () => {
    const today = startOfToday();
    const futureEvents = filteredEvents.filter(event => isAfter(new Date(event.date), today));
    const sortedEvents = [...futureEvents].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return (
      <div className="max-w-6xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="flex items-center justify-between p-4 lg:p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg lg:text-2xl font-semibold text-gray-800 dark:text-white">
            Listenansicht
          </h2>
          <Button variant="outline" size="sm" onClick={() => setView('month')} className="flex items-center">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Zurück zur Monatansicht
          </Button>
        </div>
        <div className="p-4 lg:p-6">
          {sortedEvents.length > 0 ? (
            sortedEvents.map(event => (
              <div key={event.id} className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg mb-4 border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">{event.title}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {format(new Date(event.date), 'dd. MMM yyyy', { locale: de })}
                      {event.startTime && event.endTime ? `, ${event.startTime} - ${event.endTime}` : ''}
                    </p>
                    <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400 mt-2">
                      <div className="flex items-center">
                        <MapPin className="mr-2 h-4 w-4 flex-shrink-0" />
                        <span>{event.location}</span>
                      </div>
                      <SanitizedHtml html={event.description} />
                      {event.category && <Badge variant="secondary">{event.category}</Badge>}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenEditDialog(event)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteEvent(event.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownloadICS(event)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400">Keine zukünftigen Events gefunden.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center">
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
                  className="pl-10 pr-4 py-2 w-64 rounded-full focus:ring-2 focus:ring-blue-500"
                />
              </div>
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
          <div className="flex justify-start mb-4 space-x-2">
            <Button
              variant={view === 'month' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setView('month')}
              className="flex items-center"
            >
              <CalendarDays className="h-4 w-4 mr-1" />
              Monat
            </Button>
            <Button
              variant={view === 'week' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setView('week')}
              className="flex items-center"
            >
              <CalendarIcon className="h-4 w-4 mr-1" />
              Woche
            </Button>
            <Button
              variant={view === 'list' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setView('list')}
              className="flex items-center"
            >
              <List className="h-4 w-4 mr-1" />
              Liste
            </Button>
          </div>

          {view === 'month' && <MonthView />}
          {view === 'week' && <WeekView />}
          {view === 'list' && <ListView />}
        </main>
      </div>

      {/* Hinzufügen Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Neues Event hinzufügen</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <EventForm
              onSuccess={() => {
                fetchEvents();
                handleCloseAddDialog();
              }}
              onClose={handleCloseAddDialog}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Bearbeiten Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Event bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {selectedEvent && (
              <EventForm
                initialData={selectedEvent}
                onSuccess={() => {
                  fetchEvents();
                  handleCloseEditDialog();
                }}
                onClose={handleCloseEditDialog}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Detailansicht Dialog */}
      <Dialog open={!!selectedDate} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {selectedDate && format(selectedDate, 'dd. MMMM yyyy', { locale: de })}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {selectedDate && getEventsForDate(selectedDate).map((event) => (
              <div key={event.id} className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">{event.title}</h3>
                    <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                      {event.startTime && event.endTime && (
                        <div className="flex items-center">
                          <Clock className="mr-2 h-4 w-4 flex-shrink-0" />
                          <span>{event.startTime} - {event.endTime}</span>
                        </div>
                      )}
                      <div className="flex items-center">
                        <MapPin className="mr-2 h-4 w-4 flex-shrink-0" />
                        <span>{event.location}</span>
                      </div>
                      <SanitizedHtml html={event.description} />
                      {event.category && <Badge variant="secondary">{event.category}</Badge>}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenEditDialog(event)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteEvent(event.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownloadICS(event)}>
                      <Download className="h-4 w-4" />
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
