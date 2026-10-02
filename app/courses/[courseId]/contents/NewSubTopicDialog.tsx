"use client";

import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

interface NewSubTopicDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => Promise<unknown>;
  title: string;
  onTitleChange: (title: string) => void;
}

export function NewSubTopicDialog({ isOpen, onOpenChange, onSubmit, title, onTitleChange }: NewSubTopicDialogProps) {
  const titleId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const changeOpen = (open: boolean) => { if (pendingRef.current) return; setError(null); if (!open) onTitleChange(''); onOpenChange(open); };
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || pendingRef.current) return;
    pendingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try { await onSubmit(trimmedTitle); onTitleChange(''); onOpenChange(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Der Inhalt konnte nicht erstellt werden.'); }
    finally { pendingRef.current = false; setIsSubmitting(false); }
  };
  return <Dialog open={isOpen} onOpenChange={changeOpen}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md" onEscapeKeyDown={event => { if (pendingRef.current) event.preventDefault(); }} onPointerDownOutside={event => { if (pendingRef.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Neues Unterthema</DialogTitle><DialogDescription>Titel für das Unterthema festlegen.</DialogDescription></DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4" aria-busy={isSubmitting}>
        <div className="space-y-2"><Label htmlFor={titleId}>Titel</Label><Input id={titleId} value={title} onChange={event => onTitleChange(event.target.value)} disabled={isSubmitting} required placeholder="Titel eingeben" /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => changeOpen(false)}>Abbrechen</Button><Button type="submit" disabled={isSubmitting || !title.trim()}>{isSubmitting ? 'Wird erstellt …' : 'Erstellen'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
