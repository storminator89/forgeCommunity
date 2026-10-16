'use client';

/* Editorial workbench · voluntary Space decisions · design.md tokens */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSpaceListGeneration } from '@/hooks/useSpaceAccess';
import { apiSpaceUrl, isSpaceAbort, revalidateSpacePages, spaceDate, SpaceHttpError, type SpacePage } from './space-api';
import type { PollRequest, SpacePoll } from './poll-api';

export function SpacePolls({ spaceId, canManage, request, onUnavailable }: {
  spaceId: string; canManage: boolean; request: PollRequest; onUnavailable: () => void;
}) {
  const base = `${apiSpaceUrl(spaceId)}/polls`;
  const headingId = useId(); const questionId = useId(); const formId = useId();
  const [items, setItems] = useState<SpacePoll[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [pending, setPending] = useState(false);
  const [createError, setCreateError] = useState('');
  const beginRead = useSpaceListGeneration();
  const countRef = useRef(0);
  const alive = useRef(true);
  const lock = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLInputElement>(null);
  const lastOptionRef = useRef<HTMLInputElement>(null);
  const focusOptionRef = useRef(false);
  const requestId = useRef<{ payload: string; id: string } | null>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const handleError = useCallback((caught: unknown, message: string) => {
    if (isSpaceAbort(caught)) return;
    if (caught instanceof SpaceHttpError && [401, 403, 404].includes(caught.status)) {
      setItems([]); setQuestion(''); setOptions(['', '']); onUnavailable();
    } else setError(message);
  }, [onUnavailable]);

  const load = useCallback(async () => {
    const read = beginRead();
    setLoading(true); setItems([]); setCursor(null); setError('');
    try {
      const page = await revalidateSpacePages<SpacePoll>(base, countRef.current,
        <T,>(path: string) => request<T>(path, { signal: read.signal }));
      if (!read.isCurrent()) return;
      countRef.current = page.items.length; setItems(page.items); setCursor(page.nextCursor);
    } catch (caught) { if (read.isCurrent()) handleError(caught, 'Umfragen konnten nicht geladen werden.'); }
    finally { if (read.isCurrent()) setLoading(false); }
  }, [base, beginRead, handleError, request]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    const recheck = () => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', recheck); document.addEventListener('visibilitychange', recheck);
    return () => { active = false; window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [load]);
  useEffect(() => { if (formOpen) questionRef.current?.focus(); }, [formOpen]);
  useEffect(() => { if (focusOptionRef.current) { focusOptionRef.current = false; lastOptionRef.current?.focus(); } }, [options.length]);

  async function more() {
    if (!cursor || loading) return;
    const read = beginRead(); setLoading(true); setError('');
    try {
      const page = await request<SpacePage<SpacePoll>>(`${base}?cursor=${encodeURIComponent(cursor)}`, { signal: read.signal });
      if (!read.isCurrent()) return;
      setItems(previous => {
        const next = [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))];
        countRef.current = next.length; return next;
      });
      setCursor(page.nextCursor);
    } catch (caught) { if (read.isCurrent()) handleError(caught, 'Weitere Umfragen konnten nicht geladen werden.'); }
    finally { if (read.isCurrent()) setLoading(false); }
  }

  function closeForm() {
    setFormOpen(false); setQuestion(''); setOptions(['', '']); setCreateError(''); requestId.current = null;
    buttonRef.current?.focus();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !canManage) return;
    const input = { question: question.trim(), options: options.map(label => label.trim()) };
    const payload = JSON.stringify(input);
    if (requestId.current?.payload !== payload) requestId.current = { payload, id: crypto.randomUUID() };
    lock.current = true; setPending(true); setCreateError('');
    try {
      await request<SpacePoll>(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, requestId: requestId.current.id }) });
      if (!alive.current) return;
      closeForm(); await load();
    } catch (caught) {
      if (!alive.current || isSpaceAbort(caught)) return;
      if (caught instanceof SpaceHttpError && [401, 403, 404].includes(caught.status)) handleError(caught, '');
      else setCreateError(caught instanceof Error ? caught.message : 'Umfrage konnte nicht erstellt werden.');
    } finally { lock.current = false; if (alive.current) setPending(false); }
  }

  return <section aria-labelledby={headingId} className="mt-8 border-b pb-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 max-w-[68ch]"><h2 id={headingId} className="flex items-center gap-2 text-xl font-semibold"><svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 17h14M5 13V9m5 4V4m5 9V7" /></svg>Umfragen</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Freiwillig abstimmen, mit einer Stimme pro Person. Angezeigt werden Summen und deine eigene Auswahl. In kleinen Gruppen können Antworten trotzdem erkennbar sein. Bitte keine sensiblen Fragen stellen.</p></div>
      {canManage && <Button ref={buttonRef} type="button" variant="outline" disabled={pending} aria-expanded={formOpen} aria-controls={formId} onClick={() => formOpen ? closeForm() : setFormOpen(true)}>{formOpen ? 'Schließen' : 'Umfrage erstellen'}</Button>}
    </div>
    {canManage && formOpen && <form id={formId} onSubmit={create} onKeyDown={event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); closeForm(); } }} className="mt-5 max-w-3xl space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
      <div className="space-y-2"><label htmlFor={questionId} className="text-sm font-medium">Frage</label><Input ref={questionRef} id={questionId} value={question} onChange={event => setQuestion(event.target.value)} minLength={5} maxLength={200} required disabled={pending} /></div>
      <fieldset className="min-w-0 space-y-3"><legend className="mb-2 text-sm font-medium">Antworten (2 bis 8)</legend>{options.map((label, index) => <div key={index} className="space-y-1"><label htmlFor={`${formId}-option-${index}`} className="text-sm">Antwort {index + 1}</label><Input ref={index === options.length - 1 ? lastOptionRef : undefined} id={`${formId}-option-${index}`} value={label} onChange={event => setOptions(previous => previous.map((value, at) => at === index ? event.target.value : value))} maxLength={100} required disabled={pending} /></div>)}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || options.length >= 8} onClick={() => { focusOptionRef.current = true; setOptions(previous => [...previous, '']); }}>Antwort hinzufügen</Button><Button type="button" variant="ghost" disabled={pending || options.length <= 2} onClick={() => { focusOptionRef.current = true; setOptions(previous => previous.slice(0, -1)); }}>Letzte entfernen</Button></div>
      </fieldset>
      {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending} aria-busy={pending}>{pending ? 'Wird erstellt…' : 'Umfrage veröffentlichen'}</Button><Button type="button" variant="ghost" disabled={pending} onClick={closeForm}>Abbrechen</Button></div>
    </form>}
    {items.length > 0 && <ul className="mt-5 divide-y border-t">{items.map(item => <li key={`${item.id}:${item.ownVote.revision}:${item.moderationRevision}:${item.closedAt}`} className="min-w-0 py-5"><PollCard poll={item} base={base} request={request} onChange={load} onUnavailable={onUnavailable} /></li>)}</ul>}
    {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Umfragen werden geladen…</p>}
    {!loading && !error && items.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Noch keine Umfragen. Admins können eine Frage zur gemeinsamen Entscheidung stellen.</p>}
    {error && <div className="mt-4"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>Umfragen erneut laden</Button></div>}
    {cursor && <Button type="button" variant="outline" className="mt-4" disabled={loading} onClick={more}>Weitere Umfragen laden</Button>}
  </section>;
}

function PollCard({ poll, base, request, onChange, onUnavailable }: {
  poll: SpacePoll; base: string; request: PollRequest; onChange: () => Promise<void>; onUnavailable: () => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState(poll.ownVote.optionId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false); const alive = useRef(true);
  const receipt = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function write(body: object, vote = false) {
    if (lock.current) return;
    const payload = JSON.stringify(body);
    if (vote && receipt.current?.payload !== payload) receipt.current = { payload, id: crypto.randomUUID() };
    lock.current = true; setPending(true); setError('');
    try {
      await request<SpacePoll>(`${base}/${encodeURIComponent(poll.id)}${vote ? '/vote' : ''}`, {
        method: vote ? 'PUT' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vote ? { ...body, requestId: receipt.current!.id } : body),
      });
      if (alive.current) await onChange();
    } catch (caught) {
      if (!alive.current || isSpaceAbort(caught)) return;
      if (caught instanceof SpaceHttpError && [401, 403, 404].includes(caught.status)) { onUnavailable(); return; }
      setError(caught instanceof Error ? caught.message : 'Änderung konnte nicht gespeichert werden.');
    } finally { lock.current = false; if (alive.current) setPending(false); }
  }

  return <article aria-labelledby={`${id}-question`} className="max-w-3xl">
    <h3 id={`${id}-question`} className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{poll.question}</h3>
    <p className="mt-1 text-xs text-muted-foreground"><time dateTime={poll.createdAt}>{spaceDate(poll.createdAt)}</time> · {poll.closedAt ? 'Geschlossen' : 'Offen'}{poll.hiddenAt ? ' · Ausgeblendet' : ''}</p>
    <form className="mt-3" onSubmit={event => { event.preventDefault(); if (poll.canVote && choice) void write({ optionId: choice, expectedRevision: poll.ownVote.revision }, true); }}>
      <fieldset disabled={!poll.canVote || pending} className="min-w-0 space-y-2"><legend className="sr-only">Deine Auswahl zu: {poll.question}</legend>{poll.options.map(option => <label key={option.id} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"><input className="mt-0.5 h-4 w-4 shrink-0 accent-primary" type="radio" name={id} value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} /><span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{option.label}{poll.ownVote.optionId === option.id && <span className="block text-xs font-medium">Deine gespeicherte Auswahl</span>}</span><span className="shrink-0 tabular-nums">{option.votes} <span className="sr-only">Stimmen</span></span></label>)}</fieldset>
      <p className="mt-3 text-sm text-muted-foreground" role="status">{poll.totalVotes} Stimme{poll.totalVotes === 1 ? '' : 'n'} insgesamt</p>
      {poll.canVote && <Button type="submit" variant="outline" className="mt-3" disabled={pending || !choice || choice === poll.ownVote.optionId} aria-busy={pending}>{pending ? 'Wird gespeichert…' : poll.ownVote.optionId ? 'Auswahl ändern' : 'Abstimmen'}</Button>}
      {!poll.canVote && !poll.closedAt && !poll.hiddenAt && <p className="mt-3 text-sm text-muted-foreground">Tritt dem Space bei, um abzustimmen.</p>}
    </form>
    {poll.canManage && <div className="mt-4 flex flex-wrap gap-2">{!poll.closedAt && <Button type="button" variant="ghost" disabled={pending} onClick={() => void write({ closed: true })}>Umfrage schließen</Button>}<Button type="button" variant="ghost" disabled={pending} onClick={() => void write({ hidden: !poll.hiddenAt, expectedRevision: poll.moderationRevision })}>{poll.hiddenAt ? 'Umfrage einblenden' : 'Umfrage ausblenden'}</Button></div>}
    {error && <div className="mt-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="ghost" onClick={() => void onChange()}>Aktuellen Stand laden</Button></div>}
  </article>;
}
