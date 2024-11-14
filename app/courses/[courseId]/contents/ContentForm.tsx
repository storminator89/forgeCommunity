import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FileText, Video, Music, Box } from 'lucide-react'
import { Editor } from '@/components/Editor'

interface ContentFormProps {
  onSubmit: (type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P', content: string) => Promise<void>
  mainContentId: string
}

export function ContentForm({ onSubmit, mainContentId }: ContentFormProps) {
  const [selectedType, setSelectedType] = useState<'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | null>(null)
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!selectedType || !content) return
    setIsSubmitting(true)
    try {
      await onSubmit(selectedType, content)
      setSelectedType(null)
      setContent('')
    } catch (error) {
      console.error('Error submitting content:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!selectedType) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Button
          variant="outline"
          className="flex flex-col items-center justify-center h-32 space-y-2"
          onClick={() => setSelectedType('TEXT')}
        >
          <FileText className="h-8 w-8" />
          <span>Text</span>
        </Button>
        <Button
          variant="outline"
          className="flex flex-col items-center justify-center h-32 space-y-2"
          onClick={() => setSelectedType('VIDEO')}
        >
          <Video className="h-8 w-8" />
          <span>Video</span>
        </Button>
        <Button
          variant="outline"
          className="flex flex-col items-center justify-center h-32 space-y-2"
          onClick={() => setSelectedType('AUDIO')}
        >
          <Music className="h-8 w-8" />
          <span>Audio</span>
        </Button>
        <Button
          variant="outline"
          className="flex flex-col items-center justify-center h-32 space-y-2"
          onClick={() => setSelectedType('H5P')}
        >
          <Box className="h-8 w-8" />
          <span>H5P</span>
        </Button>
      </div>
    )
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        {selectedType === 'TEXT' ? (
          <Editor content={content} onChange={setContent} />
        ) : (
          <Input
            type="url"
            placeholder={
              selectedType === 'VIDEO' ? 'YouTube URL eingeben' :
              selectedType === 'AUDIO' ? 'Audio URL eingeben' :
              'H5P Content ID oder URL eingeben'
            }
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}
        <div className="flex justify-end space-x-2">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedType(null)
              setContent('')
            }}
          >
            Abbrechen
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!content || isSubmitting}
          >
            {isSubmitting ? 'Speichern...' : 'Speichern'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
