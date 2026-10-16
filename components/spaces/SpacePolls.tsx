'use client';

/* Friendly ballot choices; all vote and access decisions stay server-owned. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FriendlyMotionToggle, useFriendlyMotion } from '@/components/community/FriendlyMotion';
import styles from './SpacePolls.module.css';
import { useSpaceListGeneration } from '@/hooks/useSpaceAccess';
import { apiSpaceUrl, isSpaceAbort, revalidateSpacePages, spaceDate, SpaceHttpError, type SpacePage } from './space-api';
import type { PollRequest, SpacePoll } from './poll-api';

type PollFocusIntent = { origin: HTMLElement; manage: boolean };

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
  const [confirmedPoll, setConfirmedPoll] = useState<string | null>(null);
  const motion = useFriendlyMotion();
  const beginRead = useSpaceListGeneration();
  const countRef = useRef(0);
  const alive = useRef(true);
  const lock = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const restorePollFocus = useRef<{ id: string; manage: boolean } | null>(null);
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
    setLoading(true); setItems([]); setCursor(null); setError(''); setConfirmedPoll(null);
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
  useEffect(() => {
    if (!confirmedPoll) return;
    const timer = setTimeout(() => setConfirmedPoll(null), 450);
    return () => clearTimeout(timer);
  }, [confirmedPoll]);
  useLayoutEffect(() => {
    if (loading || !restorePollFocus.current) return;
    const target = restorePollFocus.current;
    restorePollFocus.current = null;
    if (document.activeElement !== document.body) return;
    const card = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-poll-id]') ?? []).find(item => item.dataset.pollId === target.id);
    const control = target.manage ? card?.querySelector<HTMLElement>('[data-poll-manage]')
      : card?.querySelector<HTMLElement>('[data-poll-vote]:not(:disabled)')
        ?? card?.querySelector<HTMLElement>('input:checked:not(:disabled)')
        ?? card?.querySelector<HTMLElement>('input:not(:disabled)');
    (control ?? card)?.focus();
  }, [items, loading]);
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

  async function recheckPoll(pollId: string, confirmed = false, intent?: PollFocusIntent | null) {
    const focused = document.activeElement;
    // Chromium can blur a focused button as soon as pending disables it. Carry
    // the pre-write intent across that blur, but never override another control.
    restorePollFocus.current = focused === document.body && intent ? { id: pollId, manage: intent.manage }
      : focused instanceof HTMLElement && focused.closest('[data-poll-id]')?.getAttribute('data-poll-id') === pollId
        ? { id: pollId, manage: Boolean(focused.closest('details')) } : null;
    await load();
    if (alive.current && confirmed) setConfirmedPoll(pollId);
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

  return <section ref={rootRef} aria-labelledby={headingId} className={styles.section}>
    <div className={styles.sectionHeader}>
      <div className={styles.intro}>
        <BallotIllustration />
        <div className="min-w-0"><p className={styles.eyebrow}>Gemeinsam entscheiden</p><h2 id={headingId} className={styles.sectionTitle}>Umfragen</h2><p className="mt-1 text-sm text-muted-foreground">Eine Frage. Deine Perspektive.</p></div>
      </div>
      <div className={styles.headerActions}><FriendlyMotionToggle />
        {canManage && <Button ref={buttonRef} type="button" variant="outline" disabled={pending} aria-expanded={formOpen} aria-controls={formId} onClick={() => formOpen ? closeForm() : setFormOpen(true)}>{formOpen ? 'Schließen' : 'Umfrage erstellen'}</Button>}
      </div>
    </div>
    <div className={styles.privacy}>
      <p>Freiwillig · Eine Stimme pro Person</p>
      <p>In kleinen Gruppen können Antworten erkennbar sein. Keine sensiblen Fragen.</p>
      <details className={styles.details}><summary>So wird gezählt</summary><p>Angezeigt werden nur Summen und deine eigene Auswahl. Solange die Umfrage offen ist, kannst du deine Auswahl ändern.</p></details>
    </div>
    {canManage && formOpen && <form id={formId} onSubmit={create} onKeyDown={event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); closeForm(); } }} className="mt-5 max-w-3xl space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
      <div className="space-y-2"><label htmlFor={questionId} className="text-sm font-medium">Frage</label><Input ref={questionRef} id={questionId} value={question} onChange={event => setQuestion(event.target.value)} minLength={5} maxLength={200} required disabled={pending} /></div>
      <fieldset className="min-w-0 space-y-3"><legend className="mb-2 text-sm font-medium">Antworten (2 bis 8)</legend>{options.map((label, index) => <div key={index} className="space-y-1"><label htmlFor={`${formId}-option-${index}`} className="text-sm">Antwort {index + 1}</label><Input ref={index === options.length - 1 ? lastOptionRef : undefined} id={`${formId}-option-${index}`} value={label} onChange={event => setOptions(previous => previous.map((value, at) => at === index ? event.target.value : value))} maxLength={100} required disabled={pending} /></div>)}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || options.length >= 8} onClick={() => { focusOptionRef.current = true; setOptions(previous => [...previous, '']); }}>Antwort hinzufügen</Button><Button type="button" variant="ghost" disabled={pending || options.length <= 2} onClick={() => { focusOptionRef.current = true; setOptions(previous => previous.slice(0, -1)); }}>Letzte entfernen</Button></div>
      </fieldset>
      {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending} aria-busy={pending}>{pending ? 'Wird erstellt…' : 'Umfrage veröffentlichen'}</Button><Button type="button" variant="ghost" disabled={pending} onClick={closeForm}>Abbrechen</Button></div>
    </form>}
    {items.length > 0 && <ul className={styles.pollList}>{items.map(item => <li key={`${item.id}:${item.ownVote.revision}:${item.moderationRevision}:${item.closedAt}`} className="min-w-0"><PollCard poll={item} base={base} request={request} confirmed={motion.enabled && confirmedPoll === item.id} onChange={(confirmed, intent) => recheckPoll(item.id, confirmed, intent)} onUnavailable={onUnavailable} /></li>)}</ul>}
    {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Umfragen werden geladen…</p>}
    {!loading && !error && items.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Noch keine Umfragen. Admins können eine Frage zur gemeinsamen Entscheidung stellen.</p>}
    {error && <div className="mt-4"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>Umfragen erneut laden</Button></div>}
    {cursor && <Button type="button" variant="outline" className="mt-4" disabled={loading} onClick={more}>Weitere Umfragen laden</Button>}
  </section>;
}

function PollCard({ poll, base, request, onChange, onUnavailable, confirmed }: {
  poll: SpacePoll; base: string; request: PollRequest; onChange: (confirmed?: boolean, intent?: PollFocusIntent | null) => Promise<void>; onUnavailable: () => void; confirmed: boolean;
}) {
  const id = useId();
  const [choice, setChoice] = useState(poll.ownVote.optionId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false); const alive = useRef(true);
  const writeFocus = useRef<PollFocusIntent | null>(null);
  const receipt = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useLayoutEffect(() => {
    if (pending || !writeFocus.current) return;
    const intent = writeFocus.current;
    writeFocus.current = null;
    // A failed write keeps this card mounted. Restore the original action only
    // after React has re-enabled it, including an explicit receipt retry.
    if (document.activeElement === document.body && intent.origin.isConnected && !intent.origin.matches(':disabled')) {
      intent.origin.focus();
    }
  }, [pending]);

  async function write(body: object, vote = false) {
    if (lock.current) return;
    const payload = JSON.stringify(body);
    if (vote && receipt.current?.payload !== payload) receipt.current = { payload, id: crypto.randomUUID() };
    const focused = document.activeElement;
    const intent = focused instanceof HTMLElement && focused.closest('[data-poll-id]')?.getAttribute('data-poll-id') === poll.id
      ? { origin: focused, manage: Boolean(focused.closest('details')) } : null;
    writeFocus.current = intent;
    lock.current = true; setPending(true); setError('');
    try {
      await request<SpacePoll>(`${base}/${encodeURIComponent(poll.id)}${vote ? '/vote' : ''}`, {
        method: vote ? 'PUT' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vote ? { ...body, requestId: receipt.current!.id } : body),
      });
      if (alive.current) await onChange(true, intent);
    } catch (caught) {
      if (!alive.current || isSpaceAbort(caught)) return;
      if (caught instanceof SpaceHttpError && [401, 403, 404].includes(caught.status)) { onUnavailable(); return; }
      setError(caught instanceof Error ? caught.message : 'Änderung konnte nicht gespeichert werden.');
    } finally { lock.current = false; if (alive.current) setPending(false); }
  }

  return <article aria-labelledby={`${id}-question`} className={styles.pollCard} tabIndex={-1} data-poll-id={poll.id} data-confirmed={confirmed || undefined}>
    <div className={styles.pollMeta}><span className={styles.state}>{poll.closedAt ? 'Geschlossen' : 'Offen'}{poll.hiddenAt ? ' · Ausgeblendet' : ''}</span><time dateTime={poll.createdAt}>{spaceDate(poll.createdAt)}</time></div>
    <h3 id={`${id}-question`} className={styles.question}>{poll.question}</h3>
    <form className="mt-4" onSubmit={event => { event.preventDefault(); if (poll.canVote && choice) void write({ optionId: choice, expectedRevision: poll.ownVote.revision }, true); }}>
      <fieldset disabled={!poll.canVote || pending} className={styles.choices}><legend className="sr-only">Deine Auswahl zu: {poll.question}</legend>{poll.options.map((option, index) => {
        const percentage = poll.totalVotes > 0 ? Math.round(option.votes / poll.totalVotes * 100) : 0;
        const saved = poll.ownVote.optionId === option.id;
        return <label key={option.id} className={styles.choice} data-saved={saved || undefined}>
          <span aria-hidden="true" className={styles.choiceLetter}>{choice === option.id ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> : String.fromCharCode(65 + index)}</span>
          <input className={styles.radio} type="radio" name={id} value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} />
          <span className={styles.choiceBody}><span className={styles.choiceTop}><span className={styles.choiceLabel}>{option.label}</span><span className={styles.percentage}>{percentage}%</span></span>
            <span className={styles.track} aria-hidden="true"><span className={styles.bar} style={{ width: `${percentage}%` }} /></span>
            <span className={styles.choiceBottom}><span>{option.votes} Stimme{option.votes === 1 ? '' : 'n'}</span>{saved && <span className={styles.saved}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Deine gespeicherte Auswahl</span>}</span>
          </span>
        </label>;
      })}</fieldset>
      <div className={styles.voteFooter}><p className="text-sm text-muted-foreground" role="status">{poll.totalVotes} Stimme{poll.totalVotes === 1 ? '' : 'n'} insgesamt</p>
        {poll.canVote && <Button type="submit" data-poll-vote="" className={styles.voteButton} disabled={pending || !choice || choice === poll.ownVote.optionId} aria-busy={pending}>{pending ? 'Wird gespeichert…' : poll.ownVote.optionId ? 'Auswahl ändern' : 'Abstimmen'}</Button>}
      </div>
      {!poll.canVote && !poll.closedAt && !poll.hiddenAt && <p className="mt-3 text-sm text-muted-foreground">Tritt dem Space bei, um abzustimmen.</p>}
    </form>
    {poll.canManage && <details className={styles.manage}><summary data-poll-manage="">Umfrage verwalten</summary><div className="mt-2 flex flex-wrap gap-2">{!poll.closedAt && <Button type="button" variant="ghost" disabled={pending} onClick={() => void write({ closed: true })}>Umfrage schließen</Button>}<Button type="button" variant="ghost" disabled={pending} onClick={() => void write({ hidden: !poll.hiddenAt, expectedRevision: poll.moderationRevision })}>{poll.hiddenAt ? 'Umfrage einblenden' : 'Umfrage ausblenden'}</Button></div></details>}
    {error && <div className="mt-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="ghost" onClick={() => void onChange()}>Aktuellen Stand laden</Button></div>}
  </article>;
}

function BallotIllustration() {
  return <svg aria-hidden="true" className={styles.illustration} viewBox="0 0 88 76" fill="none">
    <rect x="17" y="12" width="48" height="53" rx="12" transform="rotate(-10 17 12)" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
    <rect x="27" y="7" width="47" height="57" rx="12" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1.6" />
    <path d="M39 24h23M39 44h13" stroke="hsl(var(--border))" strokeWidth="3" strokeLinecap="round" />
    <rect x="35" y="31" width="31" height="22" rx="7" fill="hsl(var(--accent))" />
    <path d="m43 42 5 5 11-12" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m12 26 3 3-3 3-3-3 3-3ZM77 15v7m-3-3h6" stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
