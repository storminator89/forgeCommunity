'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import { useEffect, useCallback } from 'react'
import { Toggle } from "@/components/ui/toggle"
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Undo,
  Redo,
  Code,
  Link as LinkIcon,
  ImageIcon,
} from 'lucide-react'

interface EditorProps {
  content: string | null | undefined
  onChange: (content: string) => void
  placeholder?: string
  className?: string
  readOnly?: boolean
}

const MenuBar = ({ editor }: { editor: any }) => {
  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    if (url === null) {
      return
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const addImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('Bild URL')

    if (url) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor])

  if (!editor) {
    return null
  }

  return (
    <div className="border-b border-input bg-transparent p-1 flex flex-wrap gap-1">
      <Toggle
        size="sm"
        pressed={editor.isActive('bold')}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        data-testid="toggle-button"
      >
        <Bold className="h-4 w-4" data-testid="bold-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('italic')}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        data-testid="toggle-button"
      >
        <Italic className="h-4 w-4" data-testid="italic-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('underline')}
        onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
        data-testid="toggle-button"
      >
        <UnderlineIcon className="h-4 w-4" data-testid="underline-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('strike')}
        onPressedChange={() => editor.chain().focus().toggleStrike().run()}
        data-testid="toggle-button"
      >
        <Strikethrough className="h-4 w-4" data-testid="strikethrough-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 2 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        data-testid="toggle-button"
      >
        <Heading2 className="h-4 w-4" data-testid="heading-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('bulletList')}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
        data-testid="toggle-button"
      >
        <List className="h-4 w-4" data-testid="bullet-list-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('orderedList')}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
        data-testid="toggle-button"
      >
        <ListOrdered className="h-4 w-4" data-testid="ordered-list-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('blockquote')}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
        data-testid="toggle-button"
      >
        <Quote className="h-4 w-4" data-testid="quote-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('code')}
        onPressedChange={() => editor.chain().focus().toggleCode().run()}
        data-testid="toggle-button"
      >
        <Code className="h-4 w-4" data-testid="code-icon" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('link')}
        onPressedChange={setLink}
        data-testid="toggle-button"
      >
        <LinkIcon className="h-4 w-4" data-testid="link-icon" />
      </Toggle>
      <Toggle
        size="sm"
        onPressedChange={addImage}
        data-testid="toggle-button"
      >
        <ImageIcon className="h-4 w-4" data-testid="image-icon" />
      </Toggle>
      <Toggle
        size="sm"
        onPressedChange={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        data-testid="toggle-button"
      >
        <Undo className="h-4 w-4" data-testid="undo-icon" />
      </Toggle>
      <Toggle
        size="sm"
        onPressedChange={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        data-testid="toggle-button"
      >
        <Redo className="h-4 w-4" data-testid="redo-icon" />
      </Toggle>
    </div>
  )
}

export function Editor({
  content,
  onChange,
  placeholder = 'Beginnen Sie hier mit der Eingabe...',
  className = '',
  readOnly = false
}: EditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline cursor-pointer',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-md',
        },
      }),
      Underline,
    ],
    content: content || '',
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'min-h-[150px] w-full rounded-md bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 prose prose-sm dark:prose-invert max-w-none',
        'data-testid': 'editor-content',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || '')
    }
  }, [content, editor])

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly)
    }
  }, [readOnly, editor])

  return (
    <div className={`w-full border rounded-md border-input bg-background ${className}`}>
      {!readOnly && <MenuBar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}

