'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FriendlyMotionToggle, useFriendlyMotion } from '@/components/community/FriendlyMotion';
import styles from './EventParticipation.module.css';
import { parseEventParticipation, type EventParticipationState } from './participation-state';

type EventSummary = { id: string; title: string; date: string; attendeeCount: number; maxAttendees: number | null };
type Props = { event: EventSummary; viewerId: string | null };
type Phase = 'loading' | 'ready' | 'saving' | 'error' | 'unauthorized' | 'unavailable';
type Action = 'join' | 'queue' | 'leave';
const changedEvent = 'forge:event-participation-changed';
class ReadFailure extends Error {
  constructor(public readonly phase: Phase, message: string) { super(message); }
}

async function responseState(response: Response) {
  if (response.status === 401) throw new ReadFailure('unauthorized', 'Deine Anmeldung ist nicht mehr gültig. Bitte melde dich erneut an.');
  if (response.status === 404) throw new ReadFailure('unavailable', 'Dieses Event ist nicht mehr verfügbar.');
  if (!response.ok) throw new ReadFailure('error', 'Der Teilnahmestatus konnte nicht bestätigt werden. Bitte lade ihn erneut.');
  return parseEventParticipation(await response.json());
}

export function EventParticipation(props: Props) {
  return <ParticipationPanel key={`${props.viewerId ?? 'guest'}:${props.event.id}`} {...props} />;
}

function ParticipationPanel({ event, viewerId }: Props) {
  const [state, setState] = useState<EventParticipationState | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmedChange, setConfirmedChange] = useState(false);
  const motion = useFriendlyMotion();
  const root = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const visible = useRef(false);
  const writing = useRef(false);
  const revalidateAfterWrite = useRef(false);
  const sequence = useRef(0);
  const reading = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const lastState = useRef<EventParticipationState | null>(null);
  const focusAfterRead = useRef<'action' | 'refresh' | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const helpId = useId();
  const url = `/api/events/${encodeURIComponent(event.id)}/rsvp`;

  const refresh = useCallback(async (message: string | null = null) => {
    if (!viewerId || !active.current || writing.current || document.visibilityState === 'hidden') return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    const requestSequence = ++sequence.current;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    timers.current.add(timer);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && root.current?.contains(focused)) {
      focusAfterRead.current = focused.hasAttribute('data-participation-refresh') ? 'refresh' : 'action';
    } else if (focused !== document.body) focusAfterRead.current = null;
    setState(null); setPhase('loading'); setFeedback(message); setConfirmedChange(false);
    try {
      const result = await responseState(await fetch(url, { signal: controller.signal, cache: 'no-store' }));
      if (!active.current || controller.signal.aborted || requestSequence !== sequence.current) return;
      const promoted = lastState.current?.isWaitlisted && result.isAttending;
      setConfirmedChange(Boolean(lastState.current && changedParticipation(lastState.current, result)));
      lastState.current = result;
      setState(result); setPhase('ready');
      if (promoted && !message) setFeedback('Du bist jetzt für das Event angemeldet.');
    } catch (error) {
      if (!active.current || controller.signal.aborted && !timedOut || requestSequence !== sequence.current) return;
      lastState.current = null;
      setState(null); setPhase(error instanceof ReadFailure ? error.phase : 'error');
      setFeedback(error instanceof ReadFailure ? error.message : 'Der Teilnahmestatus konnte nicht geladen werden. Bitte versuche es erneut.');
    } finally { clearTimeout(timer); timers.current.delete(timer); }
  }, [url, viewerId]);

  useEffect(() => {
    if (!confirmedChange) return;
    const timer = setTimeout(() => setConfirmedChange(false), 450);
    return () => clearTimeout(timer);
  }, [confirmedChange]);

  useLayoutEffect(() => {
    if (phase === 'loading' || phase === 'saving') return;
    const target = focusAfterRead.current;
    focusAfterRead.current = null;
    // Clearing stale private data removes controls. Restore the nearest action
    // only if the caller has not moved focus elsewhere during the request.
    const focused = document.activeElement;
    const dialog = root.current?.closest('[role="dialog"]');
    // Radix moves focus to its dialog container when a focused child vanishes.
    if (target && (focused === document.body || focused === dialog)) {
      const control = root.current?.querySelector<HTMLElement>(target === 'refresh'
        ? '[data-participation-refresh]' : '[data-participation-action]') ?? root.current?.querySelector<HTMLElement>('button, a');
      control?.focus();
    }
  }, [phase, state]);

  useEffect(() => {
    active.current = true;
    // Long event lists read private state only as a panel enters the viewport.
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      const shown = entries.some(entry => entry.isIntersecting);
      const entered = shown && !visible.current;
      visible.current = shown;
      if (entered) void refresh();
    }, { rootMargin: '100px' }) : null;
    if (observer && root.current) observer.observe(root.current);
    else { visible.current = true; void refresh(); }
    const focus = () => { if (visible.current) void refresh(); };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        reading.current?.abort(); sequence.current++;
        setState(null); setPhase('loading'); setFeedback(null);
      } else focus();
    };
    const synchronize = (e: globalThis.Event) => {
      const detail = (e as CustomEvent<{ eventId: string; source?: string }>).detail;
      if (!visible.current || detail?.eventId !== event.id || detail.source === helpId) return;
      if (writing.current) revalidateAfterWrite.current = true;
      else void refresh();
    };
    const requestTimers = timers.current;
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener(changedEvent, synchronize);
    return () => {
      active.current = false;
      observer?.disconnect(); reading.current?.abort(); mutation.current?.abort();
      for (const timer of requestTimers) clearTimeout(timer);
      requestTimers.clear();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener(changedEvent, synchronize);
    };
  }, [event.id, helpId, refresh]);

  const change = async (action: Action) => {
    if (!viewerId || !state || phase !== 'ready' || writing.current) return;
    writing.current = true;
    reading.current?.abort(); sequence.current++;
    const controller = new AbortController(); mutation.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    timers.current.add(timer);
    setPhase('saving'); setFeedback(null); setConfirmedChange(false);
    try {
      const response = await fetch(url, { method: action === 'leave' ? 'DELETE' : 'POST', signal: controller.signal,
        ...(action === 'queue' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waitlist: true }) } : {}) });
      if (!active.current || controller.signal.aborted) return;
      if (response.status === 409) {
        writing.current = false;
        await refresh('Die Änderung konnte nicht bestätigt werden. Bitte prüfe den aktuellen Status und versuche es erneut.');
        return;
      }
      const result = await responseState(response);
      if (!active.current || controller.signal.aborted) return;
      if (document.visibilityState === 'hidden') {
        lastState.current = null; setState(null); setPhase('loading'); setFeedback(null); return;
      }
      setConfirmedChange(Boolean(lastState.current && changedParticipation(lastState.current, result)));
      lastState.current = result; setState(result); setPhase('ready');
      setFeedback(result.isWaitlisted ? 'Du stehst auf der Warteliste.' : result.isAttending ? 'Deine Anmeldung ist bestätigt.' : 'Deine Teilnahme wurde zurückgenommen.');
      // Other visible instances (list + deep-link dialog) must revalidate too.
      window.dispatchEvent(new CustomEvent(changedEvent, { detail: { eventId: event.id, source: helpId } }));
    } catch (error) {
      if (!active.current || controller.signal.aborted && !timedOut) return;
      lastState.current = null; setState(null);
      setPhase(error instanceof ReadFailure ? error.phase : 'error');
      setFeedback(error instanceof ReadFailure ? error.message : 'Die Änderung konnte nicht bestätigt werden. Lade vor einem weiteren Versuch den Teilnahmestatus erneut.');
    } finally {
      clearTimeout(timer); timers.current.delete(timer);
      if (active.current) {
        writing.current = false; mutation.current = null;
        if (revalidateAfterWrite.current) { revalidateAfterWrite.current = false; void refresh(); }
      }
    }
  };

  if (!viewerId) return <div className={styles.panel}>
    <div className={styles.statusRow}><SeatIllustration attending={false} waiting={false} /><p className="text-sm">Melde dich an, um teilzunehmen oder die Warteliste zu nutzen.</p></div>
    <Button size="sm" variant="outline" asChild><Link href="/login">Anmelden</Link></Button>
  </div>;

  const full = Boolean(state && state.maxAttendees !== null && state.attendeeCount >= state.maxAttendees);
  const closed = state?.registrationClosed || new Date(event.date) <= new Date();
  const action: Action = state?.isWaitlisted || state?.canCancelRsvp ? 'leave' : full ? 'queue' : 'join';
  const label = state?.isWaitlisted ? 'Warteliste verlassen' : state?.canCancelRsvp ? 'Zusage zurücknehmen'
    : state?.registrationState === 'ATTENDED' ? 'Teilgenommen' : closed ? 'Anmeldung geschlossen' : full ? 'Auf Warteliste setzen' : 'Teilnehmen';
  const disabled = phase !== 'ready' || state?.registrationState === 'ATTENDED' || closed && !state?.isWaitlisted && !state?.canCancelRsvp;
  const waitlistHelp = Boolean(state && (state.isWaitlisted || full && !state.isAttending && !closed));
  const duplicateFeedback = feedback === 'Du stehst auf der Warteliste.' || feedback === 'Deine Anmeldung ist bestätigt.';
  const status = phase === 'loading' ? 'Teilnahmestatus wird geladen …' : phase === 'saving' ? 'Änderung wird gespeichert …'
    : state?.isWaitlisted ? `Warteliste · Platz ${state.waitlistPosition}` : state?.isAttending ? state.registrationState === 'ATTENDED' ? 'Teilgenommen' : 'Du bist angemeldet'
      : state ? closed ? 'Anmeldung geschlossen' : full ? 'Ausgebucht' : 'Noch keine Zusage' : 'Status nicht verfügbar';
  return <div ref={root} role="region" aria-label={`Teilnahme: ${event.title}`} aria-busy={phase === 'loading' || phase === 'saving'} className={styles.panel} data-confirmed={motion.enabled && confirmedChange && state ? true : undefined}>
    <div className={styles.statusRow}>
      <SeatIllustration attending={Boolean(state?.isAttending)} waiting={Boolean(state?.isWaitlisted)} />
      <div className={styles.statusBody}>
        <p className={styles.eyebrow}>Deine Teilnahme</p>
        <p role="status" aria-live="polite" className={styles.status}>{status}</p>
        {state && <p className={styles.capacity}>{state.attendeeCount}{state.maxAttendees !== null ? ` / ${state.maxAttendees}` : ''} Zusagen</p>}
      </div>
    </div>
    {feedback && <p role={phase === 'error' || phase === 'unauthorized' || phase === 'unavailable' ? 'alert' : 'status'} aria-live="polite" className={duplicateFeedback ? 'sr-only' : styles.feedback}>{feedback}</p>}
    {state && <>
      {waitlistHelp && <p id={helpId} className={styles.help}>{closed ? 'Die Anmeldung ist geschlossen. Für dieses gestartete Event werden keine Plätze mehr vergeben.' : 'Freie Plätze werden der Reihe nach vergeben. Dann wirst du automatisch angemeldet. Jederzeit verlassen; kein Platz garantiert.'}</p>}
      <div className={styles.actions}>
        <Button type="button" size="sm" variant={action === 'leave' ? 'outline' : 'default'} className={styles.action} disabled={disabled}
          data-participation-action=""
          aria-describedby={waitlistHelp ? helpId : undefined} onClick={() => void change(action)}>
          {phase === 'saving' ? 'Wird verarbeitet …' : label}
        </Button>
        {state.isWaitlisted && phase === 'ready' && <Button type="button" size="sm" variant="ghost" data-participation-refresh="" className={styles.refresh} onClick={() => void refresh()}>Status aktualisieren</Button>}
      </div>
    </>}
    {(phase === 'error' || phase === 'unavailable') && <Button type="button" variant="outline" size="sm" className={styles.action} onClick={() => void refresh()}>Teilnahmestatus erneut laden</Button>}
    {phase === 'unauthorized' && <Button size="sm" variant="outline" asChild><Link href="/login">Erneut anmelden</Link></Button>}
    <div className={styles.motion}><FriendlyMotionToggle /></div>
  </div>;
}

function changedParticipation(previous: EventParticipationState, next: EventParticipationState) {
  return previous.registrationState !== next.registrationState || previous.waitlistPosition !== next.waitlistPosition;
}

function SeatIllustration({ attending, waiting }: { attending: boolean; waiting: boolean }) {
  return <svg aria-hidden="true" className={styles.seat} viewBox="0 0 76 76" fill="none">
    <circle cx="36" cy="38" r="32" fill="hsl(var(--muted))" />
    <path d="M24 39V23a7 7 0 0 1 7-7h12a7 7 0 0 1 7 7v16" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1.6" />
    <rect x="19" y="37" width="36" height="11" rx="5.5" fill="hsl(var(--coral-highlight))" stroke="hsl(var(--coral-highlight-foreground))" strokeWidth="1.6" />
    <path d="m25 48-3 13m27-13 3 13M28 30h17" stroke="hsl(var(--foreground))" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="58" cy="23" r="12" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1.5" />
    {attending ? <path className={styles.confirmationMark} d="m52 23 4 4 8-8" stroke="hsl(var(--success))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      : waiting ? <g stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeLinecap="round"><circle cx="58" cy="23" r="6" /><path d="M58 19v4l3 2" /></g>
        : <path d="M54 23h8m-4-4v8" stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeLinecap="round" />}
  </svg>;
}
