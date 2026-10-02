'use client';

import { useId, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { H5PContentItem, H5PSelectionDialog } from './H5PSelectionDialog';

interface H5PSourceFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export function H5PSourceField({ id, value, onChange, disabled = false, onBusyChange }: H5PSourceFieldProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<H5PContentItem | null>(null);
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>H5P-URL, ID oder Einbettungscode</Label>
      <Textarea id={fieldId} value={value} disabled={disabled} onChange={event => { setSelection(null); onChange(event.target.value); }} placeholder="https://…/embed/…" />
      <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>H5P auswählen oder hochladen</Button>{selection && (selection.id === value || value === `/h5p/embed/${selection.id}`) && <span role="status" className="text-sm text-muted-foreground">{selection.title}</span>}</div>
      <H5PSelectionDialog open={open} onOpenChange={setOpen} disabled={disabled} onBusyChange={onBusyChange} onSelect={item => { setSelection(item); onChange(`/h5p/embed/${item.id}`); }} />
    </div>
  );
}
