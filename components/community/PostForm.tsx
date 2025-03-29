import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from 'lucide-react'
import dynamic from 'next/dynamic'
import { Skeleton } from "@/components/ui/skeleton"
import { motion } from 'framer-motion'

const ReactQuill = dynamic(() => import('react-quill'), {
  ssr: false,
  loading: () => <Skeleton className="h-[200px]" />
})

interface PostFormProps {
  onSubmit: (title: string, content: string) => Promise<void>
  initialTitle?: string
  initialContent?: string
  isEditing?: boolean
  isLoading?: boolean
  onCancel?: () => void
}

const EDITOR_MODULES = {
  toolbar: [
    [{ 'header': [1, 2, false] }],
    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
    ['link', 'image'],
    ['clean']
  ],
}

const EDITOR_FORMATS = [
  'header',
  'bold', 'italic', 'underline', 'strike', 'blockquote',
  'list', 'bullet', 'indent',
  'link', 'image'
]

export function PostForm({ 
  onSubmit, 
  initialTitle = '', 
  initialContent = '', 
  isEditing = false,
  isLoading = false,
  onCancel
}: PostFormProps) {
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState(initialContent)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(title, content)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6 bg-background dark:bg-gray-800 p-8 rounded-lg shadow-lg transition-colors duration-300"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <Label htmlFor="title" className="block text-sm font-medium text-foreground">Titel</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Gib deinem Beitrag einen Titel"
            required
            disabled={isLoading}
            className={`mt-1 block w-full p-3 border ${
              !title ? 'border-red-500' : 'border-border'
            } rounded-md shadow-sm focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 transition-colors duration-200`}
          />
          {!title && (
            <span className="text-red-500 text-xs">
              Titel ist erforderlich.
            </span>
          )}
        </div>

        <div>
          <Label htmlFor="content" className="block text-sm font-medium text-foreground">Inhalt</Label>
          <ReactQuill
            theme="snow"
            value={content}
            onChange={setContent}
            placeholder="Was möchtest du mitteilen?"
            modules={EDITOR_MODULES}
            formats={EDITOR_FORMATS}
            readOnly={isLoading}
            className="mt-1"
          />
        </div>

        <div className="flex justify-end space-x-4">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="px-4 py-2 border border-border rounded-md text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
            >
              Abbrechen
            </Button>
          )}
          <Button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark flex items-center transition-transform transform active:scale-95 duration-200"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Wird verarbeitet...
              </>
            ) : (
              isEditing ? 'Beitrag aktualisieren' : 'Beitrag veröffentlichen'
            )}
          </Button>
        </div>
      </form>
    </motion.div>
  )
}