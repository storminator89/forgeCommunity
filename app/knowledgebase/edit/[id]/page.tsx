'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { BookOpen, ArrowLeft, Upload, Loader2, BookmarkIcon, SendIcon } from 'lucide-react';
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";
import { toast } from 'sonner';
import { Editor } from "@/components/Editor";

export default function EditArticle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [featuredImagePreview, setFeaturedImagePreview] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const maxTitleLength = 100;

  useEffect(() => {
    if (!session) {
      router.push('/login');
      return;
    }

    const fetchArticle = async () => {
      setIsLoading(true);
      try {
        console.log('Fetching article with ID:', id); // Debug log

        const [articleResponse, categoriesResponse] = await Promise.all([
          fetch(`/api/articles/${id}`),
          fetch('/api/articles/categories-and-tags')
        ]);

        if (!articleResponse.ok) {
          throw new Error(`Article fetch failed: ${articleResponse.statusText}`);
        }

        const article = await articleResponse.json();
        console.log('Fetched article:', article); // Debug log

        if (!article) {
          toast.error('Artikel nicht gefunden');
          router.push('/knowledgebase/drafts');
          return;
        }

        setTitle(article.title);
        setContent(article.content);
        setCategory(article.category);
        setTags(article.tags.map((tag: { name: string }) => tag.name));
        if (article.featuredImage) {
          setFeaturedImagePreview(article.featuredImage);
        }

        // Kategorien und Tags setzen
        if (categoriesResponse.ok) {
          const { categories, tags } = await categoriesResponse.json();
          setExistingCategories(categories);
          setExistingTags(tags);
        }
      } catch (error) {
        console.error('Error fetching article:', error);
        toast.error('Fehler beim Laden des Artikels');
        router.push('/knowledgebase/drafts');
      } finally {
        setIsLoading(false);
      }
    };

    fetchArticle();
  }, [id, session, router]);

  const handleSubmit = async (asDraft: boolean) => {
    setIsSubmitting(true);

    if (!title || !content || !category) {
      toast.error('Bitte füllen Sie alle erforderlichen Felder aus.');
      setIsSubmitting(false);
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);
    formData.append('category', category);
    formData.append('isPublished', (!asDraft).toString());
    tags.forEach(tag => formData.append('tags', tag));
    if (featuredImage) {
      formData.append('featuredImage', featuredImage);
    }

    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'PUT',
        body: formData,
      });

      if (response.ok) {
        const article = await response.json();
        toast.success(
          asDraft
            ? 'Entwurf wurde aktualisiert!'
            : 'Artikel wurde erfolgreich aktualisiert!'
        );
        router.push(asDraft ? '/knowledgebase/drafts' : `/knowledgebase/${article.id}`);
      } else {
        throw new Error('Fehler beim Aktualisieren');
      }
    } catch (error) {
      toast.error('Fehler beim Speichern des Artikels');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Rest der Komponentenlogik (handleImageUpload, handleAddTag, etc.) wie in new-article/page.tsx

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Der Rest des JSX ist sehr ähnlich wie in new-article/page.tsx
  // Nur der Titel und die Buttons sollten angepasst werden

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center">
              <BookOpen className="mr-2 h-6 w-6" />
              Artikel bearbeiten
            </h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Card className="max-w-5xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <div className="p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <Button
                  variant="outline"
                  onClick={() => router.push('/knowledgebase/drafts')}
                  className="bg-transparent border-gray-300 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleSubmit(true)}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Speichere Entwurf...
                      </>
                    ) : (
                      <>
                        <BookmarkIcon className="mr-2 h-4 w-4" />
                        Als Entwurf speichern
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => handleSubmit(false)}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Veröffentliche...
                      </>
                    ) : (
                      <>
                        <SendIcon className="mr-2 h-4 w-4" />
                        Veröffentlichen
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="title" className="text-lg font-semibold">
                      Titel <span className="text-red-500">*</span>
                    </Label>
                    <span className="text-sm text-gray-500">
                      {title.length}/{maxTitleLength}
                    </span>
                  </div>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, maxTitleLength))}
                    className="text-lg py-2"
                    placeholder="Geben Sie einen aussagekräftigen Titel ein"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="featuredImage" className="text-lg font-semibold">
                    Beitragsbild
                  </Label>
                  <div className="flex items-center gap-4">
                    <Button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      variant="outline"
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Bild auswählen
                    </Button>
                    {featuredImagePreview && (
                      <div className="relative group">
                        <div className="w-20 h-20 border rounded-md overflow-hidden">
                          <Image
                            src={featuredImagePreview}
                            alt="Vorschau"
                            fill
                            className="object-cover"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => {
                            setFeaturedImage(null);
                            setFeaturedImagePreview('');
                          }}
                        >
                          ×
                        </Button>
                      </div>
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setFeaturedImage(file);
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setFeaturedImagePreview(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content" className="text-lg font-semibold">
                    Inhalt <span className="text-red-500">*</span>
                  </Label>
                  <div className="min-h-[400px] border rounded-md">
                    <Editor
                      content={content}
                      onChange={setContent}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <CategorySelect
                    categories={existingCategories}
                    selectedCategory={category}
                    setSelectedCategory={setCategory}
                    onAddCategory={(newCategory) => {
                      setExistingCategories([...existingCategories, newCategory]);
                      setCategory(newCategory);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <TagSelect
                    availableTags={existingTags}
                    selectedTags={tags}
                    onTagSelect={(tag) => {
                      if (!tags.includes(tag)) {
                        setTags([...tags, tag]);
                      }
                    }}
                    onTagRemove={(tag) => {
                      setTags(tags.filter((t) => t !== tag));
                    }}
                    onAddTag={(newTag) => {
                      setExistingTags([...existingTags, newTag]);
                      setTags([...tags, newTag]);
                    }}
                  />
                </div>
              </div>
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}
