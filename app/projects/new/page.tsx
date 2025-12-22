"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from 'next-auth/react';
import { toast } from 'react-toastify';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Image from 'next/image';
import { Editor } from "@/components/Editor";

const CATEGORIES = [
  "Web Development",
  "Mobile App",
  "Desktop Application",
  "Machine Learning",
  "Data Science",
  "Game Development",
  "Other"
];

export default function NewProjectPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [currentTag, setCurrentTag] = useState('')
  const [link, setLink] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (status === 'loading') {
    return <p>Loading...</p>
  }

  if (status === 'unauthenticated') {
    router.push('/login')
    return null
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!title.trim()) newErrors.title = 'Titel ist erforderlich';
    if (description.length < 50) newErrors.description = 'Beschreibung muss mindestens 50 Zeichen lang sein';
    if (!category) newErrors.category = 'Kategorie ist erforderlich';
    if (!link.trim()) newErrors.link = 'Projekt-Link ist erforderlich';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddTag = () => {
    if (currentTag && !tags.includes(currentTag)) {
      setTags([...tags, currentTag]);
      setCurrentTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md w-full max-w-2xl space-y-6">
        <h2 className="text-3xl font-bold mb-8 text-gray-800 dark:text-white">Neues Projekt einreichen</h2>

        <div className="space-y-2">
          <Label htmlFor="title">Titel *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Mein Awesome Project"
            className={errors.title ? 'border-red-500' : ''}
          />
          {errors.title && <p className="text-red-500 text-sm">{errors.title}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Beschreibung *</Label>
          <div className="min-h-[300px] relative mb-12">
            <Editor
              content={description}
              onChange={setDescription}
              className="min-h-[250px]"
            />
          </div>
          {errors.description && (
            <p className="text-red-500 text-sm">{errors.description}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Kategorie *</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className={errors.category ? 'border-red-500' : ''}>
              <SelectValue placeholder="Wähle eine Kategorie" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category && <p className="text-red-500 text-sm">{errors.category}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tags">Tags</Label>
          <div className="flex gap-2">
            <Input
              id="tags"
              value={currentTag}
              onChange={(e) => setCurrentTag(e.target.value)}
              placeholder="Neuen Tag eingeben"
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
            />
            <Button type="button" onClick={handleAddTag} variant="secondary">
              +
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full flex items-center gap-2"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="link">Projekt-Link *</Label>
          <Input
            id="link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://github.com/..."
            className={errors.link ? 'border-red-500' : ''}
          />
          {errors.link && <p className="text-red-500 text-sm">{errors.link}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="imageUrl">Vorschaubild URL</Label>
          <Input
            id="imageUrl"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
          />
          {imageUrl && (
            <div className="mt-2 relative w-full h-48 rounded-lg overflow-hidden">
              <Image
                src={imageUrl}
                alt="Vorschau"
                fill
                className="object-cover"
                onError={(e) => e.currentTarget.src = '/placeholder-image.jpg'}
              />
            </div>
          )}
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Wird eingereicht...' : 'Projekt einreichen'}
        </Button>
      </form>
    </div>
  );
}
