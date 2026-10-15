'use client';

import { Button } from '@/components/ui/button';
import { FileText, Video, Music, Box, HelpCircle, ClipboardPenLine } from 'lucide-react';
import { ContentType } from './content-form-utils';

interface ContentTypeSelectorProps {
  onSelectType: (type: ContentType) => void;
  selectedType?: ContentType;
  disabled?: boolean;
  showDescriptions?: boolean;
}

const types = [
  { type: 'TEXT', label: 'Text', description: 'Lesen und erklären', icon: FileText },
  { type: 'VIDEO', label: 'Video', description: 'Video einbetten', icon: Video },
  { type: 'AUDIO', label: 'Audio', description: 'Audio einbetten', icon: Music },
  { type: 'H5P', label: 'H5P', description: 'Interaktiv üben', icon: Box },
  { type: 'QUIZ', label: 'Quiz', description: 'Wissen prüfen', icon: HelpCircle },
  { type: 'ASSIGNMENT', label: 'Aufgabe', description: 'Text abgeben und bewerten', icon: ClipboardPenLine },
] as const;

export function ContentTypeSelector({ onSelectType, selectedType, disabled = false, showDescriptions = false }: ContentTypeSelectorProps) {
  return (
    <div role="group" aria-label="Inhaltstyp" className={`grid min-w-0 gap-2 ${showDescriptions ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
      {types.map(({ type, label, description, icon: Icon }) => (
        <Button key={type} type="button" variant="outline" disabled={disabled} aria-pressed={selectedType === type}
          aria-label={label} className={`min-w-0 justify-start gap-2 ${showDescriptions ? 'h-auto min-h-16 whitespace-normal px-3 py-3 text-left' : ''} ${selectedType === type ? 'border-primary bg-primary/5 text-primary' : ''}`} onClick={() => onSelectType(type)}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0"><span className="block whitespace-nowrap">{label}</span>{showDescriptions && <span className="mt-1 block text-xs font-normal text-muted-foreground">{description}</span>}</span>
        </Button>
      ))}
    </div>
  );
}
