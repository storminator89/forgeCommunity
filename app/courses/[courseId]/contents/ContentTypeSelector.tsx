'use client'

import { Button } from "@/components/ui/button"
import { FileText, Video, Music, Box, HelpCircle } from 'lucide-react'

interface ContentTypeSelectorProps {
  onSelectType: (type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ') => void
}

export function ContentTypeSelector({ onSelectType }: ContentTypeSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Button
        variant="outline"
        className="flex flex-col items-start h-40 p-6 hover:border-primary hover:bg-accent/50 transition-all group relative overflow-hidden"
        onClick={() => onSelectType('TEXT')}
      >
        <div className="flex items-center gap-3 mb-4">
          <FileText className="h-8 w-8 text-primary transition-transform group-hover:scale-110" />
          <span className="text-lg font-semibold">Text</span>
        </div>
        <p className="text-sm text-muted-foreground">Create rich text content with formatting, images, and more.</p>
      </Button>

      <Button
        variant="outline"
        className="flex flex-col items-start h-40 p-6 hover:border-primary hover:bg-accent/50 transition-all group relative overflow-hidden"
        onClick={() => onSelectType('VIDEO')}
      >
        <div className="flex items-center gap-3 mb-4">
          <Video className="h-8 w-8 text-primary transition-transform group-hover:scale-110" />
          <span className="text-lg font-semibold">Video</span>
        </div>
        <p className="text-sm text-muted-foreground">Upload or embed videos from YouTube and other platforms.</p>
      </Button>

      <Button
        variant="outline"
        className="flex flex-col items-start h-40 p-6 hover:border-primary hover:bg-accent/50 transition-all group relative overflow-hidden"
        onClick={() => onSelectType('AUDIO')}
      >
        <div className="flex items-center gap-3 mb-4">
          <Music className="h-8 w-8 text-primary transition-transform group-hover:scale-110" />
          <span className="text-lg font-semibold">Audio</span>
        </div>
        <p className="text-sm text-muted-foreground">Add audio content, podcasts, or music to your course.</p>
      </Button>

      <Button
        variant="outline"
        className="flex flex-col items-start h-40 p-6 hover:border-primary hover:bg-accent/50 transition-all group relative overflow-hidden"
        onClick={() => onSelectType('H5P')}
      >
        <div className="flex items-center gap-3 mb-4">
          <Box className="h-8 w-8 text-primary transition-transform group-hover:scale-110" />
          <span className="text-lg font-semibold">H5P</span>
        </div>
        <p className="text-sm text-muted-foreground">Create interactive content with H5P&apos;s rich set of tools.</p>
      </Button>

      <Button
        variant="outline"
        className="flex flex-col items-start h-40 p-6 hover:border-primary hover:bg-accent/50 transition-all group relative overflow-hidden"
        onClick={() => onSelectType('QUIZ')}
      >
        <div className="flex items-center gap-3 mb-4">
          <HelpCircle className="h-8 w-8 text-primary transition-transform group-hover:scale-110" />
          <span className="text-lg font-semibold">Quiz</span>
        </div>
        <p className="text-sm text-muted-foreground">Create assessments and quizzes to test knowledge.</p>
      </Button>
    </div>
  )
}
