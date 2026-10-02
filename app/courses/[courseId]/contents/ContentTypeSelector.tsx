'use client'

import { Button } from "@/components/ui/button"
import { FileText, Video, Music, Box, HelpCircle } from 'lucide-react'

interface ContentTypeSelectorProps {
  onSelectType: (type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ') => void
}

export function ContentTypeSelector({ onSelectType }: ContentTypeSelectorProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Button
        variant="outline"
        className="flex h-auto min-h-24 flex-col items-start whitespace-normal p-4 text-left hover:border-primary hover:bg-accent transition-colors"
        onClick={() => onSelectType('TEXT')}
      >
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-base font-medium">Text</span>
        </div>
        <p className="text-sm text-muted-foreground">Formatierter Text und Bilder.</p>
      </Button>

      <Button
        variant="outline"
        className="flex h-auto min-h-24 flex-col items-start whitespace-normal p-4 text-left hover:border-primary hover:bg-accent transition-colors"
        onClick={() => onSelectType('VIDEO')}
      >
        <div className="flex items-center gap-2 mb-2">
          <Video className="h-4 w-4 text-primary" />
          <span className="text-base font-medium">Video</span>
        </div>
        <p className="text-sm text-muted-foreground">Video per URL einbetten.</p>
      </Button>

      <Button
        variant="outline"
        className="flex h-auto min-h-24 flex-col items-start whitespace-normal p-4 text-left hover:border-primary hover:bg-accent transition-colors"
        onClick={() => onSelectType('AUDIO')}
      >
        <div className="flex items-center gap-2 mb-2">
          <Music className="h-4 w-4 text-primary" />
          <span className="text-base font-medium">Audio</span>
        </div>
        <p className="text-sm text-muted-foreground">Audiodatei per URL einbinden.</p>
      </Button>

      <Button
        variant="outline"
        className="flex h-auto min-h-24 flex-col items-start whitespace-normal p-4 text-left hover:border-primary hover:bg-accent transition-colors"
        onClick={() => onSelectType('H5P')}
      >
        <div className="flex items-center gap-2 mb-2">
          <Box className="h-4 w-4 text-primary" />
          <span className="text-base font-medium">H5P</span>
        </div>
        <p className="text-sm text-muted-foreground">Interaktive H5P-Inhalte.</p>
      </Button>

      <Button
        variant="outline"
        className="flex h-auto min-h-24 flex-col items-start whitespace-normal p-4 text-left hover:border-primary hover:bg-accent transition-colors"
        onClick={() => onSelectType('QUIZ')}
      >
        <div className="flex items-center gap-2 mb-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          <span className="text-base font-medium">Quiz</span>
        </div>
        <p className="text-sm text-muted-foreground">Fragen und Antworten erstellen.</p>
      </Button>
    </div>
  )
}
