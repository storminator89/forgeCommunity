// app/projects/new/page.tsx

"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useSession } from 'next-auth/react';
import { toast } from 'react-toastify';

export default function NewProjectPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [link, setLink] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  if (status === 'loading') {
    return <p>Loading...</p>
  }

  if (status === 'unauthenticated') {
    router.push('/login')
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title || !description || !category || !link) {
      toast.error('Bitte fülle alle erforderlichen Felder aus.')
      return
    }

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          description,
          category,
          tags,
          link,
          imageUrl,
        })
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Fehler beim Einreichen des Projekts.')
      }

      toast.success('Projekt erfolgreich eingereicht!')
      router.push('/showcases')
    } catch (error: any) {
      console.error('Error submitting project:', error)
      toast.error(error.message || 'Fehler beim Einreichen des Projekts.')
    }
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md w-full max-w-2xl">
        <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-white">Neues Projekt einreichen</h2>
        <div className="mb-4">
          <Label htmlFor="title">Titel</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Projekt Titel"
            required
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="description">Beschreibung</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Projekt Beschreibung"
            required
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="category">Kategorie</Label>
          <Input
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Projekt Kategorie"
            required
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="tags">Tags</Label>
          <Input
            id="tags"
            value={tags.join(', ')}
            onChange={(e) => setTags(e.target.value.split(',').map(tag => tag.trim()))}
            placeholder="Trennen Sie Tags mit Kommas"
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="link">Projekt-Link</Label>
          <Input
            id="link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://github.com/..."
            required
          />
        </div>
        <div className="mb-6">
          <Label htmlFor="imageUrl">Vorschaubild URL</Label>
          <Input
            id="imageUrl"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
          />
        </div>
        <Button type="submit" className="w-full">
          Projekt einreichen
        </Button>
      </form>
    </div>
  )
}
