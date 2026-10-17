import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from 'lucide-react'
import { Editor } from "@/components/Editor"
import { PostTopicPicker } from './PostTopicPicker'

interface PostFormProps {
  onSubmit: (title: string, content: string, tags: string[]) => Promise<void>
  initialTitle?: string
  initialContent?: string
  initialTags?: string[]
  isEditing?: boolean
  isLoading?: boolean
  onCancel?: () => void
}

export function PostForm({
  onSubmit,
  initialTitle = '',
  initialContent = '',
  initialTags = [],
  isEditing = false,
  isLoading = false,
  onCancel
}: PostFormProps) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)
  const [tags, setTags] = useState(initialTags)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(title, content, tags)
  }

  return (
    <div className="rounded-[14px] border border-input bg-card p-4 sm:p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <Label htmlFor="title" className="block text-sm font-medium text-foreground">Titel</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={isLoading}
            className="mt-2"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Inhalt</p>
          <Editor
            content={content}
            onChange={setContent}
            readOnly={isLoading}
            className="focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
          />
        </div>

        <PostTopicPicker value={tags} onChange={setTags} disabled={isLoading} />

        <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Abbrechen
            </Button>
          )}
          <Button
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Wird verarbeitet…
              </>
            ) : (
              isEditing ? 'Beitrag aktualisieren' : 'Beitrag veröffentlichen'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
