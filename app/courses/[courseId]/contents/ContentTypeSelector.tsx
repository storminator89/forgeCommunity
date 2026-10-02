'use client';

import { Button } from '@/components/ui/button';
import { FileText, Video, Music, Box, HelpCircle } from 'lucide-react';
import { ContentType } from './content-form-utils';

interface ContentTypeSelectorProps {
  onSelectType: (type: ContentType) => void;
  selectedType?: ContentType;
  disabled?: boolean;
}

const types = [
  { type: 'TEXT', label: 'Text', icon: FileText },
  { type: 'VIDEO', label: 'Video', icon: Video },
  { type: 'AUDIO', label: 'Audio', icon: Music },
  { type: 'H5P', label: 'H5P', icon: Box },
  { type: 'QUIZ', label: 'Quiz', icon: HelpCircle },
] as const;

export function ContentTypeSelector({ onSelectType, selectedType, disabled = false }: ContentTypeSelectorProps) {
  return (
    <div role="group" aria-label="Inhaltstyp" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {types.map(({ type, label, icon: Icon }) => (
        <Button key={type} type="button" variant="outline" disabled={disabled} aria-pressed={selectedType === type}
          className={`justify-start gap-2 ${selectedType === type ? 'border-primary bg-primary/5 text-primary' : ''}`} onClick={() => onSelectType(type)}>
          <Icon className="h-4 w-4" aria-hidden="true" />{label}
        </Button>
      ))}
    </div>
  );
}
