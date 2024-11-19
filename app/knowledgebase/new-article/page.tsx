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
import { BookOpen, ArrowLeft, Image, Upload, Loader2, BookmarkIcon, SendIcon, Trash2, Book, Tag } from 'lucide-react';
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
    <div className="flex flex-col lg:flex-row min-h-screen h-screen bg-gradient-to-br from-background to-background/80">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-card shadow-sm z-10 border-b backdrop-blur-sm">
          <div className="container mx-auto px-6 py-5">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  onClick={() => router.push('/knowledgebase')}
                  className="mr-4 hover:bg-background/60"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <h1 className="text-2xl font-semibold text-foreground tracking-tight">Neuer Artikel</h1>
                  <p className="text-sm text-muted-foreground mt-0.5">Erstelle einen neuen Wissensartikel</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <UserNav />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <ScrollArea className="h-full">
            <div className="container mx-auto py-8 px-6">
              <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-[1fr,300px] gap-6">
                  {/* Hauptbereich - Editor */}
                  <div className="space-y-6">
                    <div className="bg-card rounded-xl shadow-sm border border-border/40 overflow-hidden">
                      <div className="p-6 space-y-6">
                        {/* Titel */}
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <Label htmlFor="title" className="text-sm font-medium text-foreground">
                              Titel <span className="text-destructive">*</span>
                            </Label>
                            <span className="text-xs text-muted-foreground">
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

                        {/* Beitragsbild */}
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">Beitragsbild</Label>
                          <div className="flex items-center gap-4">
                            <Button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              variant="outline"
                              className="hover:bg-muted"
                            >
                              <Upload className="mr-2 h-4 w-4" />
                              Bild auswählen
                            </Button>
                            {featuredImagePreview && (
                              <div className="relative group">
                                <div className="w-20 h-20 rounded-lg overflow-hidden border border-border">
                                  <img src={featuredImagePreview} alt="Vorschau" className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive/90"
                                      onClick={() => {
                                        setFeaturedImage(null);
                                        setFeaturedImagePreview('');
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
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

                        {/* Editor */}
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">Inhalt</Label>
                          <div className="border rounded-lg overflow-hidden">
                            <QuillEditor
                              value={content}
                              onChange={setContent}
                              modules={quillModules}
                              className="min-h-[400px]"
                              theme="snow"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Seitenleiste - Metadaten */}
                  <div className="space-y-6">
                    {/* Aktionen */}
                    <div className="bg-card rounded-xl shadow-sm border border-border/40 overflow-hidden">
                      <div className="p-4 border-b border-border/40">
                        <h2 className="font-semibold text-lg flex items-center">
                          <BookOpen className="mr-2 h-5 w-5 text-primary" />
                          Aktionen
                        </h2>
                      </div>
                      <div className="p-4 space-y-3">
                        <Button
                          variant="outline"
                          onClick={() => submitArticle(true)}
                          disabled={isSubmitting}
                          type="button"
                          className="w-full justify-start"
                        >
                          {isSubmitting && isDraft ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Speichere...
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
                          className="w-full justify-start"
                        >
                          {isSubmitting && !isDraft ? (
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

                    {/* Kategorien */}
                    <div className="bg-card rounded-xl shadow-sm border border-border/40 overflow-hidden">
                      <div className="p-4 border-b border-border/40">
                        <h2 className="font-semibold text-lg flex items-center">
                          <Book className="mr-2 h-5 w-5 text-primary" />
                          Kategorie
                        </h2>
                      </div>
                      <div className="p-4">
                        <CategorySelect
                          categories={existingCategories}
                          selectedCategory={category}
                          setSelectedCategory={setCategory}
                          onAddCategory={handleAddNewCategory}
                        />
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="bg-card rounded-xl shadow-sm border border-border/40 overflow-hidden">
                      <div className="p-4 border-b border-border/40">
                        <h2 className="font-semibold text-lg flex items-center">
                          <Tag className="mr-2 h-5 w-5 text-primary" />
                          Tags
                        </h2>
                      </div>
                      <div className="p-4">
                        <TagSelect
                          availableTags={existingTags}
                          selectedTags={tags}
                          onTagSelect={handleAddTag}
                          onTagRemove={handleRemoveTag}
                          onAddTag={handleAddNewTag}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}