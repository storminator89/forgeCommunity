// components/EventForm.tsx

"use client";

import { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast"; // Stellen Sie sicher, dass diese Hook vorhanden ist
import { formatISO } from 'date-fns';

interface EventFormProps {
  initialData?: {
    id: string;
    title: string;
    date: string;
    description: string;
    location: string;
    time?: string;
    category?: string;
  };
  onSuccess: () => void;
  onClose: () => void;
}

export default function EventForm({ initialData, onSuccess, onClose }: EventFormProps) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [date, setDate] = useState(initialData ? initialData.date.slice(0, 10) : '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [location, setLocation] = useState(initialData?.location || '');
  const [time, setTime] = useState(initialData?.time || '');
  const [category, setCategory] = useState(initialData?.category || '');
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const eventData = {
      title,
      date: formatISO(new Date(date)),
      description,
      location,
      time,
      category,
    };

    try {
      let res;
      if (initialData) {
        // Update existing event
        res = await fetch(`/api/events/${initialData.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventData),
        });
      } else {
        // Create new event
        res = await fetch('/api/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventData),
        });
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Something went wrong');
      }

      toast({
        title: initialData ? 'Event aktualisiert' : 'Event erstellt',
        description: initialData ? 'Das Event wurde erfolgreich aktualisiert.' : 'Das Event wurde erfolgreich erstellt.',
        variant: 'success',
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
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Titel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <Input
        label="Datum"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />
      <Input
        label="Zeit"
        type="text"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        placeholder="z.B. 10:00 - 16:00"
      />
      <Input
        label="Ort"
        type="text"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        required
      />
      <Select value={category} onValueChange={(value) => setCategory(value)} required>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Kategorie auswählen" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Kategorie</SelectLabel>
            <SelectItem value="Webentwicklung">Webentwicklung</SelectItem>
            <SelectItem value="Data Science">Data Science</SelectItem>
            <SelectItem value="Design">Design</SelectItem>
            {/* Weitere Kategorien hinzufügen */}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Textarea
        label="Beschreibung"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        required
      />
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit">
          {initialData ? 'Aktualisieren' : 'Hinzufügen'}
        </Button>
      </div>
    </form>
  );
}
