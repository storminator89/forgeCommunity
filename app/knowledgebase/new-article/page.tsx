'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: article composer · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Upload, Loader2, Bookmark, Send, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";
import { toast } from 'sonner';
import { Editor } from "@/components/Editor";
import Link from 'next/link';

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
    if (status === 'loading') return;
    if (!session) return;
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
  }, [session, status]);

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
    setIsDraft(asDraft);
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

  if (status === 'loading' || (session && isLoading)) {
    return (
      <AppShell><Sidebar /><div className="flex min-h-0 min-w-0 flex-1 flex-col"><AppHeader><div><h1>Neuer Artikel</h1></div></AppHeader><main id="page-content" tabIndex={-1} className="flex min-h-0 flex-1 items-center justify-center p-4"><PageState kind="loading" title="Editor wird geladen" /></main></div></AppShell>
    );
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-3"><h1>Neuer Artikel</h1><div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div></div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">

              {!session ? <PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um einen Artikel zu schreiben." action={<Button asChild variant="outline"><Link href="/login">Zur Anmeldung</Link></Button>} /> : <>

              <div>
                <div className="mb-8 border-b pb-6">
                  <Button type="button" variant="ghost" size="sm" onClick={() => router.push('/knowledgebase')}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zur Übersicht</Button>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Wissen / Schreiben</p>
                  <p className="mt-2 max-w-[55ch] text-base leading-relaxed text-muted-foreground">Halte Erfahrungen und Anleitungen für die Community fest.</p>
                </div>
                {alert && <Alert variant={alert.type === 'error' ? 'destructive' : 'default'} className="mb-6" role={alert.type === 'error' ? 'alert' : 'status'}><AlertDescription>{alert.message}</AlertDescription></Alert>}
                <div className="grid min-w-0 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
                  <section aria-labelledby="new-article-content-title" className="min-w-0 border-t pt-5">
                    <h2 id="new-article-content-title" className="text-lg font-semibold tracking-tight">Artikelinhalt</h2>
                    <div className="mt-6">
                      <div className="space-y-8">
                        {/* Titel */}
                        <div className="border-b pb-7">
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
                        <div className="border-b pb-7">
                          <Label className="text-sm font-medium text-foreground mb-2 block">Beitragsbild</Label>
                          <div className="flex flex-wrap items-center gap-4">
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
                                <div className="w-20 h-20 rounded-lg overflow-hidden border border-border relative">
                                  <Image src={featuredImagePreview} alt="Vorschau" fill className="object-cover" />
                                  <div className="absolute inset-0 bg-background/80 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center z-10">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      aria-label="Beitragsbild entfernen"
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
                          <p className="mb-2 text-sm font-medium text-foreground">Inhalt</p>
                          <div className="overflow-hidden rounded-[10px] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                            <Editor
                              content={content}
                              onChange={setContent}
                              className="min-h-[400px]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <aside aria-label="Artikeloptionen" className="min-w-0 space-y-7">
                    <section className="border-t pt-5">
                      <h2 className="text-base font-semibold tracking-tight">Aktionen</h2>
                      <div className="mt-4 space-y-3">
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
                              <Bookmark className="mr-2 h-4 w-4" />
                              Als Entwurf speichern
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => submitArticle(false)}
                          disabled={isSubmitting}
                          type="button"
                          className="w-full justify-start"
                        >
                          {isSubmitting && !isDraft ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Veröffentliche...
                            </>
                          ) : (
                            <>
                              <Send className="mr-2 h-4 w-4" />
                              Veröffentlichen
                            </>
                          )}
                        </Button>
                      </div>
                    </section>

                    <section className="border-t pt-5">
                      <h2 className="text-base font-semibold tracking-tight">Kategorie</h2>
                      <div className="mt-4">
                        <CategorySelect
                          categories={existingCategories}
                          selectedCategory={category}
                          setSelectedCategory={setCategory}
                          onAddCategory={handleAddNewCategory}
                        />
                      </div>
                    </section>

                    <section className="border-t pt-5">
                      <h2 className="text-base font-semibold tracking-tight">Tags</h2>
                      <div className="mt-4">
                        <TagSelect
                          availableTags={existingTags}
                          selectedTags={tags}
                          onTagSelect={handleAddTag}
                          onTagRemove={handleRemoveTag}
                          onAddTag={handleAddNewTag}
                        />
                      </div>
                    </section>
                  </aside>
                </div>
              </div>
              </>}
            </div>
        </main>
      </div>
    </AppShell>
  );
}
