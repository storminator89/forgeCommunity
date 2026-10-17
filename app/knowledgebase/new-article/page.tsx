'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: article composer · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/sites-auth/react';
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
import { Toaster } from '@/components/ui/sonner';
import { Editor } from "@/components/Editor";
import Link from 'next/link';

export default function NewArticle() {
  const { data: session, status } = useSession();
  const accountId = status === 'authenticated' ? session?.user?.id ?? null : null;
  return <AccountNewArticle key={accountId ?? 'anonymous'} accountId={accountId} status={status} />;
}

function AccountNewArticle({ accountId, status }: { accountId: string | null; status: 'loading' | 'authenticated' | 'unauthenticated' }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const categoryFieldRef = useRef<HTMLDivElement>(null);
  const contentFieldRef = useRef<HTMLDivElement>(null);
  const submissionInFlight = useRef(false);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [featuredImagePreview, setFeaturedImagePreview] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alert, setAlert] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const maxTitleLength = 100;
  const titleMissing = !title.trim();
  const contentMissing = !content.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim() && !/<img\b/i.test(content);
  const categoryMissing = !category.trim();

  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;
    if (!accountId) {
      router.push('/login');
    }
  }, [accountId, status, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !accountId) return;
    const controller = new AbortController();
    const fetchCategoriesAndTags = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/articles/categories-and-tags', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.ok) {
          const data = await response.json();
          if (controller.signal.aborted) return;
          setExistingCategories(data.categories || []);
          setExistingTags(data.tags || []);
        } else {
          console.error('Failed to fetch categories and tags');
          setExistingCategories([]);
          setExistingTags([]);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Error fetching categories and tags:', error);
        setExistingCategories([]);
        setExistingTags([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void fetchCategoriesAndTags();
    return () => controller.abort();
  }, [accountId, status]);

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
    if (submissionInFlight.current) return;
    setHasSubmitted(true);

    if (titleMissing || contentMissing || categoryMissing) {
      if (titleMissing) titleInputRef.current?.focus();
      else if (categoryMissing) categoryFieldRef.current?.querySelector<HTMLElement>('input, select')?.focus();
      else contentFieldRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
      return;
    }
    submissionInFlight.current = true;
    setIsDraft(asDraft);
    setIsSubmitting(true);

    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);
    formData.append('category', category);
    formData.append('isPublished', (!asDraft).toString()); // Geändert: isPublished ist das Gegenteil von asDraft
    tags.forEach(tag => formData.append('tags', tag));
    if (featuredImage) {
      formData.append('featuredImage', featuredImage);
    }

    let saved = false;
    try {
      const response = await fetch('/api/articles', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const article = await response.json();
        saved = true;
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
      if (!saved) {
        submissionInFlight.current = false;
        setIsSubmitting(false);
      }
    }
  };

  if (status === 'loading' || (accountId && isLoading)) {
    return (
      <AppShell><Sidebar /><div className="flex min-h-0 min-w-0 flex-1 flex-col"><AppHeader><div className="app-header-row"><h1 className="app-header-title">Neuer Artikel</h1></div></AppHeader><main id="page-content" tabIndex={-1} className="flex min-h-0 flex-1 items-center justify-center p-4"><PageState kind="loading" title="Editor wird geladen" /></main></div></AppShell>
    );
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row"><h1 className="app-header-title">Neuer Artikel</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">

              {!accountId ? <PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um einen Artikel zu schreiben." action={<Button asChild variant="outline"><Link href="/login">Zur Anmeldung</Link></Button>} /> : <>

              <div className="fc-editor-surface">
                <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => router.push('/knowledgebase')}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zur Übersicht</Button>
                  <div role="group" aria-label="Artikel speichern oder veröffentlichen" className="grid gap-2 sm:flex sm:gap-3">
                    <Button
                      variant="outline"
                      onClick={() => submitArticle(true)}
                      disabled={isSubmitting}
                      type="button"
                      className="w-full sm:w-auto"
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
                      className="w-full sm:w-auto"
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
                </div>
                <p id="new-article-required-fields" className="mt-4 text-sm text-muted-foreground">Pflichtangaben: Titel, Inhalt und Kategorie.</p>
                {alert && <Alert variant={alert.type === 'error' ? 'destructive' : 'default'} className="mt-4" role={alert.type === 'error' ? 'alert' : 'status'}><AlertDescription>{alert.message}</AlertDescription></Alert>}
                <div className="mt-5 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8" role="group" aria-label="Pflichtangaben" aria-describedby="new-article-required-fields">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Label htmlFor="title" className="text-sm font-medium text-foreground">Titel</Label>
                      <span id="new-article-title-count" className="text-xs tabular-nums text-muted-foreground">{title.length}/{maxTitleLength}</span>
                    </div>
                    <Input
                      id="title"
                      ref={titleInputRef}
                      value={title}
                      onChange={(e) => setTitle(e.target.value.slice(0, maxTitleLength))}
                      className="text-lg py-2"
                      placeholder="Ein aussagekräftiger Titel"
                      aria-invalid={hasSubmitted && titleMissing}
                      aria-describedby={`new-article-required-fields new-article-title-count${hasSubmitted && titleMissing ? ' new-article-title-error' : ''}`}
                      required
                    />
                    {hasSubmitted && titleMissing && <p id="new-article-title-error" role="alert" className="mt-2 text-sm text-destructive">Gib einen Titel für deinen Artikel ein.</p>}
                  </div>
                  <div ref={categoryFieldRef} className="min-w-0">
                    <CategorySelect
                      categories={existingCategories}
                      selectedCategory={category}
                      setSelectedCategory={setCategory}
                      onAddCategory={handleAddNewCategory}
                      error={hasSubmitted && categoryMissing ? 'Wähle eine Kategorie oder erstelle eine neue Kategorie.' : undefined}
                    />
                  </div>
                </div>
                <section aria-labelledby="new-article-content-title" aria-describedby="new-article-required-fields" className="mt-6 min-w-0">
                  <h2 id="new-article-content-title" className="mb-2 text-sm font-medium">Artikelinhalt</h2>
                  <div ref={contentFieldRef} role="group" aria-labelledby="new-article-content-title" aria-invalid={hasSubmitted && contentMissing} aria-describedby={hasSubmitted && contentMissing ? 'new-article-content-error' : undefined} className="overflow-hidden rounded-[10px] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                    <Editor content={content} onChange={setContent} className="min-h-[400px]" />
                  </div>
                  {hasSubmitted && contentMissing && <p id="new-article-content-error" role="alert" className="mt-2 text-sm text-destructive">Schreibe den Inhalt deines Artikels.</p>}
                </section>
                <div className="mt-6 grid min-w-0 items-start gap-6 border-t pt-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8">
                  {/* Beitragsbild */}
                  <div className="min-w-0">
                    <Label className="text-sm font-medium text-foreground mb-2 block">Beitragsbild (optional)</Label>
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
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
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
                  <div className="min-w-0">
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
              <Toaster />
              </>}
            </div>
        </main>
      </div>
    </AppShell>
  );
}
