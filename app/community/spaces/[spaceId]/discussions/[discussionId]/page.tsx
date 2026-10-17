'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial reading · structure: one discussion and replies · design-system: design.md */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PageState } from '@/components/page-state';
import { ReportControl } from '@/components/community/ReportControl';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { SpaceVisibility } from '@/components/spaces/SpaceVisibility';
import { SpaceAuthorLine } from '@/components/spaces/SpaceAuthorLine';
import { apiSpaceUrl, discussionUrl, isSpaceAbort, revalidateSpacePages, spaceUrl, type SpaceDiscussion, type SpacePage, type SpaceReply, type SpaceSummary } from '@/components/spaces/space-api';
import { useSpaceAccess, useSpaceListGeneration } from '@/hooks/useSpaceAccess';

export default function SpaceDiscussionPage() {
  const params = useParams();
  const spaceId = typeof params.spaceId === 'string' ? params.spaceId : '';
  const discussionId = typeof params.discussionId === 'string' ? params.discussionId : '';
  const { data, status } = useSession();
  if (status === 'loading') return <SpaceShell><h1 className="sr-only">Diskussion</h1><PageState kind="loading" title="Diskussion wird geladen" /></SpaceShell>;
  if (!data?.user?.id) return <SpaceShell><h1 className="sr-only">Diskussion</h1><PageState kind="error" title="Anmeldung erforderlich" /></SpaceShell>;
  return <Discussion key={`${data.user.id}:${data.user.role ?? ''}:${spaceId}:${discussionId}`} spaceId={spaceId} discussionId={discussionId} />;
}

function Discussion({ spaceId, discussionId }: { spaceId: string; discussionId: string }) {
  const spaceApi = apiSpaceUrl(spaceId);
  const discussionApi = `${spaceApi}/discussions/${encodeURIComponent(discussionId)}`;
  const [space, setSpace] = useState<SpaceSummary | null>(null);
  const spaceLoaded = Boolean(space);
  const [discussion, setDiscussion] = useState<SpaceDiscussion | null>(null);
  const [replies, setReplies] = useState<SpaceReply[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [replyContent, setReplyContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [postFeedback, setPostFeedback] = useState('');
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [moderationError, setModerationError] = useState('');
  const { request, accessLost } = useSpaceAccess(() => {
    latestSpaceRef.current = null;
    setSpace(null); setDiscussion(null); setReplies([]); setCursor(null); setReplyContent('');
  });
  const beginListRead = useSpaceListGeneration();
  const latestSpaceRef = useRef<SpaceSummary | null>(null);
  const revalidateRef = useRef<() => void>(() => {});
  const replyId = useId();
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);
  const revalidatingRef = useRef(false);
  const refreshAfterRevalidateRef = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const focusAfterPageRef = useRef(false);

  useEffect(() => {
    const read = beginListRead();
    void Promise.all([
      request<SpaceSummary>(spaceApi, { signal: read.signal }),
      request<SpaceDiscussion>(discussionApi, { signal: read.signal }),
      request<SpacePage<SpaceReply>>(`${discussionApi}/replies`, { signal: read.signal }),
    ]).then(([spaceData, discussionData, page]) => {
      if (!read.isCurrent()) return;
      if (discussionData.spaceId !== spaceId) throw new Error('Ungültige Diskussion');
      latestSpaceRef.current = spaceData;
      setSpace(spaceData); setDiscussion(discussionData); setReplies(page.items); setCursor(page.nextCursor);
    }).catch(caught => { if (read.isCurrent() && !isSpaceAbort(caught)) setError('Die Diskussion konnte nicht geladen werden.'); })
      .finally(() => { if (read.isCurrent()) setLoading(false); });
  }, [spaceApi, discussionApi, spaceId, refresh, request, beginListRead]);

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
        request<SpaceSummary>(spaceApi, { signal: read.signal }),
        request<SpaceDiscussion>(discussionApi, { signal: read.signal }),
        revalidateSpacePages<SpaceReply>(`${discussionApi}/replies`, replies.length, <R,>(path: string) => request<R>(path, { signal: read.signal })),
      ]).then(([current, currentDiscussion, page]) => {
        if (!read.isCurrent()) return;
        latestSpaceRef.current = current;
        setSpace(current); setDiscussion(currentDiscussion); setReplies(page.items); setCursor(page.nextCursor); setError('');
      }).catch(caught => {
        if (read.isCurrent() && !isSpaceAbort(caught)) { setSpace(null); setDiscussion(null); setReplies([]); setCursor(null); setError('Die Diskussion konnte nicht erneut geprüft werden.'); }
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
  }, [spaceLoaded, replies.length, spaceApi, discussionApi, accessLost, request, beginListRead]);

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
      const page = await request<SpacePage<SpaceReply>>(`${discussionApi}/replies?cursor=${encodeURIComponent(cursor)}`, { signal: read.signal });
      if (!read.isCurrent()) return;
      setReplies(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (caught) { if (read.isCurrent() && !isSpaceAbort(caught)) setMoreError('Weitere Antworten konnten nicht geladen werden.'); }
    finally { if (read.isCurrent()) setLoadingMore(false); }
  }

  async function postReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting || !space?.isMember) return;
    const content = replyContent.trim();
    if (!requestIdRef.current || requestIdRef.current.payload !== content) requestIdRef.current = { payload: content, id: crypto.randomUUID() };
    setPosting(true); setPostError(''); setPostFeedback('');
    try {
      const reply = await request<SpaceReply>(`${discussionApi}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, requestId: requestIdRef.current.id }),
      });
      if (!revalidatingRef.current) {
        beginListRead();
        setLoadingMore(false);
      } else refreshAfterRevalidateRef.current = true;
      setReplies(previous => previous.some(item => item.id === reply.id) ? previous : [...previous, reply]);
      setReplyContent(''); requestIdRef.current = null; setPostFeedback('Antwort veröffentlicht.');
    } catch (caught) { if (!isSpaceAbort(caught)) setPostError(caught instanceof Error ? caught.message : 'Antwort konnte nicht veröffentlicht werden.'); }
    finally { setPosting(false); }
  }

  async function moderateDiscussion() {
    if (!space?.canManage || !discussion || moderatingId) return;
    setModeratingId(discussion.id); setModerationError('');
    try {
      const updated = await request<SpaceDiscussion>(`${discussionApi}/moderation`, {
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
      setDiscussion(updated);
    } catch (caught) { if (!isSpaceAbort(caught)) setModerationError(caught instanceof Error ? caught.message : 'Moderation fehlgeschlagen.'); }
    finally { setModeratingId(null); }
  }

  async function moderateReply(reply: SpaceReply) {
    if (!space?.canManage || moderatingId) return;
    setModeratingId(reply.id); setModerationError('');
    try {
      const updated = await request<SpaceReply>(`${discussionApi}/replies/${encodeURIComponent(reply.id)}/moderation`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !reply.hiddenAt }),
      });
      if (!revalidatingRef.current && !latestSpaceRef.current?.canManage) {
        revalidateRef.current();
        return;
      }
      if (!revalidatingRef.current) {
        beginListRead();
        setLoadingMore(false);
      } else refreshAfterRevalidateRef.current = true;
      setReplies(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (caught) { if (!isSpaceAbort(caught)) setModerationError(caught instanceof Error ? caught.message : 'Moderation fehlgeschlagen.'); }
    finally { setModeratingId(null); }
  }

  function retryLoad() {
    beginListRead();
    setLoading(true); setError(''); setSpace(null); setDiscussion(null); setReplies([]); setCursor(null);
    setRefresh(value => value + 1);
  }

  if (accessLost) return <SpaceShell><h1 className="sr-only">Diskussion nicht verfügbar</h1><PageState kind="error" title="Diskussion nicht verfügbar" description="Du hast keinen Zugriff auf diese Diskussion." action={<Button asChild variant="outline"><Link href="/community/spaces">Zur Übersicht</Link></Button>} /></SpaceShell>;
  return <SpaceShell>
    {loading ? <><h1 className="sr-only">Diskussion</h1><PageState kind="loading" title="Diskussion wird geladen" /></> : !space || !discussion ? <><h1 className="sr-only">Diskussion nicht verfügbar</h1><PageState kind="error" title="Diskussion nicht verfügbar" description={error} action={<Button variant="outline" onClick={retryLoad}>Erneut versuchen</Button>} /></> : <>
      <nav aria-label="Pfad" className="mb-7 flex flex-wrap gap-x-2 text-sm text-muted-foreground"><Link href="/community/spaces" className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Spaces</Link><span aria-hidden="true">/</span><Link href={spaceUrl(spaceId)} className="min-w-0 break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{space.name}</Link></nav>
      <article id={`discussion-${discussion.id}`} className="max-w-[75ch] border-b pb-8">
        <SpaceVisibility visibility={space.visibility} explanatory={space.visibility === 'PRIVATE'} />
        <h1 className="mt-3 break-words text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight">{discussion.title}</h1>
        {discussion.hiddenAt && <p className="mt-2 text-sm font-medium text-destructive">Ausgeblendet</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><SpaceAuthorLine author={discussion.author} date={discussion.createdAt} /><div className="flex flex-wrap items-center gap-2"><ReportControl targetType="SPACE_DISCUSSION" targetId={discussion.id} />{space.canManage && <Button type="button" size="sm" variant="ghost" disabled={!!moderatingId} onClick={moderateDiscussion}>{moderatingId === discussion.id ? 'Wird gespeichert…' : discussion.hiddenAt ? 'Wieder einblenden' : 'Ausblenden'}</Button>}</div></div>
        <p className="mt-7 whitespace-pre-wrap break-words text-base leading-7">{discussion.content}</p>
      </article>
      <section aria-labelledby="space-replies-title" className="max-w-[75ch] pt-8">
        <h2 id="space-replies-title" className="text-xl font-semibold">Antworten</h2>
        {replies.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Noch keine Antworten.</p> : <ol className="mt-4 divide-y border-y">{replies.map(reply => <li key={reply.id} id={`reply-${reply.id}`} className="min-w-0 py-5"><div className="flex flex-wrap items-center justify-between gap-2"><SpaceAuthorLine author={reply.author} date={reply.createdAt} /><div className="flex flex-wrap items-center gap-2"><ReportControl targetType="SPACE_REPLY" targetId={reply.id} />{space.canManage && <Button type="button" size="sm" variant="ghost" disabled={!!moderatingId} onClick={() => moderateReply(reply)}>{moderatingId === reply.id ? 'Wird gespeichert…' : reply.hiddenAt ? 'Wieder einblenden' : 'Ausblenden'}</Button>}</div></div>{reply.hiddenAt && <p className="mt-1 text-xs font-medium text-destructive">Ausgeblendet</p>}<p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed">{reply.content}</p></li>)}</ol>}
        {moderationError && <p role="alert" className="mt-3 text-sm text-destructive">{moderationError}</p>}
        <p ref={resultRef} tabIndex={-1} className="mt-4 text-xs text-muted-foreground" aria-live="polite">{replies.length} Antworten geladen</p>
        {moreError && <p role="alert" className="mt-2 text-sm text-destructive">{moreError}</p>}
        {cursor && <Button type="button" className="mt-4" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Wird geladen…' : 'Weitere Antworten laden'}</Button>}
        {discussion.hiddenAt ? <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">Diese Diskussion ist ausgeblendet. Antworten sind derzeit nicht möglich.</p> : space.isMember ? <form onSubmit={postReply} className="mt-9 space-y-3 border-t pt-7"><div className="space-y-1"><label htmlFor={replyId} className="text-sm font-medium">Deine Antwort</label><Textarea id={replyId} value={replyContent} onChange={event => setReplyContent(event.target.value)} minLength={2} maxLength={4000} required disabled={posting} rows={5} /></div>{postError && <p role="alert" className="text-sm text-destructive">{postError}</p>}{postFeedback && <p role="status" className="text-sm text-foreground">{postFeedback}</p>}<Button type="submit" disabled={posting || replyContent.trim().length < 2}>{posting ? 'Wird veröffentlicht…' : 'Antwort veröffentlichen'}</Button></form> : <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">Zum Antworten ist eine Mitgliedschaft erforderlich.</p>}
      </section>
    </>}
  </SpaceShell>;
}
