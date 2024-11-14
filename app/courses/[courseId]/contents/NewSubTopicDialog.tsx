'use client'

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface NewSubTopicDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (title: string) => Promise<void>
  title: string
  onTitleChange: (title: string) => void
}

export function NewSubTopicDialog({
  isOpen,
  onOpenChange,
  onSubmit,
  title,
  onTitleChange,
}: NewSubTopicDialogProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await onSubmit(title)
      onTitleChange('')
      onOpenChange(false)
    } catch (error) {
      console.error('Error creating subtopic:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button className="hidden"></button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neues Unterthema erstellen</DialogTitle>
          <DialogDescription>
            Geben Sie einen Titel für das neue Unterthema ein.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Titel des Unterthemas"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={!title || title.trim().length === 0 || isSubmitting}
            >
              {isSubmitting ? "Wird erstellt..." : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
