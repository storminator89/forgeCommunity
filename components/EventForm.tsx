// components/EventForm.tsx

"use client";

import { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DateTime } from 'luxon';
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { Editor } from "@/components/Editor";

interface EventFormProps {
  initialData?: {
    id: string;
    title: string;
    date: string;
    description: string;
    location: string;
    startTime?: string;
    endTime?: string;
    category?: string;
    timezone: string; // Zeitzone in den Initialdaten
  };
  onSuccess: () => void;
  onClose: () => void;
}

// Unterstützte Zeitzonen
const TIMEZONES = [
  'Europe/Berlin',
  'America/New_York',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  // Weitere nach Bedarf hinzufügen
];

export default function EventForm({ initialData, onSuccess, onClose }: EventFormProps) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [date, setDate] = useState(initialData ? initialData.date.slice(0, 10) : '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [location, setLocation] = useState(initialData?.location || '');
  const [startTime, setStartTime] = useState(initialData?.startTime || '');
  const [endTime, setEndTime] = useState(initialData?.endTime || '');
  const [category, setCategory] = useState(initialData?.category || '');
  const [timezone, setTimezone] = useState(initialData?.timezone || 'Europe/Berlin'); // Neue State für Zeitzone
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!initialData) {
      const now = DateTime.now().setZone('Europe/Berlin');
      setDate(now.toISODate() || '');
      setTimezone('Europe/Berlin'); // Standardzeitzone setzen
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Kombinieren von Datum und Uhrzeit und Konvertierung in UTC
      const eventStartDateTime = startTime
        ? DateTime.fromISO(`${date}T${startTime}`, { zone: timezone })
        : DateTime.fromISO(`${date}T00:00`, { zone: timezone });

      const eventEndDateTime = endTime
        ? DateTime.fromISO(`${date}T${endTime}`, { zone: timezone })
        : eventStartDateTime.plus({ hours: 1 }); // Standardendzeit 1 Stunde nach Start

      if (!eventStartDateTime.isValid || !eventEndDateTime.isValid) {
        throw new Error('Ungültiges Datums- oder Zeitformat');
      }

      if (eventEndDateTime <= eventStartDateTime) {
        throw new Error('Endzeit muss nach der Startzeit liegen');
      }

      const utcStartDateTime = eventStartDateTime.toUTC();
      const utcEndDateTime = eventEndDateTime.toUTC();

      const eventData = {
        title,
        date: date, // Nur das Datum im Format 'yyyy-MM-dd' senden
        description,
        location,
        startTime: eventStartDateTime.toFormat('HH:mm'),
        endTime: eventEndDateTime.toFormat('HH:mm'),
        category,
        timezone, // Zeitzone einschließen
      };

      let res;
      if (initialData) {
        res = await fetch(`/api/events/${initialData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventData),
        });
      } else {
        res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventData),
        });
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Etwas ist schief gelaufen');
      }

      toast({
        title: initialData ? 'Event aktualisiert' : 'Event erstellt',
        description: initialData
          ? 'Das Event wurde erfolgreich aktualisiert.'
          : 'Das Event wurde erfolgreich erstellt.',
        variant: 'default',
      });

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error:', error);
      toast({
        title: 'Fehler',
        description: error.message || 'Etwas ist schief gelaufen.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Titel */}
      <div className="space-y-2">
        <Label htmlFor="title">Titel</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="z.B. Webentwicklung Workshop"
          required
        />
      </div>

      {/* Datum */}
      <div className="space-y-2">
        <Label htmlFor="date">Datum</Label>
        <Input
          id="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      {/* Start- und Endzeit */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startTime">Startzeit</Label>
          <Input
            id="startTime"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endTime">Endzeit</Label>
          <Input
            id="endTime"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Zeitzonenauswahl */}
      <div className="space-y-2">
        <Label htmlFor="timezone">Zeitzone</Label>
        <Select value={timezone} onValueChange={(value) => setTimezone(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Zeitzone auswählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Zeitzonen</SelectLabel>
              {TIMEZONES.map(tz => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {/* Ort */}
      <div className="space-y-2">
        <Label htmlFor="location">Ort</Label>
        <Input
          id="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="z.B. Technologie-Zentrum, Raum 101"
          required
        />
      </div>

      {/* Kategorie */}
      <div className="space-y-2">
        <Label htmlFor="category">Kategorie</Label>
        <Select value={category} onValueChange={(value) => setCategory(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Kategorie auswählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Kategorie</SelectLabel>
              <SelectItem value="Webentwicklung">Webentwicklung</SelectItem>
              <SelectItem value="Data Science">Data Science</SelectItem>
              <SelectItem value="Design">Design</SelectItem>
              <SelectItem value="Mobile Entwicklung">Mobile Entwicklung</SelectItem>
              <SelectItem value="Cloud Computing">Cloud Computing</SelectItem>
              <SelectItem value="Künstliche Intelligenz">Künstliche Intelligenz</SelectItem>
              <SelectItem value="Sonstiges">Sonstiges</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {/* Beschreibung */}
      <div className="space-y-2">
        <Label htmlFor="description">Beschreibung</Label>
        <Editor
          content={description}
          onChange={setDescription}
        />
      </div>

      {/* Aktionen */}
      <div className="flex justify-end space-x-2 pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Wird verarbeitet...
            </>
          ) : initialData ? (
            'Aktualisieren'
          ) : (
            'Hinzufügen'
          )}
        </Button>
      </div>
    </form>
  );
}
