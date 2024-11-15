'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BookOpen, ArrowLeft, Image, Upload, Loader2, BookmarkIcon, SendIcon } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";
import { toast } from 'sonner';

const QuillEditor = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

export default function NewArticle() {
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
  const [alert, setAlert] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const maxTitleLength = 100;
  
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
    }
  }, [session, status, router]);

  useEffect(() => {
    const fetchCategoriesAndTags = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/articles/categories-and-tags');
        if (response.ok) {
          const data = await response.json();
          setExistingCategories(data.categories || []);
          setExistingTags(data.tags || []);
        } else {
          console.error('Failed to fetch categories and tags');
          setExistingCategories([]);
          setExistingTags([]);
        }
      } catch (error) {
        console.error('Error fetching categories and tags:', error);
        setExistingCategories([]);
        setExistingTags([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCategoriesAndTags();
  }, []);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag]);
    } else if (tags.length >= 5) {
      setAlert({ message: 'Maximal 5 Tags erlaubt.', type: 'error' });
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleAddNewTag = (newTag: string) => {
    if (!existingTags.includes(newTag)) {
      setExistingTags([...existingTags, newTag]);
    }
    handleAddTag(newTag);
  };

  const handleAddNewCategory = (newCategory: string) => {
    if (!existingCategories.includes(newCategory)) {
      setExistingCategories([...existingCategories, newCategory]);
    }
    setCategory(newCategory);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFeaturedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFeaturedImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const submitArticle = async (asDraft: boolean) => {
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
    formData.append('isPublished', (!asDraft).toString()); // Geändert: isPublished ist das Gegenteil von asDraft
    tags.forEach(tag => formData.append('tags', tag));
    if (featuredImage) {
      formData.append('featuredImage', featuredImage);
    }
  
    try {
      const response = await fetch('/api/articles', {
        method: 'POST',
        body: formData,
      });
  
      if (response.ok) {
        const article = await response.json();
        toast.success(
          asDraft 
            ? 'Artikel wurde als Entwurf gespeichert!' 
            : 'Artikel wurde erfolgreich veröffentlicht!'
        );
        // Kurze Verzögerung für bessere UX
        setTimeout(() => router.push(
          asDraft 
            ? '/knowledgebase/drafts' // Neue Route für Entwürfe
            : `/knowledgebase/${article.id}`
        ), 1000);
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Speichern.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitArticle(false);
  };

  const handleSaveDraft = async () => {
    await submitArticle(true);
  };

  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{'list': 'ordered'}, {'list': 'bullet'}],
      ['link', 'image'],
      ['clean']
    ],
    clipboard: {
      matchVisual: false // Prevents the deprecated mutation events
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center">
              <BookOpen className="mr-2 h-6 w-6" />
              Neuer Artikel erstellen
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
                  onClick={() => router.push('/knowledgebase')}
                  className="bg-transparent border-gray-300 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => submitArticle(true)}
                    disabled={isSubmitting}
                    type="button"
                  >
                    {isSubmitting && isDraft ? (
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
                    onClick={() => submitArticle(false)}
                    disabled={isSubmitting}
                    type="submit"
                  >
                    {isSubmitting && !isDraft ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Veröffentliche...
                      </>
                    ) : (
                      <>
                        <SendIcon className="mr-2 h-4 w-4" />
                        Jetzt veröffentlichen
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <form id="articleForm" onSubmit={handleSubmit} className="space-y-6">
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
                      className="flex items-center"
                      variant="outline"
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Bild auswählen
                    </Button>
                    {featuredImagePreview && (
                      <div className="relative group">
                        <div className="w-20 h-20 border rounded-md overflow-hidden">
                          <img src={featuredImagePreview} alt="Vorschau" className="w-full h-full object-cover" />
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
                      id="featuredImage"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content" className="text-xl font-semibold">Inhalt</Label>
                  <div className="h-96 border rounded-md overflow-hidden">
                    <QuillEditor
                      value={content}
                      onChange={setContent}
                      modules={quillModules}
                      className="h-full"
                      theme="snow"
                    />
                  </div>
                </div>
                <div className="space-y-2 mt-12">
                  <CategorySelect
                    categories={existingCategories}
                    selectedCategory={category}
                    setSelectedCategory={setCategory}
                    onAddCategory={handleAddNewCategory}
                  />
                </div>
                <div className="space-y-2">
                  <TagSelect
                    availableTags={existingTags}
                    selectedTags={tags}
                    onTagSelect={handleAddTag}
                    onTagRemove={handleRemoveTag}
                    onAddTag={handleAddNewTag}
                  />
                </div>
                <Separator className="my-6" />
                <div className="flex justify-end">
                  <Button type="submit" disabled={isSubmitting} className="px-6 py-2 text-lg">
                    {isSubmitting ? 'Wird erstellt...' : 'Artikel veröffentlichen'}
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}