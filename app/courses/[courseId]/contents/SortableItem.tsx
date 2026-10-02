'use client'

import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import type { CSSProperties, ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

interface SortableItemProps {
  id: string;
  children: ReactNode;
  label?: string;
  disabled?: boolean;
}

export function SortableItem({ id, children, label = 'Inhalt', disabled = false }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 10 : undefined };
  return <div ref={setNodeRef} style={style} className="flex min-w-0 items-start gap-2">
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
      aria-label={`${label} verschieben`} className="flex h-9 w-9 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}><GripVertical className="h-4 w-4" aria-hidden="true" /></button>
    <div className="min-w-0 flex-1">{children}</div>
  </div>;
}
