'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Editorial workbench · private Space members · voluntary teach-back · locked design.md tokens */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSpaceListGeneration } from '@/hooks/useSpaceAccess';
import { isSpaceAbort, revalidateSpacePages, spaceDate, type SpacePage } from './space-api';
import { missionAccessDenied, missionApiUrl, missionUrl, type MissionRequest, type SpaceMission } from './mission-api';

export function SpaceMissionIndex({ spaceId, canManage, request, onUnavailable }: {
  spaceId: string; canManage: boolean; request: MissionRequest; onUnavailable: () => void;
}) {
  const router = useRouter();
  const base = missionApiUrl(spaceId);
  const headingId = useId(); const titleId = useId(); const promptId = useId(); const errorId = useId();
  const [items, setItems] = useState<SpaceMission[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [postError, setPostError] = useState('');
  const beginRead = useSpaceListGeneration();
  const countRef = useRef(0);
  const aliveRef = useRef(true);
  const pendingRef = useRef(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const focusAfterPageRef = useRef(false);
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const load = useCallback(async () => {
    const read = beginRead();
    setLoading(true); setLoadingMore(false); setError(''); setItems([]); setCursor(null);
    try {
      const page = await revalidateSpacePages<SpaceMission>(base, countRef.current,
        <T,>(path: string) => request<T>(path, { signal: read.signal }));
      if (!read.isCurrent()) return;
      countRef.current = page.items.length;
      setItems(page.items); setCursor(page.nextCursor);
    } catch (caught) {
      if (!read.isCurrent() || isSpaceAbort(caught)) return;
      if (missionAccessDenied(caught)) { setTitle(''); setPrompt(''); onUnavailable(); }
      else setError('Missionen konnten nicht geladen werden.');
    } finally { if (read.isCurrent()) setLoading(false); }
  }, [base, beginRead, onUnavailable, request]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    const recheck = () => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => { window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [load]);
  useEffect(() => { if (showForm) titleRef.current?.focus(); }, [showForm]);
  useEffect(() => {
    if (focusAfterPageRef.current && !loadingMore && !cursor) {
      focusAfterPageRef.current = false; resultRef.current?.focus();
    }
  }, [loadingMore, cursor]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const read = beginRead();
    setLoadingMore(true); setError(''); focusAfterPageRef.current = true;
    try {
      const page = await request<SpacePage<SpaceMission>>(`${base}?cursor=${encodeURIComponent(cursor)}`, { signal: read.signal });
      if (!read.isCurrent()) return;
      setItems(previous => {
        const next = [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))];
        countRef.current = next.length; return next;
      });
      setCursor(page.nextCursor);
    } catch (caught) {
      if (!read.isCurrent() || isSpaceAbort(caught)) return;
      if (missionAccessDenied(caught)) { setItems([]); setTitle(''); setPrompt(''); onUnavailable(); }
      else setError('Weitere Missionen konnten nicht geladen werden.');
    } finally { if (read.isCurrent()) setLoadingMore(false); }
  }

  function closeForm() {
    setShowForm(false); setTitle(''); setPrompt(''); setPostError(''); requestIdRef.current = null;
    createButtonRef.current?.focus();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !canManage) return;
    const input = { title: title.trim(), prompt: prompt.trim() };
    const payload = JSON.stringify(input);
    if (!requestIdRef.current || requestIdRef.current.payload !== payload) requestIdRef.current = { payload, id: crypto.randomUUID() };
    pendingRef.current = true; setPending(true); setPostError('');
    try {
      const created = await request<SpaceMission>(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, requestId: requestIdRef.current.id }) });
      if (!aliveRef.current) return;
      requestIdRef.current = null; setTitle(''); setPrompt('');
      router.push(missionUrl(spaceId, created.id));
    } catch (caught) {
      if (!aliveRef.current || isSpaceAbort(caught)) return;
      if (missionAccessDenied(caught)) { setTitle(''); setPrompt(''); onUnavailable(); }
      else { setPostError(caught instanceof Error ? caught.message : 'Mission konnte nicht erstellt werden.'); void load(); }
    } finally { pendingRef.current = false; if (aliveRef.current) setPending(false); }
  }

  const hasOpen = items.some(item => !item.closedAt);
  return <section aria-labelledby={headingId} className="mt-8 border-b pb-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id={headingId} className="text-xl font-semibold">Gemeinsam erklären</h2><p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">Eine freiwillige Mission für bis zu fünf Personen in diesem privaten Space.</p></div>
      {canManage && !hasOpen && !loading && <Button ref={createButtonRef} type="button" variant="outline" aria-expanded={showForm} aria-controls={`${headingId}-form`} onClick={() => showForm ? closeForm() : setShowForm(true)}>{showForm ? 'Schließen' : 'Mission starten'}</Button>}
    </div>
    {showForm && canManage && <form id={`${headingId}-form`} onSubmit={create} onKeyDown={event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); closeForm(); } }} aria-describedby={postError ? errorId : undefined} className="mt-5 max-w-3xl space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">Zwei Personen teilen je eine Erkenntnis. Eine Person baut auf der Erkenntnis einer anderen auf. Ohne Frist oder Einfluss auf den Kursfortschritt.</p>
      <div className="space-y-2"><label htmlFor={titleId} className="text-sm font-medium">Thema</label><Input ref={titleRef} id={titleId} value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={100} required aria-required="true" /></div>
      <div className="space-y-2"><label htmlFor={promptId} className="text-sm font-medium">Aufgabe</label><Textarea id={promptId} value={prompt} onChange={event => setPrompt(event.target.value)} minLength={10} maxLength={2000} required aria-required="true" rows={4} /></div>
      {postError && <p id={errorId} role="alert" className="text-sm text-destructive">{postError}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending} aria-busy={pending}>{pending ? 'Wird erstellt…' : 'Mission erstellen'}</Button><Button type="button" variant="ghost" disabled={pending} onClick={closeForm}>Abbrechen</Button></div>
    </form>}
    {loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Missionen werden geladen…</p> : <>
      {items.length > 0 ? <ul className="mt-5 divide-y border-t">{items.map(item => <li key={item.id} className="min-w-0 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><Link prefetch={false} href={missionUrl(spaceId, item.id)} className="min-w-0 rounded-sm text-base font-semibold underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><span className="[overflow-wrap:anywhere]">{item.title}</span></Link><span className="text-sm text-muted-foreground">{item.closedAt ? 'Geschlossen' : 'Offen'} · {item.participants.length}/{item.participantLimit} dabei</span></div>
        <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.prompt}</p>
        <p className="mt-2 text-xs text-muted-foreground"><time dateTime={item.createdAt}>{spaceDate(item.createdAt)}</time>{item.participation.active ? ' · Du nimmst teil' : ''}</p>
      </li>)}</ul> : !error && <p className="mt-5 text-sm text-muted-foreground">Noch keine Mission. {canManage ? 'Starte einen freiwilligen Austausch zu einem Thema.' : 'Admins können hier einen freiwilligen Austausch starten.'}</p>}
      {items.length > 0 && <p ref={resultRef} tabIndex={-1} role="status" className="mt-3 text-xs text-muted-foreground">{items.length} Mission{items.length === 1 ? '' : 'en'} geladen</p>}
      {cursor && <Button type="button" variant="outline" className="mt-4" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Wird geladen…' : 'Weitere Missionen laden'}</Button>}
    </>}
    {error && <div className="mt-4"><p role="alert" className="text-sm text-destructive">{error}</p>{!cursor && <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>Missionen erneut laden</Button>}</div>}
  </section>;
}
