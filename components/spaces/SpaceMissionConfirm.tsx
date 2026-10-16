'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function SpaceMissionConfirm({ label, description, onConfirm, disabled = false }: {
  label: string; description: string; onConfirm: () => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled}>{label}</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{label}?</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter className="gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button><Button type="button" onClick={() => { setOpen(false); onConfirm(); }}>{label}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
