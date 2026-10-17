'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: article reading · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/lib/sites-auth/react';
import type { Session } from '@/lib/sites-auth/server';

import Image from 'next/image';
import { sanitizeRichHtml } from '@/lib/sanitize-html';
import richTextStyles from './article-rich-text.module.css';

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  featuredImage: string | null;
  author: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  tags: { id: string; name: string }[];
}

export default function ArticlePage() {
  const params = useParams();
  const id = params?.id as string;
  const { data, status } = useSession();
  const session = status === 'authenticated' ? data : null;
  return <ArticlePageForViewer key={JSON.stringify([id, session?.user?.id ?? null])} id={id} session={session} />;
}

function ArticlePageForViewer({ id, session }: { id: string; session: Session | null }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorArticleId, setErrorArticleId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!id) return;

    const controller = new AbortController();
    let active = true;

    void fetch(`/api/articles/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Artikel nicht gefunden oder Fehler beim Abrufen.');
        }
        return response.json() as Promise<Article>;
      })
      .then((data) => {
        if (!active) return;
        setArticle(data);
        setError(null);
        setErrorArticleId(id);
      })
      .catch((fetchError: unknown) => {
        if (!active || controller.signal.aborted) return;
        console.error('Error fetching article:', fetchError);
        setArticle(null);
        setError(fetchError instanceof Error ? fetchError.message : 'Ein unbekannter Fehler ist aufgetreten.');
        setErrorArticleId(id);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [id]);

  const handleDelete = async () => {
    if (!confirm('Bist du sicher, dass du diesen Artikel löschen möchtest?')) return;

    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/knowledgebase');
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Löschen des Artikels.');
      }
    } catch (error) {
      console.error('Error deleting article:', error);
      alert(error instanceof Error ? error.message : 'Fehler beim Löschen des Artikels.');
    }
  };

  const isCurrentArticleSettled = article?.id === id || errorArticleId === id;
  const displayedArticle = !isLoading && isCurrentArticleSettled && !error && article?.id === id ? article : null;
  const isAuthor = Boolean(displayedArticle && session?.user?.id === displayedArticle.author.id);

  return (
    <AppShell data-page-family="reading">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <div className="app-header-title"><Button asChild variant="ghost" size="sm"><Link href="/knowledgebase" aria-label="Zur Artikelübersicht"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zurück</Link></Button></div>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            {isLoading || !isCurrentArticleSettled ? (
              <><h1 className="sr-only">Artikel</h1><PageState kind="loading" title="Artikel wird geladen" /></>
            ) : !displayedArticle ? (
              <><h1 className="sr-only">Artikel</h1><PageState kind="error" title="Artikel nicht verfügbar" description={error || 'Artikel nicht gefunden.'} action={<Button asChild variant="outline"><Link href="/knowledgebase">Zurück zur Übersicht</Link></Button>} /></>
            ) : (
              <article>
                {isAuthor && <div className="flex flex-wrap items-center justify-end gap-3 border-b pb-5">

                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm"><Link href={'/knowledgebase/' + displayedArticle.id + '/edit'}><Edit className="h-4 w-4" aria-hidden="true" />Bearbeiten</Link></Button>
                    <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={handleDelete}><Trash className="h-4 w-4" aria-hidden="true" />Löschen</Button>
                  </div>
                </div>}

                <header className="fc-detail-header mx-auto mb-6 max-w-[72ch]">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{displayedArticle.category}</span>
                    <time dateTime={displayedArticle.createdAt}>{new Date(displayedArticle.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</time>
                    <span>{displayedArticle.author.name || displayedArticle.author.email}</span>
                  </div>
                  <h1 className="mt-5 min-w-0 break-words text-[clamp(2rem,1.35rem+2.5vw,3.5rem)] font-semibold leading-tight tracking-[-0.045em] [overflow-wrap:anywhere]">{displayedArticle.title}</h1>
                  {displayedArticle.tags.length > 0 && <div className="mt-5 flex flex-wrap gap-2">
                    {displayedArticle.tags.map(tag => <Badge key={tag.id} variant="secondary" className="max-w-full truncate">{tag.name}</Badge>)}
                  </div>}
                </header>

                {displayedArticle.featuredImage && <div className="relative mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-[14px] border bg-muted">
                  <Image src={displayedArticle.featuredImage} alt="" fill priority className="object-contain" />
                </div>}

                <div className="fc-reading-surface mx-auto max-w-[72ch]">
                  <div className={richTextStyles.body}
                    dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(displayedArticle.content) }} />
                </div>
              </article>
            )}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
