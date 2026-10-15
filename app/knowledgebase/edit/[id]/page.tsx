'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: draft editor · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Upload, Loader2, Bookmark, Send, Trash2 } from 'lucide-react';
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";
import { toast } from 'sonner';
import { Editor } from "@/components/Editor";
import Link from 'next/link';

export default function EditArticle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const accountId = status === 'authenticated' ? session?.user?.id ?? null : null;
  return <AccountDraftEditor key={`${id}:${accountId ?? 'anonymous'}`} id={id} accountId={accountId} status={status} />;
}

function AccountDraftEditor({ id, accountId, status }: { id: string; accountId: string | null; status: 'loading' | 'authenticated' | 'unauthenticated' }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [featuredImagePreview, setFeaturedImagePreview] = useState<string>('');
  const [isImageDeleted, setIsImageDeleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingAsDraft, setSubmittingAsDraft] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const maxTitleLength = 100;

  useEffect(() => {
    if (status === 'loading') return;
    if (!accountId) {
      router.push('/login');
    }
  }, [accountId, status, router]);

  useEffect(() => {
    if (!id || !accountId || status !== 'authenticated') return;
    const controller = new AbortController();

    const fetchArticle = async () => {
      setIsLoading(true);
      try {

        const [articleResponse, categoriesResponse] = await Promise.all([
          fetch(`/api/articles/${encodeURIComponent(id)}`, { signal: controller.signal }),
          fetch('/api/articles/categories-and-tags', { signal: controller.signal })
        ]);

        if (controller.signal.aborted) return;

        if (!articleResponse.ok) {
          throw new Error(`Article fetch failed: ${articleResponse.statusText}`);
        }

        const article = await articleResponse.json();

        if (controller.signal.aborted) return;
        if (!article) throw new Error('Artikel nicht gefunden');
        if (article.author?.id !== accountId) throw new Error('Du bist nicht berechtigt, diesen Entwurf zu bearbeiten.');

        setLoadError(false);
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
          if (controller.signal.aborted) return;
          setExistingCategories(categories);
          setExistingTags(tags);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Error fetching article:', error);
        setLoadError(true);
        toast.error('Fehler beim Laden des Artikels');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void fetchArticle();
    return () => controller.abort();
  }, [id, accountId, status, retryKey]);

  const handleSubmit = async (asDraft: boolean) => {
    setSubmittingAsDraft(asDraft);
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
    formData.append('deleteImage', isImageDeleted.toString());
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

  if (status === 'loading' || (accountId && isLoading)) {
    return (
      <AppShell><Sidebar /><div className="flex min-h-0 min-w-0 flex-1 flex-col"><AppHeader><div><h1>Entwurf bearbeiten</h1></div></AppHeader><main id="page-content" tabIndex={-1} className="flex min-h-0 flex-1 items-center justify-center p-4"><PageState kind="loading" title="Entwurf wird geladen" /></main></div></AppShell>
    );
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-3"><h1>Entwurf bearbeiten</h1><div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div></div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
              <div>
                <Button type="button" variant="ghost" size="sm" onClick={() => router.push('/knowledgebase/drafts')}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zu den Entwürfen</Button>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Wissen / Entwurf</p>
                <p className="mt-2 max-w-[55ch] text-base leading-relaxed text-muted-foreground">Arbeite weiter und entscheide, wann dein Artikel bereit ist.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => handleSubmit(true)} disabled={isSubmitting}>
                  {isSubmitting && submittingAsDraft ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}{isSubmitting && submittingAsDraft ? 'Speichere Entwurf…' : 'Als Entwurf speichern'}
                </Button>
                <Button type="button" onClick={() => handleSubmit(false)} disabled={isSubmitting}>
                  {isSubmitting && !submittingAsDraft ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}{isSubmitting && !submittingAsDraft ? 'Veröffentliche…' : 'Veröffentlichen'}
                </Button>
              </div>
            </div>

            {!accountId ? <div className="pt-8"><PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um deinen Entwurf zu bearbeiten." action={<Button asChild variant="outline"><Link href="/login">Zur Anmeldung</Link></Button>} /></div> : loadError ? <div className="pt-8"><PageState kind="error" title="Entwurf konnte nicht geladen werden" description="Bitte versuche es erneut." action={<Button type="button" variant="outline" onClick={() => { setIsLoading(true); setRetryKey(value => value + 1); }}>Erneut versuchen</Button>} /></div> : <div className="grid min-w-0 items-start gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
              <section aria-labelledby="draft-editor-content-title" className="min-w-0 border-t pt-5">
                <h2 id="draft-editor-content-title" className="text-lg font-semibold tracking-tight">Artikelinhalt</h2>
                <div className="mt-6 space-y-8">
                  <div className="border-b pb-7">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="title">Titel <span className="text-destructive">*</span></Label>
                      <span className="text-xs tabular-nums text-muted-foreground">{title.length}/{maxTitleLength}</span>
                    </div>
                    <Input id="title" value={title} onChange={event => setTitle(event.target.value.slice(0, maxTitleLength))} placeholder="Gib einen aussagekräftigen Titel ein" maxLength={maxTitleLength} required className="text-base" />
                  </div>

                  <div className="border-b pb-7">
                    <p className="mb-2 text-sm font-medium">Beitragsbild <span className="font-normal text-muted-foreground">(optional)</span></p>
                    <div className="flex flex-wrap items-start gap-4">
                      <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={event => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setFeaturedImage(file);
                        setIsImageDeleted(false);
                        const reader = new FileReader();
                        reader.onloadend = () => setFeaturedImagePreview(reader.result as string);
                        reader.readAsDataURL(file);
                      }} />
                      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />Bild auswählen</Button>
                      {featuredImagePreview && <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded-[10px] border bg-muted">
                        <Image src={featuredImagePreview} alt="Beitragsbildvorschau" fill className="object-cover" />
                        <Button type="button" variant="destructive" size="sm" className="absolute right-2 top-2" aria-label="Beitragsbild entfernen" onClick={() => { setFeaturedImage(null); setFeaturedImagePreview(''); setIsImageDeleted(true); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Entfernen</Button>
                      </div>}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-medium">Inhalt <span className="text-destructive">*</span></p>
                    <div className="overflow-hidden rounded-[10px] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"><Editor content={content} onChange={setContent} className="min-h-[400px]" /></div>
                  </div>
                </div>
              </section>

              <aside aria-label="Artikeloptionen" className="min-w-0 space-y-7">
                <section className="border-t pt-5">
                  <h2 className="text-base font-semibold tracking-tight">Kategorie <span className="text-xs font-normal text-muted-foreground">(erforderlich)</span></h2>
                  <div className="mt-4"><CategorySelect categories={existingCategories} selectedCategory={category} setSelectedCategory={setCategory} onAddCategory={newCategory => { setExistingCategories([...existingCategories, newCategory]); setCategory(newCategory); }} /></div>
                </section>
                <section className="border-t pt-5">
                  <h2 className="text-base font-semibold tracking-tight">Tags</h2>
                  <div className="mt-4"><TagSelect availableTags={existingTags} selectedTags={tags} onTagSelect={tag => { if (!tags.includes(tag)) setTags([...tags, tag]); }} onTagRemove={tag => setTags(tags.filter(value => value !== tag))} onAddTag={newTag => { setExistingTags([...existingTags, newTag]); setTags([...tags, newTag]); }} /></div>
                </section>
              </aside>
            </div>}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
