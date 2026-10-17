'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { LockKeyhole, MessageSquare, FileText } from 'lucide-react';
import { AppShell, AppHeader } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/user-nav';
import { Button } from '@/components/ui/button';
import { CommunityBookmarksProvider, useCommunityBookmark } from '@/components/community/bookmarks/CommunityBookmarksProvider';
import { BookmarkButton } from '@/components/community/bookmarks/BookmarkButton';
import { useCommentActionFocus as useActionFocus } from '@/components/community/useCommentActionFocus';
import type { CommunityBookmarkFilter, CommunityBookmarkPage, SavedCommunityItem } from '@/lib/community-bookmarks';

export default function SavedCommunityPage() {
  const { data: session, status } = useSession();
  return <AppShell><Sidebar /><div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <AppHeader><h1 className="app-header-title">Merkliste</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></AppHeader>
    <main id="page-content" tabIndex={-1} className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      {status === 'loading' ? <p role="status">Merkliste wird geladen…</p> : !session?.user?.id
        ? <p><Link href="/login" className="text-primary underline">Anmelden</Link>, um deine Merkliste zu öffnen.</p>
        : <AccountSaved key={session.user.id} accountId={session.user.id} />}
    </main>
  </div></AppShell>;
}
function AccountSaved({ accountId }: { accountId: string }) {
  const [filter, setFilter] = useState<CommunityBookmarkFilter>('all');
  return <><div className="mb-6 flex flex-wrap items-center justify-between gap-3">
    <p className="flex items-center gap-2 text-sm text-muted-foreground"><LockKeyhole className="h-4 w-4" aria-hidden="true" />Nur für dich</p>
    <Button variant="ghost" asChild><Link href="/community">Zur Community</Link></Button>
  </div><div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Merkliste filtern">
    {([['all', 'Alle'], ['post', 'Beiträge'], ['comment', 'Kommentare']] as const).map(([value, label]) =>
      <Button key={value} variant={filter === value ? 'default' : 'outline'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
  </div><SavedItems key={filter} accountId={accountId} filter={filter} /></>;
}
function SavedItems({ accountId, filter }: { accountId: string; filter: CommunityBookmarkFilter }) {
  const [items, setItems] = useState<SavedCommunityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const pageFocus = useActionFocus(`saved:${filter}`, accountId, loading);
  const load = useCallback(async (boundary?: string | null) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(false);
    try {
      const response = await fetch(`/api/community/bookmarks?filter=${filter}${boundary ? `&cursor=${encodeURIComponent(boundary)}` : ''}`, { signal: controller.signal, cache: 'no-store' });
      const body: CommunityBookmarkPage = await response.json();
      if (!response.ok || !Array.isArray(body.items) || !(body.nextCursor === null || typeof body.nextCursor === 'string')) throw new Error();
      if (!active.current || controller.signal.aborted) return false;
      setItems(previous => [...new Map([...(boundary ? previous : []), ...body.items].map(row => [row.id, row])).values()]);
      setCursor(body.nextCursor); setLoaded(true);
      return Boolean(boundary && !body.nextCursor);
    } catch { if (active.current && !controller.signal.aborted) setError(true); return false; }
    finally { if (active.current && request.current === controller) setLoading(false); }
  }, [filter]);
  useEffect(() => {
    active.current = true;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); active.current = false; request.current?.abort(); };
  }, [load]);
  return <CommunityBookmarksProvider accountId={accountId} targets={items.map(({ kind, targetId }) => ({ kind, targetId }))}>
    {items.length > 0 && <ul className="divide-y divide-border border-y border-border">{items.map(item => <SavedRow key={item.id} item={item} />)}</ul>}
    <p ref={statusRef} tabIndex={-1} role="status" className="mt-4 text-sm text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{loading ? 'Merkliste wird geladen…' : loaded && items.length > 0 && !cursor ? 'Ende der Merkliste' : ''}</p>
    {error && <div role="alert" className="mt-4"><p className="mb-3 text-sm text-destructive">Merkliste konnte nicht geladen werden.</p><Button variant="outline" onClick={() => void load(loaded ? cursor : null)}>Erneut laden</Button></div>}
    {!loading && !error && loaded && items.length === 0 && <div className="py-12 text-center"><Image src="/images/community-saved-empty.webp" alt="" width={240} height={180} className="mx-auto mb-5 h-auto w-60 max-w-full" /><h2 className="text-lg font-semibold">Noch nichts gemerkt</h2><p className="mt-2 text-sm text-muted-foreground">Beiträge und Kommentare mit „Merken“ hier ablegen.</p><Button asChild className="mt-5"><Link href="/community">Community öffnen</Link></Button></div>}
    {/* Keep the initiating node connected while its final-page control hides,
        so the existing guarded focus helper can settle on the end status. */}
    <div hidden={!cursor || error}><Button variant="outline" className="mt-4" disabled={loading} onClick={async event => {
      const focus = pageFocus.begin(event.currentTarget);
      const finalPage = await load(cursor);
      if (focus && finalPage && statusRef.current) focus.target = statusRef.current;
      pageFocus.complete(focus);
    }}>Weitere laden</Button></div>
  </CommunityBookmarksProvider>;
}
function SavedRow({ item }: { item: SavedCommunityItem }) {
  const bookmark = useCommunityBookmark(item);
  const unavailable = bookmark?.entry?.unavailable;
  const removed = bookmark?.entry?.state?.saved === false;
  const Icon = item.kind === 'post' ? FileText : MessageSquare;
  return <li className="min-w-0 py-5"><div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0 flex-1 basis-48">
      {unavailable ? <p role="status" className="text-muted-foreground">Inhalt nicht mehr verfügbar</p> : <>
        <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" />{item.kind === 'post' ? 'Beitrag' : 'Kommentar'}{removed ? ' entfernt' : ''}</p>
        <a href={item.href} className="rounded-sm text-lg font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]">{item.title}</a>
        <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{item.excerpt}</p>
        {item.author.name && <p className="mt-2 text-sm text-muted-foreground">{item.author.name}</p>}
      </>}
    </div><BookmarkButton kind={item.kind} targetId={item.targetId} />
  </div></li>;
}
