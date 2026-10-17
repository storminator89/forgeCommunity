'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: article editor · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from '@/lib/sites-auth/react';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Upload } from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";
import Image from 'next/image';
import { Trash2, Save, Loader2 } from 'lucide-react';
import { Editor } from "@/components/Editor";
import Link from 'next/link';

interface Tag {
  id: string;
  name: string;
}

interface Author {
  id: string;
  name: string;
  email: string;
}

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  featuredImage: string | null;
  author: Author;
  createdAt: string;
  tags: Tag[];
}

export default function EditArticle() {
  const { data: session, status } = useSession();
  const { id } = useParams<{ id: string }>();
  const accountId = status === 'authenticated' ? session?.user?.id ?? null : null;
  return <AccountEditArticle key={`${id}:${accountId ?? 'anonymous'}`} id={id} accountId={accountId} status={status} />;
}

function AccountEditArticle({ id, accountId, status }: { id: string; accountId: string | null; status: 'loading' | 'authenticated' | 'unauthenticated' }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [featuredImagePreview, setFeaturedImagePreview] = useState<string>('');
  const [isImageDeleted, setIsImageDeleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!accountId) {
      router.push('/login');
    }
  }, [accountId, status, router]);

  useEffect(() => {
    if (!id || !accountId || status !== 'authenticated') return;
    const controller = new AbortController();
    const fetchArticleAndMetadata = async () => {
      setIsLoading(true);
      try {
        const [articleResponse, metadataResponse] = await Promise.all([
          fetch(`/api/articles/${encodeURIComponent(id)}`, { signal: controller.signal }),
          fetch('/api/articles/categories-and-tags', { signal: controller.signal })
        ]);

        if (controller.signal.aborted) return;

        if (!articleResponse.ok) {
          throw new Error(`HTTP error! status: ${articleResponse.status}`);
        }

        const articleData: Article = await articleResponse.json();
        if (controller.signal.aborted) return;
        if (articleData.author.id !== accountId) throw new Error('Du bist nicht berechtigt, diesen Artikel zu bearbeiten.');
        setLoadError(false);
        setTitle(articleData.title);
        setContent(articleData.content);
        setCategory(articleData.category);
        setTags(articleData.tags.map(tag => tag.name));
        if (articleData.featuredImage) {
          setFeaturedImagePreview(articleData.featuredImage);
        }

        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          if (controller.signal.aborted) return;
          setExistingCategories(metadataData.categories || []);
          setExistingTags(metadataData.tags || []);
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        console.error('Error fetching article:', failure);
        setError(failure instanceof Error ? failure.message : 'Fehler beim Laden des Artikels.');
        setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void fetchArticleAndMetadata();
    return () => controller.abort();
  }, [id, accountId, status]);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag]);
    } else if (tags.length >= 5) {
      setError('Maximal 5 Tags erlaubt.');
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
      setIsImageDeleted(false);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFeaturedImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!title || !content || !category) {
      setError('Titel, Inhalt und Kategorie sind erforderlich.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);
    formData.append('category', category);
    tags.forEach(tag => formData.append('tags', tag));

    // Explizit markieren, wenn das Bild gelöscht werden soll
    formData.append('deleteImage', isImageDeleted.toString());

    if (featuredImage) {
      formData.append('featuredImage', featuredImage);
    }

    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'PUT',
        body: formData,
      });

      if (response.ok) {
        router.push(`/knowledgebase/${id}`);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Fehler beim Aktualisieren des Artikels.');
      }
    } catch (error) {
      console.error('Error updating article:', error);
      setError(error instanceof Error ? error.message : 'Fehler beim Aktualisieren des Artikels.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'loading' || (accountId && isLoading)) {
    return (
      <AppShell data-page-family="editor"><Sidebar /><div className="flex min-h-0 min-w-0 flex-1 flex-col"><AppHeader><div className="app-header-row"><h1 className="app-header-title">Artikel bearbeiten</h1></div></AppHeader><main id="page-content" tabIndex={-1} className="flex min-h-0 flex-1 items-center justify-center p-4"><PageState kind="loading" title="Artikel wird geladen" /></main></div></AppShell>
    );
  }

  return (
    <AppShell data-page-family="editor">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row"><h1 className="app-header-title">Artikel bearbeiten</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="fc-editor-surface mx-auto my-4 w-[calc(100%-2rem)] max-w-[1380px] py-3 sm:my-6 sm:py-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => router.push('/knowledgebase/' + id)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zum Artikel</Button>
              {!loadError && <Button type="submit" form="editForm" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{isSubmitting ? 'Speichern…' : 'Speichern'}</Button>}
            </div>

            {!accountId ? (
              <div className="mt-8"><PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um einen Artikel zu bearbeiten." action={<Button asChild variant="outline"><Link href="/login">Zur Anmeldung</Link></Button>} /></div>
            ) : loadError ? (
              <div className="mt-8"><PageState kind="error" title="Artikel konnte nicht geladen werden" description={error || 'Bitte versuche es später erneut.'} action={<Button type="button" variant="outline" onClick={() => router.push('/knowledgebase')}>Zur Übersicht</Button>} /></div>
            ) : (
              <>
                {error && <Alert variant="destructive" role="alert" className="my-6"><AlertCircle className="h-4 w-4" aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert>}
                <form id="editForm" method="post" onSubmit={handleSubmit} className="min-w-0 pt-4">
                  <p id="edit-article-required-fields" className="text-sm text-muted-foreground">Pflichtangaben: Titel, Inhalt und Kategorie.</p>
                  <div className="mt-4 grid min-w-0 items-start gap-5 sm:mt-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8" role="group" aria-label="Pflichtangaben" aria-describedby="edit-article-required-fields">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="title">Titel <span className="text-destructive">*</span></Label>
                        <span className="text-xs tabular-nums text-muted-foreground">{title.length}/100 Zeichen</span>
                      </div>
                      <Input id="title" value={title} onChange={event => setTitle(event.target.value)} placeholder="Gib einen aussagekräftigen Titel ein" maxLength={100} required className="text-base" />
                    </div>
                    <div className="min-w-0">
                      <CategorySelect categories={existingCategories} selectedCategory={category} setSelectedCategory={setCategory} onAddCategory={handleAddNewCategory} />
                    </div>
                  </div>
                  <section aria-labelledby="edit-article-content-title" aria-describedby="edit-article-required-fields" className="mt-3 min-w-0 sm:mt-6">
                    <h2 id="edit-article-content-title" className="mb-2 text-sm font-medium">Inhalt <span className="text-destructive">*</span></h2>
                    <div className="overflow-hidden rounded-[10px] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"><Editor content={content} onChange={setContent} className="min-h-[400px]" /></div>
                  </section>
                  <aside aria-label="Optionale Artikelangaben" className="mt-6 grid min-w-0 items-start gap-6 border-t pt-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8">
                    <div className="min-w-0">
                      <Label htmlFor="featuredImage" className="mb-2 block text-sm font-medium">Beitragsbild <span className="font-normal text-muted-foreground">(optional)</span></Label>
                      <div className="flex flex-wrap items-start gap-4">
                        <div>
                          <input type="file" id="featuredImage" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />Bild auswählen</Button>
                          <p className="mt-2 text-xs text-muted-foreground">Empfohlene Größe: 1200 × 630 px, max. 5 MB</p>
                        </div>
                        {featuredImagePreview ? <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-[10px] border bg-muted">
                          <Image src={featuredImagePreview} alt="Beitragsbildvorschau" fill className="object-cover" />
                          <Button type="button" variant="destructive" size="sm" className="absolute right-2 top-2" aria-label="Beitragsbild entfernen" onClick={() => { setFeaturedImage(null); setFeaturedImagePreview(''); setIsImageDeleted(true); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Entfernen</Button>
                        </div> : null}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <TagSelect availableTags={existingTags} selectedTags={tags} onTagSelect={handleAddTag} onTagRemove={handleRemoveTag} onAddTag={handleAddNewTag} maxTags={5} />
                      <p className="mt-2 text-xs text-muted-foreground">Optional, {tags.length}/5 ausgewählt</p>
                    </div>
                  </aside>
                </form>
              </>
            )}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
