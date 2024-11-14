'use client'

import { Button } from "@/components/ui/button"
import { FileText, Video, Music, Box } from 'lucide-react'

interface ContentTypeSelectorProps {
  onSelectType: (type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P') => void
}

export function ContentTypeSelector({ onSelectType }: ContentTypeSelectorProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Button
        variant="outline"
        className="flex flex-col items-center p-6 hover:border-primary"
        onClick={() => onSelectType('TEXT')}
      >
        <FileText className="h-8 w-8 mb-2" />
        <span>Text</span>
      </Button>
      
      <Button
        variant="outline"
        className="flex flex-col items-center p-6 hover:border-primary"
        onClick={() => onSelectType('VIDEO')}
      >
        <Video className="h-8 w-8 mb-2" />
        <span>Video</span>
      </Button>
      
      <Button
        variant="outline"
        className="flex flex-col items-center p-6 hover:border-primary"
        onClick={() => onSelectType('AUDIO')}
      >
        <Music className="h-8 w-8 mb-2" />
        <span>Audio</span>
      </Button>
      
      <Button
        variant="outline"
        className="flex flex-col items-center p-6 hover:border-primary"
        onClick={() => onSelectType('H5P')}
      >
        <Box className="h-8 w-8 mb-2" />
        <span>H5P</span>
      </Button>
    </div>
  )
}
