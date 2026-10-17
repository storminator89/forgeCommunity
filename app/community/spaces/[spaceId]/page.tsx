'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: editorial workbench · structure: discussion index · design-system: design.md */

import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from '@/lib/sites-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageState } from '@/components/page-state';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { SpaceVisibility } from '@/components/spaces/SpaceVisibility';
import { SpaceAuthorLine } from '@/components/spaces/SpaceAuthorLine';
import { SpaceMemberManager } from '@/components/spaces/SpaceMemberManager';
import { SpacePolls } from '@/components/spaces/SpacePolls';
import { SpaceMissionIndex } from '@/components/spaces/SpaceMissionIndex';
import { apiSpaceUrl, discussionUrl, isSpaceAbort, revalidateSpacePages, type SpaceDiscussion, type SpacePage, type SpaceSummary } from '@/components/spaces/space-api';
import { useSpaceAccess, useSpaceListGeneration } from '@/hooks/useSpaceAccess';

const localSections = new Set(['space-discussions', 'space-missions', 'space-polls', 'space-management']);

function scrollToSection(id: string) {
  if (!localSections.has(id)) return false;
  const target = document.getElementById(id);
  const main = target?.closest<HTMLElement>('#page-content');
  if (!target || !main) return false;
  // Native focus/hash scrolling can also move the viewport-height app frame.
  // Keep the header in place and scroll only this page's content container.
  target.focus({ preventScroll: true });
  const margin = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
  main.scrollTop += target.getBoundingClientRect().top - main.getBoundingClientRect().top - margin;
  return true;
}

export default function SpacePage() {
  const params = useParams();
  const spaceId = typeof params.spaceId === 'string' ? params.spaceId : '';
  const { data, status } = useSession();
  if (status === 'loading') return <SpaceShell><h1 className="sr-only">Space</h1><PageState kind="loading" title="Space wird geladen" /></SpaceShell>;
  if (!data?.user?.id) return <SpaceShell><h1 className="sr-only">Space</h1><PageState kind="error" title="Anmeldung erforderlich" /></SpaceShell>;
  return <SpaceOverview key={`${data.user.id}:${data.user.role ?? ''}:${spaceId}`} spaceId={spaceId} />;
}

function SpaceOverview({ spaceId }: { spaceId: string }) {
  const base = apiSpaceUrl(spaceId);
  const router = useRouter();
  const [space, setSpace] = useState<SpaceSummary | null>(null);
  const spaceLoaded = Boolean(space);
  const [discussions, setDiscussions] = useState<SpaceDiscussion[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [pendingMembership, setPendingMembership] = useState(false);
  const [membershipError, setMembershipError] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [moderationError, setModerationError] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const { request, invalidate, accessLost } = useSpaceAccess(() => {
    latestSpaceRef.current = null;
    setSpace(null); setDiscussions([]); setCursor(null); setTitle(''); setContent('');
  });
  const beginListRead = useSpaceListGeneration();
  const latestSpaceRef = useRef<SpaceSummary | null>(null);
  const revalidateRef = useRef<() => void>(() => {});
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);
  const revalidatingRef = useRef(false);
  const refreshAfterRevalidateRef = useRef(false);
  const focusAfterPageRef = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const titleId = useId(); const contentId = useId();
  const composerTitleRef = useRef<HTMLInputElement>(null);
  const composerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (showComposer) composerTitleRef.current?.focus(); }, [showComposer]);

  function closeComposer() {
    setShowComposer(false);
    composerButtonRef.current?.focus();
  }

  function focusSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!scrollToSection(id)) return;
    event.preventDefault();
    const hash = event.currentTarget.hash;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }

  const initialFragmentHandledRef = useRef(false);
  useEffect(() => {
    if (loading || !spaceLoaded || initialFragmentHandledRef.current) return;
    initialFragmentHandledRef.current = true;
    scrollToSection(window.location.hash.slice(1));
  }, [loading, spaceLoaded]);

  useEffect(() => {
    let frame: number | undefined;
    const restoreFragment = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      // History restores its saved scroll after popstate. Then align only our
      // four local destinations; unrelated URLs and revalidations do not focus.
      frame = requestAnimationFrame(() => { scrollToSection(window.location.hash.slice(1)); });
    };
    window.addEventListener('popstate', restoreFragment);
    return () => { window.removeEventListener('popstate', restoreFragment); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const read = beginListRead();
    void Promise.all([
      request<SpaceSummary>(base, { signal: read.signal }),
      request<SpacePage<SpaceDiscussion>>(`${base}/discussions`, { signal: read.signal }),
    ]).then(([spaceData, page]) => {
      if (!read.isCurrent()) return;
      latestSpaceRef.current = spaceData;
      setSpace(spaceData); setDiscussions(page.items); setCursor(page.nextCursor);
    }).catch(caught => { if (read.isCurrent() && !isSpaceAbort(caught)) setError('Der Space konnte nicht geladen werden.'); })
      .finally(() => { if (read.isCurrent()) setLoading(false); });
  }, [base, refresh, request, beginListRead]);

  // Recheck current DB access and every displayed page on return. Existing
  // pagination depth is kept, but newly hidden rows leave the local list.
  useEffect(() => {
    if (!spaceLoaded || accessLost) return;
    let checking = false;
    const revalidate = (force = false) => {
      if (checking || (!force && document.visibilityState === 'hidden')) return;
      checking = true;
      revalidatingRef.current = true;
      const read = beginListRead();
      setLoading(true);
      setLoadingMore(false);
      void Promise.all([
        request<SpaceSummary>(base, { signal: read.signal }),
        revalidateSpacePages<SpaceDiscussion>(`${base}/discussions`, discussions.length, <R,>(path: string) => request<R>(path, { signal: read.signal })),
      ]).then(([current, page]) => {
        if (!read.isCurrent()) return;
        latestSpaceRef.current = current;
        setSpace(current); setDiscussions(page.items); setCursor(page.nextCursor); setError('');
      }).catch(caught => {
        if (read.isCurrent() && !isSpaceAbort(caught)) { setSpace(null); setDiscussions([]); setCursor(null); setError('Der Space konnte nicht erneut geprüft werden.'); }
      }).finally(() => {
        checking = false;
        if (!read.isCurrent()) return;
        if (refreshAfterRevalidateRef.current) {
          refreshAfterRevalidateRef.current = false;
          revalidate(true);
        } else {
          revalidatingRef.current = false;
          setLoading(false);
        }
      });
    };
    revalidateRef.current = () => revalidate(true);
    const onFocus = () => revalidate();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [spaceLoaded, discussions.length, base, accessLost, request, beginListRead]);

  useEffect(() => {
    if (focusAfterPageRef.current && !loadingMore && !cursor && document.activeElement === document.body) {
      focusAfterPageRef.current = false; resultRef.current?.focus();
    }
  }, [loadingMore, cursor]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const read = beginListRead();
    setLoadingMore(true); setMoreError(''); focusAfterPageRef.current = true;
    try {
      const page = await request<SpacePage<SpaceDiscussion>>(`${base}/discussions?cursor=${encodeURIComponent(cursor)}`, { signal: read.signal });
      if (!read.isCurrent()) return;
      setDiscussions(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (caught) { if (read.isCurrent() && !isSpaceAbort(caught)) setMoreError('Weitere Diskussionen konnten nicht geladen werden.'); }
    finally { if (read.isCurrent()) setLoadingMore(false); }
  }

  async function changeMembership() {
    if (!space || pendingMembership) return;
    setPendingMembership(true); setMembershipError('');
    try {
      const updated = await request<SpaceSummary>(base + '/join', { method: space.isMember ? 'DELETE' : 'POST' });
      if (space.visibility === 'PRIVATE' && space.isMember) { invalidate(); return; }
      setSpace(updated);
    } catch (caught) { if (!isSpaceAbort(caught)) setMembershipError(caught instanceof Error ? caught.message : 'Mitgliedschaft konnte nicht geändert werden.'); }
    finally { setPendingMembership(false); }
  }

  async function createDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting || !space?.isMember) return;
    const payload = JSON.stringify({ title: title.trim(), content: content.trim() });
    if (!requestIdRef.current || requestIdRef.current.payload !== payload) requestIdRef.current = { payload, id: crypto.randomUUID() };
    setPosting(true); setPostError('');
    try {
      const created = await request<SpaceDiscussion>(`${base}/discussions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), requestId: requestIdRef.current.id }),
      });
      requestIdRef.current = null;
      router.push(discussionUrl(spaceId, created.id));
    } catch (caught) { if (!isSpaceAbort(caught)) setPostError(caught instanceof Error ? caught.message : 'Diskussion konnte nicht erstellt werden.'); }
    finally { setPosting(false); }
  }

  async function toggleDiscussion(discussion: SpaceDiscussion) {
    if (moderatingId || !space?.canManage) return;
    setModeratingId(discussion.id); setModerationError('');
    try {
      const updated = await request<SpaceDiscussion>(`${base}/discussions/${encodeURIComponent(discussion.id)}/moderation`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !discussion.hiddenAt }),
      });
      if (!revalidatingRef.current && !latestSpaceRef.current?.canManage) {
        revalidateRef.current();
        return;
      }
      if (!revalidatingRef.current) {
        beginListRead();
        setLoadingMore(false);
      } else refreshAfterRevalidateRef.current = true;
      setDiscussions(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (caught) { if (!isSpaceAbort(caught)) setModerationError(caught instanceof Error ? caught.message : 'Moderation fehlgeschlagen.'); }
    finally { setModeratingId(null); }
  }

  function retryLoad() {
    beginListRead();
    setLoading(true); setError(''); setSpace(null); setDiscussions([]); setCursor(null);
    setRefresh(value => value + 1);
  }

  if (accessLost) return <SpaceShell><h1 className="sr-only">Space nicht verfügbar</h1><PageState kind="error" title="Space nicht verfügbar" description="Du hast keinen Zugriff auf diesen Space." action={<Button asChild variant="outline"><Link href="/community/spaces">Zur Übersicht</Link></Button>} /></SpaceShell>;
  return <SpaceShell>
    {loading ? <><h1 className="sr-only">Space</h1><PageState kind="loading" title="Space wird geladen" /></> : !space ? <><h1 className="sr-only">Space nicht verfügbar</h1><PageState kind="error" title="Space nicht verfügbar" description={error} action={<Button variant="outline" onClick={retryLoad}>Erneut versuchen</Button>} /></> : <>
      <nav aria-label="Pfad" className="mb-6 text-sm text-muted-foreground"><Link href="/community" className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Community</Link><span aria-hidden="true"> / </span><Link href="/community/spaces" className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Spaces</Link></nav>
      <header className="fc-detail-header min-w-0">
        <SpaceVisibility visibility={space.visibility} explanatory={space.visibility === 'PRIVATE'} />
        <h1 className="mt-2 max-w-[72ch] break-words text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight [overflow-wrap:anywhere]">{space.name}</h1>
        <p className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words text-base leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{space.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-xs text-muted-foreground">{space.memberCount} Mitglied{space.memberCount === 1 ? '' : 'er'} · {space.discussionCount} Diskussion{space.discussionCount === 1 ? '' : 'en'}</p>
          {space.visibility === 'PUBLIC' && <Button type="button" size="sm" variant={space.isMember ? 'ghost' : 'default'} disabled={pendingMembership} onClick={changeMembership}>{pendingMembership ? 'Wird gespeichert…' : space.isMember ? 'Verlassen' : 'Beitreten'}</Button>}
        </div>
      </header>
      {membershipError && <p role="alert" className="mt-4 text-sm text-destructive">{membershipError}</p>}

      <nav aria-label="Aufgaben im Space" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <a href="#space-discussions" onClick={event => focusSection(event, 'space-discussions')} className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Diskussionen</a>
        {space.visibility === 'PRIVATE' && <a href="#space-missions" onClick={event => focusSection(event, 'space-missions')} className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Missionen</a>}
        <a href="#space-polls" onClick={event => focusSection(event, 'space-polls')} className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Umfragen</a>
        {space.canManage && space.visibility === 'PRIVATE' && <a href="#space-management" onClick={event => focusSection(event, 'space-management')} className="inline-flex min-h-11 items-center rounded-sm text-muted-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Verwaltung</a>}
      </nav>

      <section id="space-discussions" tabIndex={-1} aria-labelledby="space-discussions-title" className="fc-section-card mt-5 scroll-mt-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="space-discussions-title" className="text-xl font-semibold">Diskussionen</h2>
          {space.isMember && <Button ref={composerButtonRef} type="button" onClick={() => showComposer ? closeComposer() : setShowComposer(true)} aria-expanded={showComposer} aria-controls="space-discussion-form">{showComposer ? 'Schließen' : 'Diskussion starten'}</Button>}</div>
        {!space.isMember && <p className="mt-3 text-sm text-muted-foreground">{space.visibility === 'PUBLIC' ? 'Tritt bei, um eine Diskussion zu starten oder zu antworten.' : 'Zum Schreiben ist eine Mitgliedschaft erforderlich.'}</p>}
        {showComposer && space.isMember && <form id="space-discussion-form" onSubmit={createDiscussion} onKeyDown={event => { if (event.key === 'Escape' && !posting) { event.preventDefault(); closeComposer(); } }} className="mt-5 max-w-3xl space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
          <div className="space-y-1"><label htmlFor={titleId} className="text-sm font-medium">Titel</label><Input ref={composerTitleRef} id={titleId} value={title} onChange={event => setTitle(event.target.value)} minLength={5} maxLength={140} required disabled={posting} /></div>
          <div className="space-y-1"><label htmlFor={contentId} className="text-sm font-medium">Dein Beitrag</label><Textarea id={contentId} value={content} onChange={event => setContent(event.target.value)} minLength={10} maxLength={4000} required disabled={posting} rows={6} /></div>
          {postError && <p role="alert" className="text-sm text-destructive">{postError}</p>}
          <Button type="submit" disabled={posting || title.trim().length < 5 || content.trim().length < 10}>{posting ? 'Wird veröffentlicht…' : 'Veröffentlichen'}</Button>
        </form>}
        {discussions.length === 0 ? <div className="mt-6"><PageState title="Noch keine Diskussionen" /></div> : <ul className="mt-5 divide-y border-y">{discussions.map(discussion => <li key={discussion.id} className="min-w-0 py-5"><div className="flex flex-wrap items-start justify-between gap-2"><Link href={discussionUrl(spaceId, discussion.id)} className="block min-w-0 rounded-sm underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><h3 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{discussion.title}</h3></Link>{space.canManage && <Button type="button" size="sm" variant="ghost" disabled={!!moderatingId} onClick={() => toggleDiscussion(discussion)}>{moderatingId === discussion.id ? 'Wird gespeichert…' : discussion.hiddenAt ? 'Wieder einblenden' : 'Ausblenden'}</Button>}</div>{discussion.hiddenAt && <p className="mt-1 text-xs font-medium text-destructive">Ausgeblendet</p>}<div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 [overflow-wrap:anywhere] [&>p]:min-w-0"><SpaceAuthorLine author={discussion.author} date={discussion.createdAt} /><span className="text-xs text-muted-foreground">{discussion.replyCount} Antworten</span></div><p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{discussion.content}</p></li>)}</ul>}
        {moderationError && <p role="alert" className="mt-3 text-sm text-destructive">{moderationError}</p>}
        <p ref={resultRef} tabIndex={-1} className="mt-4 text-xs text-muted-foreground" aria-live="polite">{discussions.length} Diskussionen geladen</p>
        {moreError && <p role="alert" className="mt-2 text-sm text-destructive">{moreError}</p>}
        {cursor && <Button type="button" className="mt-4" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Wird geladen…' : 'Weitere Diskussionen laden'}</Button>}
      </section>

      {space.visibility === 'PRIVATE' && <div id="space-missions" tabIndex={-1} role="group" aria-label="Missionen" className="scroll-mt-6 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        <SpaceMissionIndex spaceId={spaceId} canManage={space.canManage} request={request} onUnavailable={invalidate} />
      </div>}

      <div id="space-polls" tabIndex={-1} role="group" aria-label="Umfragen" className="scroll-mt-6 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        <SpacePolls key={`${space.isMember}:${space.canManage}`} spaceId={spaceId} canManage={space.canManage} request={request} onUnavailable={invalidate} />
      </div>

      {space.canManage && space.visibility === 'PRIVATE' && <section id="space-management" tabIndex={-1} aria-labelledby="space-management-title" className="fc-section-card mt-5 scroll-mt-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        <h2 id="space-management-title" className="text-xl font-semibold">Space verwalten</h2>
        <SpaceMemberManager spaceId={spaceId} request={request} onChange={() => {
          if (revalidatingRef.current) { refreshAfterRevalidateRef.current = true; return; }
          const read = beginListRead();
          setLoadingMore(false);
          void request<SpaceSummary>(base, { signal: read.signal })
            .then(current => { if (read.isCurrent()) setSpace(current); })
            .catch(() => { /* access guard handles permission loss */ });
        }} />
      </section>}
    </>}
  </SpaceShell>;
}
