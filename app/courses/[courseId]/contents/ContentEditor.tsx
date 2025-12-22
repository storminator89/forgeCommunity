'use client'

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { CourseContent } from './types'
import { Editor } from "@/components/Editor"

interface ContentEditorProps {
  content: CourseContent
  onSave: (content: CourseContent) => void
  onCancel: () => void
}

export function ContentEditor({ content, onSave, onCancel }: ContentEditorProps) {
  const [editedContent, setEditedContent] = useState(content)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(editedContent)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {editedContent.type === 'TEXT' && (
          <div className="space-y-2">
            <Label htmlFor="textContent">Text Content</Label>
            <Editor
              content={editedContent.content as string}
              onChange={(value) => setEditedContent({ ...editedContent, content: value })}
              className="min-h-[200px]"
            />
          </div>
        )}

        {editedContent.type === 'VIDEO' && (
          <div className="space-y-2">
            <Label htmlFor="videoUrl">Video URL (YouTube)</Label>
            <Input
              id="videoUrl"
              type="url"
              value={editedContent.content as string}
              onChange={(e) => setEditedContent({ ...editedContent, content: e.target.value })}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
        )}

        {editedContent.type === 'AUDIO' && (
          <div className="space-y-2">
            <Label htmlFor="audioUrl">Audio URL</Label>
            <Input
              id="audioUrl"
              type="url"
              value={editedContent.content as string}
              onChange={(e) => setEditedContent({ ...editedContent, content: e.target.value })}
              placeholder="https://example.com/audio.mp3"
            />
          </div>
        )}

        {editedContent.type === 'H5P' && (
          <div className="space-y-2">
            <Label htmlFor="h5pContent">H5P Content ID</Label>
            <Input
              id="h5pContent"
              type="text"
              value={editedContent.content as string}
              onChange={(e) => setEditedContent({ ...editedContent, content: e.target.value })}
              placeholder="Enter H5P Content ID"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit">
          Speichern
        </Button>
      </div>
    </form>
  )
}
