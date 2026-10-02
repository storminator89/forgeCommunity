// app/events/page.tsx

"use client";

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMonths,
  subMonths,
  getISODay, // Verwenden Sie getISODay statt getDay
  startOfWeek,
  addDays,
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
import { sanitizeRichHtml } from '@/lib/sanitize-html';


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
  const eventsRequestRef = useRef<AbortController | null>(null);

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
    setSelectedDate(null);
    setSelectedEvent(event);
    setIsEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setIsEditDialogOpen(false);
    setSelectedEvent(null);
  };

  const loadEvents = useCallback(async (controller: AbortController) => {
    const res = await fetch('/api/events', { signal: controller.signal });
    if (!res.ok) {
      throw new Error('Netzwerkantwort war nicht ok');
    }
    return (await res.json()) as Event[];
  }, []);

  const fetchEvents = useCallback(() => {
    eventsRequestRef.current?.abort();
    const controller = new AbortController();
    eventsRequestRef.current = controller;
    setLoading(true);
    setError(null);
    void loadEvents(controller)
      .then((data) => {
        if (eventsRequestRef.current !== controller) return;
        setEventsData(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || eventsRequestRef.current !== controller) return;
        console.error('Fehler beim Abrufen der Events:', err);
        setError('Fehler beim Abrufen der Events');
      })
      .finally(() => {
        if (eventsRequestRef.current === controller) {
          eventsRequestRef.current = null;
          setLoading(false);
        }
      });
  }, [loadEvents]);

  useEffect(() => {
    const controller = new AbortController();
    eventsRequestRef.current = controller;
    void loadEvents(controller)
      .then((data) => {
        if (eventsRequestRef.current !== controller) return;
        setEventsData(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || eventsRequestRef.current !== controller) return;
        console.error('Fehler beim Abrufen der Events:', err);
        setError('Fehler beim Abrufen der Events');
      })
      .finally(() => {
        if (eventsRequestRef.current === controller) {
          eventsRequestRef.current = null;
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
      if (eventsRequestRef.current === controller) eventsRequestRef.current = null;
    };
  }, [loadEvents]);

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
        variant: 'default',
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
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({
        title: 'ICS-Datei heruntergeladen',
        description: 'Die Kalenderdatei wurde erfolgreich heruntergeladen.',
        variant: 'default',
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

  if (loading || error) {
    return (
      <AppShell>
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppHeader><div className="flex items-center justify-between gap-3"><h1>Events</h1><div className="flex items-center gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
          <main id="page-content" tabIndex={-1} className="flex flex-1 items-center justify-center p-6 text-center">
            <div role={error ? 'alert' : 'status'} className="space-y-4 rounded-xl border bg-card p-8">
              <p className={error ? 'text-destructive' : 'text-muted-foreground'}>{error ? 'Die Events konnten nicht geladen werden.' : 'Events werden geladen …'}</p>
              {error && <Button variant="outline" onClick={fetchEvents}>Erneut versuchen</Button>}
            </div>
          </main>
        </div>
      </AppShell>
    );
  }

  const renderDay = (day: Date, week = false) => {
    const dayEvents = getEventsForDate(day);
    const today = isSameDay(day, new Date());
    return (
      <button key={day.toISOString()} type="button"
        onClick={() => handleSelectDate(day)}
        aria-label={`${format(day, 'EEEE, dd. MMMM yyyy', { locale: de })}, ${dayEvents.length} ${dayEvents.length === 1 ? 'Event' : 'Events'}`}
        aria-current={today ? 'date' : undefined}
        className={cn(
          "min-w-0 bg-card p-1.5 text-left transition-colors hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-3",
          week ? "flex min-h-20 items-start gap-4 sm:block sm:h-44" : "h-20 sm:h-32 lg:h-40",
          today && "bg-primary/5"
        )}>
        <time dateTime={format(day, 'yyyy-MM-dd')} className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold", today && "bg-primary text-primary-foreground")}>
          {format(day, 'd')}
        </time>
        <span className={cn("mt-1 min-w-0 space-y-1", week ? "block sm:mt-2" : "hidden sm:block")}>
          {week && <span className="block text-xs text-muted-foreground sm:hidden">{format(day, 'EEEE', { locale: de })}</span>}
          {dayEvents.slice(0, 2).map(event => <span key={event.id} className="block truncate rounded bg-primary/10 px-1.5 py-1 text-xs font-medium text-primary">{event.startTime ? `${event.startTime} · ` : ''}{event.title}</span>)}
          {dayEvents.length > 2 && <span className="block text-xs text-muted-foreground">+{dayEvents.length - 2} weitere</span>}
          {week && dayEvents.length === 0 && <span className="block text-xs text-muted-foreground sm:hidden">Keine Events</span>}
        </span>
        {!week && dayEvents.length > 0 && <span className="mt-1 block text-center text-xs font-medium text-primary sm:hidden">{dayEvents.length} <span className="sr-only">Events</span><span aria-hidden="true">●</span></span>}
      </button>
    );
  };

  const renderMonthView = () => (
    <section aria-label="Monatskalender" className="mx-auto max-w-6xl overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b p-3 sm:p-5">
        <Button variant="outline" size="icon" aria-label="Vorheriger Monat" onClick={handlePreviousMonth}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="text-center text-base font-semibold sm:text-xl">{format(currentMonth, 'MMMM yyyy', { locale: de })}</h2>
        <Button variant="outline" size="icon" aria-label="Nächster Monat" onClick={handleNextMonth}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(day => <div key={day} className="bg-card py-2 text-center text-xs font-medium text-muted-foreground">{day}</div>)}
        {Array.from({ length: startingDayIndex }).map((_, index) => <div key={`empty-${index}`} className="h-20 bg-muted/30 sm:h-32 lg:h-40" aria-hidden="true" />)}
        {days.map(day => renderDay(day))}
        {Array.from({ length: (7 - (startingDayIndex + days.length) % 7) % 7 }).map((_, index) => <div key={`trailing-${index}`} className="h-20 bg-muted/30 sm:h-32 lg:h-40" aria-hidden="true" />)}
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">Wähle einen Tag, um die Events und Details zu öffnen.</p>
    </section>
  );

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentMonth, { locale: de, weekStartsOn: 1 });
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return (
      <section aria-label="Wochenkalender" className="mx-auto max-w-6xl overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b p-3 sm:p-5">
          <Button variant="outline" size="icon" aria-label="Vorherige Woche" onClick={() => setCurrentMonth(addDays(currentMonth, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="text-center text-sm font-semibold sm:text-lg">{format(weekStart, 'dd. MMM', { locale: de })} – {format(addDays(weekStart, 6), 'dd. MMM yyyy', { locale: de })}</h2>
          <Button variant="outline" size="icon" aria-label="Nächste Woche" onClick={() => setCurrentMonth(addDays(currentMonth, 7))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="hidden grid-cols-7 gap-px bg-border sm:grid">{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(day => <div key={day} className="bg-card py-2 text-center text-xs font-medium text-muted-foreground">{day}</div>)}</div>
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-7">{weekDays.map(day => renderDay(day, true))}</div>
      </section>
    );
  };

  const renderListView = () => {
    const today = startOfToday();
    const futureEvents = filteredEvents.filter(event => new Date(event.date) >= today);
    const sortedEvents = [...futureEvents].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return (
      <div className="mx-auto max-w-6xl overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 lg:p-6">
          <h2 className="text-lg lg:text-2xl font-semibold text-foreground">
            Listenansicht
          </h2>
          <Button variant="outline" size="sm" onClick={() => setView('month')} className="flex items-center">
            <ChevronLeft className="h-4 w-4 mr-2" />
            Monatsansicht
          </Button>
        </div>
        <div className="p-4 lg:p-6">
          {sortedEvents.length > 0 ? (
            sortedEvents.map(event => (
              <div key={event.id} className="bg-card p-4 rounded-lg mb-4 border border-border">
                <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row">
                  <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                    <h3 className="text-lg font-semibold mb-2">{event.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(event.date), 'dd. MMM yyyy', { locale: de })}
                      {event.startTime && event.endTime ? `, ${event.startTime} - ${event.endTime}` : ''}
                    </p>
                    <div className="space-y-2 text-sm text-muted-foreground mt-2">
                      <div className="flex items-center">
                        <MapPin className="mr-2 h-4 w-4 flex-shrink-0" />
                        <span>{event.location}</span>
                      </div>
                      <div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(event.description) }} />
                      {event.category && <Badge variant="secondary">{event.category}</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Event ${event.title} bearbeiten`} onClick={() => handleOpenEditDialog(event)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Event ${event.title} löschen`} onClick={() => handleDeleteEvent(event.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Event ${event.title} als Kalenderdatei herunterladen`} onClick={() => handleDownloadICS(event)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-muted-foreground">Keine zukünftigen Events gefunden.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h1 className="flex min-w-0 items-center gap-2"><CalendarIcon className="h-5 w-5 shrink-0" aria-hidden="true" />Events</h1>
            <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="mx-auto mb-5 flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Kalenderansicht" className="flex gap-1 rounded-xl border bg-card p-1">
              <Button variant={view === 'month' ? 'default' : 'ghost'} size="sm" aria-pressed={view === 'month'} onClick={() => setView('month')}><CalendarDays className="mr-1 h-4 w-4" aria-hidden="true" />Monat</Button>
              <Button variant={view === 'week' ? 'default' : 'ghost'} size="sm" aria-pressed={view === 'week'} onClick={() => setView('week')}><CalendarIcon className="mr-1 h-4 w-4" aria-hidden="true" />Woche</Button>
              <Button variant={view === 'list' ? 'default' : 'ghost'} size="sm" aria-pressed={view === 'list'} onClick={() => setView('list')}><List className="mr-1 h-4 w-4" aria-hidden="true" />Liste</Button>
            </div>
            <Button size="sm" onClick={handleOpenAddDialog} className="gap-2"><Plus className="h-4 w-4" aria-hidden="true" />Event erstellen</Button>
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input type="search" aria-label="Events durchsuchen" placeholder="Titel, Beschreibung oder Kategorie suchen …" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
            </div>
            {searchTerm && <p className="w-full text-sm text-muted-foreground" role="status">{filteredEvents.length} {filteredEvents.length === 1 ? 'Event gefunden' : 'Events gefunden'}</p>}
          </div>

          {view === 'month' && renderMonthView()}
          {view === 'week' && renderWeekView()}
          {view === 'list' && renderListView()}
        </main>
      </div>

      {/* Hinzufügen Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[600px]">
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
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[600px]">
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
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {selectedDate && format(selectedDate, 'dd. MMMM yyyy', { locale: de })}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            {selectedDate && getEventsForDate(selectedDate).map((event) => (
              <div key={event.id} className="bg-card p-4 rounded-lg border border-border">
                <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row">
                  <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                    <h3 className="text-lg font-semibold mb-2">{event.title}</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
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
                      <div dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(event.description) }} />
                      {event.category && <Badge variant="secondary">{event.category}</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Event ${event.title} bearbeiten`} onClick={() => handleOpenEditDialog(event)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Event ${event.title} löschen`} onClick={() => handleDeleteEvent(event.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Event ${event.title} als Kalenderdatei herunterladen`} onClick={() => handleDownloadICS(event)}>
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {selectedDate && getEventsForDate(selectedDate).length === 0 && (
              <p className="text-center text-muted-foreground">Keine Events an diesem Tag.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
