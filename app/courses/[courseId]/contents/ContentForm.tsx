import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FileText, Video, Music, Box, HelpCircle } from 'lucide-react'
import { Editor } from '@/components/Editor'
import { QuizEditor } from './QuizEditor'
import { QuizContent } from './types'

interface ContentFormProps {
  onSubmit: (type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ', content: string) => Promise<void>
  mainContentId: string
}

export function ContentForm({ onSubmit, mainContentId }: ContentFormProps) {
  const [selectedType, setSelectedType] = useState<'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ' | null>(null)
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!selectedType) return
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

  const handleQuizSubmit = async (quizContent: QuizContent) => {
    setIsSubmitting(true)
    try {
      await onSubmit('QUIZ', JSON.stringify(quizContent))
      setSelectedType(null)
      setContent('')
    } catch (error) {
      console.error('Error submitting quiz:', error)
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
        <Button
          variant="outline"
          className="flex flex-col items-center justify-center h-32 space-y-2"
          onClick={() => setSelectedType('QUIZ')}
        >
          <HelpCircle className="h-8 w-8" />
          <span>Quiz</span>
        </Button>
      </div>
    )
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        {selectedType === 'QUIZ' ? (
          <QuizEditor onSave={handleQuizSubmit} />
        ) : selectedType === 'TEXT' ? (
          <Editor content={content} onChange={setContent} />
        ) : (
          <Input
            type="text"
            placeholder={
              selectedType === 'VIDEO'
                ? 'YouTube Video URL'
                : selectedType === 'AUDIO'
                ? 'Audio URL'
                : 'H5P Embed Code'
            }
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}

        {selectedType !== 'QUIZ' && (
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedType(null)
                setContent('')
              }}
              disabled={isSubmitting}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !content}
            >
              {isSubmitting ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
