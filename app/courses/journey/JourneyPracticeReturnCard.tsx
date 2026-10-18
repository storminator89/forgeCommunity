'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PRACTICE_SESSION_LIMIT } from '@/lib/formative-practice-availability';
import { practiceReturnLabel } from '../[courseId]/practice/learn/PracticeAvailabilityNotice';
import { getLearnerPractice, PracticeLearnerApiError, type PracticeLearnerState } from '../[courseId]/practice/learn/practice-learner-api';

type Metadata = Pick<PracticeLearnerState, 'status' | 'availability' | 'dueCount' | 'nextAvailableAt' | 'publicationId' | 'snapshotId'>;
type Projection = { kind: 'ready'; metadata: Metadata } | { kind: 'invalid' | 'publicationChanged' };
type CardState = Projection | { kind: 'loading' | 'error' | 'signIn' | 'accessChanged' | 'unsafe' | 'versionConflict' | 'outOfScope' };
type Props = {
  courseId: string;
  publicationId: string;
  signInHref: string;
  isCurrentSelection: () => boolean;
  onRefreshCourse: () => void;
  onRefreshCourses: () => void;
};

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;
const actionClass = 'h-auto min-h-11 w-full max-w-full whitespace-normal py-2 text-center transition-none active:translate-y-0 [overflow-wrap:anywhere] sm:w-auto';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const has = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** The server serializes Dates as canonical ISO JSON timestamps. Reject invalid
 * or normalized dates rather than manufacturing an effective return window. */
function returnDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Inspect a pending question only for contract consistency, then discard it.
 * Neither its content nor session/reservation IDs enter component state. */
function validPending(value: unknown, answeredCount: number) {
  if (!record(value) || !onlyKeys(value, ['reservationId', 'ordinal', 'item']) || !text(value.reservationId) ||
      !integer(value.ordinal, 1, PRACTICE_SESSION_LIMIT) || value.ordinal !== answeredCount + 1 || !record(value.item)) return false;
  const item = value.item;
  return onlyKeys(item, ['itemId', 'itemRevision', 'objectiveTitle', 'prompt', 'options']) &&
    text(item.itemId) && integer(item.itemRevision, 1, Number.MAX_SAFE_INTEGER) &&
    typeof item.objectiveTitle === 'string' && text(item.prompt) &&
    Array.isArray(item.options) && item.options.length >= 2 && item.options.length <= 8 && item.options.every(text);
}

/** The API wrapper casts JSON. Validate every display-relevant combination at
 * this boundary; unpinned negative states must never create a practice link. */
function projectMetadata(value: unknown, publicationId: string): Projection {
  const invalid: Projection = { kind: 'invalid' };
  if (!record(value) || !onlyKeys(value, ['status', 'availability', 'dueCount', 'nextAvailableAt', 'publicationId', 'snapshotId', 'session']) ||
      !integer(value.dueCount, 0, PRACTICE_SESSION_LIMIT) || !returnDate(value.nextAvailableAt)) return invalid;
  const { status, availability, dueCount, nextAvailableAt } = value;
  if (status === 'off' || status === 'archived' || status === 'unpublished') {
    if (availability !== 'unavailable' || dueCount !== 0 || nextAvailableAt !== null ||
        has(value, 'session') || has(value, 'publicationId') || has(value, 'snapshotId')) return invalid;
    return { kind: 'ready', metadata: { status, availability, dueCount, nextAvailableAt } };
  }
  if (!text(value.publicationId) || !text(value.snapshotId)) return invalid;
  let valid = false;
  if (status === 'active') {
    const session = value.session;
    if (!record(session) || !onlyKeys(session, ['id', 'answeredCount', 'pending']) || !text(session.id) ||
        !integer(session.answeredCount, 0, PRACTICE_SESSION_LIMIT)) return invalid;
    const pending = has(session, 'pending');
    if (pending && !validPending(session.pending, session.answeredCount)) return invalid;
    const remaining = Math.max(0, PRACTICE_SESSION_LIMIT - session.answeredCount - (pending ? 1 : 0));
    if (dueCount > remaining) return invalid;
    valid = pending
      ? availability === 'resume' && nextAvailableAt === null
      : availability === 'ready' ? dueCount > 0 && nextAvailableAt === null
        : availability === 'sessionComplete' && dueCount === 0;
  } else if (!has(value, 'session')) {
    valid = status === 'available' ? availability === 'notOptedIn' && dueCount === 0 && nextAvailableAt === null
      : status === 'paused' ? availability === 'paused' && dueCount === 0 && nextAvailableAt === null
        : status === 'ready' ? availability === 'ready' && dueCount > 0 && nextAvailableAt === null
          : status === 'complete' ? availability === 'waiting' && dueCount === 0
            : status === 'unavailable' && availability === 'unavailable' && dueCount === 0 && nextAvailableAt === null;
  }
  if (!valid) return invalid;
  if (value.publicationId !== publicationId) return { kind: 'publicationChanged' };
  return { kind: 'ready', metadata: {
    status: status as Metadata['status'], availability: availability as Metadata['availability'],
    dueCount, nextAvailableAt, publicationId: value.publicationId, snapshotId: value.snapshotId,
  } };
}

function describe(metadata: Metadata): { message: string; link?: string } {
  const { status, availability, dueCount } = metadata;
  if (status === 'available') return { message: 'Für diesen Kurs gibt es freiwillige private Übungen. Privates Üben ist noch ausgeschaltet.', link: 'Üben kennenlernen' };
  if (status === 'paused') return { message: 'Privates Üben ist pausiert. Deine bisherigen Übungsdaten bleiben gespeichert.', link: 'Pausierte Übung ansehen' };
  if (status === 'ready') return { message: `${dueCount === 1 ? '1 Frage ist' : `${dueCount} Fragen sind`} jetzt verfügbar. Du öffnest jede Frage selbst.`, link: 'Zur privaten Übung' };
  if (status === 'active' && availability === 'resume') return { message: 'Eine bereits geöffnete Frage wartet auf dich.', link: 'Übung fortsetzen' };
  if (status === 'active' && availability === 'ready') return { message: `In deiner Sitzung ${dueCount === 1 ? 'ist 1 weitere Frage' : `sind ${dueCount} weitere Fragen`} verfügbar.`, link: 'Übung fortsetzen' };
  if (status === 'active') return { message: 'In dieser Sitzung ist gerade keine weitere Frage verfügbar. Schließe sie bewusst ab, bevor du eine neue Sitzung beginnst.', link: 'Sitzung ansehen' };
  if (status === 'complete') return { message: 'Gerade ist keine Frage verfügbar.' };
  if (status === 'unavailable') return { message: 'Privates Üben ist vorübergehend nicht verfügbar. Bitte prüfe den Stand später erneut.' };
  if (status === 'off') return { message: 'Für die aktuelle Kursversion gibt es noch keinen veröffentlichten Übungspool.' };
  if (status === 'archived') return { message: 'Der bisherige Übungspool passt nicht mehr zur aktuellen Kursversion.' };
  return { message: 'Der Kurs hat derzeit keine veröffentlichte Lernversion. Prüfe den Kursstand erneut.' };
}

export function JourneyPracticeReturnCard({ courseId, publicationId, signInHref, isCurrentSelection, onRefreshCourse, onRefreshCourses }: Props) {
  const [state, setState] = useState<CardState>({ kind: 'loading' });
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [windowReached, setWindowReached] = useState(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRequest = useCallback(() => {
    sequence.current++;
    request.current?.abort();
    request.current = null;
    if (timeout.current !== null) clearTimeout(timeout.current);
    timeout.current = null;
  }, []);

  const load = useCallback((synchronous = false) => {
    cancelRequest();
    if (!mounted.current || !isCurrentSelection()) return;
    const clearPrivateState = () => { setState({ kind: 'loading' }); setNeedsRefresh(false); setWindowReached(false); };
    if (synchronous) flushSync(clearPrivateState); else clearPrivateState();
    const controller = new AbortController();
    request.current = controller;
    const current = sequence.current;
    const currentScope = () => mounted.current && current === sequence.current && !controller.signal.aborted && isCurrentSelection();
    timeout.current = setTimeout(() => {
      if (!currentScope()) return;
      cancelRequest();
      setState({ kind: 'error' });
    }, REQUEST_TIMEOUT_MS);
    void getLearnerPractice(courseId, controller.signal).then((value: unknown) => {
      if (!currentScope()) return;
      const projection: CardState = value === null ? { kind: 'error' } : projectMetadata(value, publicationId);
      if (currentScope()) setState(projection);
    }).catch(error => {
      if (!currentScope()) return;
      const status = error instanceof PracticeLearnerApiError ? error.status : null;
      setState({ kind: status === 401 ? 'signIn' : status === 403 || status === 404 ? 'accessChanged'
        : status === 409 ? 'versionConflict' : status === 400 || status === 413 ? 'unsafe' : 'error' });
    }).finally(() => {
      if (current !== sequence.current) return;
      if (timeout.current !== null) clearTimeout(timeout.current);
      timeout.current = null;
      request.current = null;
    });
  }, [cancelRequest, courseId, publicationId, isCurrentSelection]);

  useEffect(() => {
    mounted.current = true;
    load();
    const clearOutOfScope = () => {
      if (isCurrentSelection()) return;
      cancelRequest();
      flushSync(() => { setState({ kind: 'outOfScope' }); setNeedsRefresh(false); setWindowReached(false); });
    };
    const pageHide = () => {
      cancelRequest();
      // Remove private metadata before this document can enter BFCache.
      flushSync(() => { setState({ kind: 'loading' }); setNeedsRefresh(false); setWindowReached(false); });
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (isCurrentSelection()) load(true); else clearOutOfScope();
    };
    const focus = () => {
      if (mounted.current && isCurrentSelection() && !request.current) setNeedsRefresh(true);
    };
    window.addEventListener('popstate', clearOutOfScope);
    window.addEventListener('forge-journey-course-change', clearOutOfScope);
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('pageshow', pageShow);
    window.addEventListener('focus', focus);
    return () => {
      mounted.current = false;
      cancelRequest();
      window.removeEventListener('popstate', clearOutOfScope);
      window.removeEventListener('forge-journey-course-change', clearOutOfScope);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      window.removeEventListener('focus', focus);
    };
  }, [cancelRequest, isCurrentSelection, load]);

  const metadata = state.kind === 'ready' ? state.metadata : null;
  const nextAt = metadata?.nextAvailableAt ?? null;
  useEffect(() => {
    if (!nextAt) return;
    const delay = new Date(nextAt).getTime() - Date.now();
    const timerSequence = sequence.current;
    const timer = setTimeout(() => {
      if (!mounted.current || timerSequence !== sequence.current || !isCurrentSelection()) return;
      if (Date.now() >= new Date(nextAt).getTime()) setWindowReached(true);
      else setNeedsRefresh(true);
    }, Math.max(0, Math.min(delay, MAX_TIMER_MS)));
    return () => clearTimeout(timer);
  }, [nextAt, isCurrentSelection]);

  if (state.kind === 'outOfScope') return null;
  const description = metadata ? describe(metadata) : null;
  const message = description?.message ?? (state.kind === 'loading' ? 'Übungsstand wird geprüft …'
    : state.kind === 'signIn' ? 'Bitte melde dich erneut an.'
      : state.kind === 'accessChanged' ? 'Der Zugang oder der Kurs hat sich geändert.'
        : state.kind === 'invalid' || state.kind === 'publicationChanged' ? 'Der Übungsstand konnte nicht sicher zugeordnet werden.'
          : state.kind === 'unsafe' || state.kind === 'versionConflict' ? 'Der Übungsstand konnte nicht sicher geladen werden.'
            : 'Der Übungsstand konnte nicht geladen werden.');
  const courseRefresh = state.kind === 'publicationChanged' || state.kind === 'versionConflict' || metadata?.status === 'unpublished';
  const reached = Boolean(nextAt && (windowReached || new Date(nextAt).getTime() <= Date.now()));
  const dateLabel = nextAt ? practiceReturnLabel(nextAt) : null;
  const guardNavigation = (event: { preventDefault: () => void }) => {
    if (!mounted.current || !isCurrentSelection() || request.current) event.preventDefault();
  };
  const act = (callback: () => void) => {
    if (mounted.current && isCurrentSelection() && !request.current) callback();
  };

  return <section aria-labelledby="journey-practice-title" aria-busy={state.kind === 'loading'} className="fc-section-card min-w-0">
    <h2 id="journey-practice-title" className="break-words text-lg font-semibold leading-snug">Privat wiederholen</h2>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Freiwillig und privat. Ohne Einfluss auf Kursabschluss, Prüfungen, Zertifikate oder Belohnungen.</p>
    <p className="mt-3 break-words text-sm leading-relaxed" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    {metadata && dateLabel && nextAt && <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
      {reached ? metadata.status === 'active' ? 'Prüfe den aktuellen Stand, nachdem du diese Sitzung abgeschlossen hast.'
        : 'Der angezeigte Zeitpunkt ist erreicht. Bitte prüfe den Stand erneut.'
        : <>{metadata.status === 'active' ? 'Für eine neue Sitzung voraussichtlich ab ' : 'Voraussichtlich wieder ab '}<time dateTime={nextAt}>{dateLabel}</time> (deine Ortszeit).</>}
    </p>}
    {metadata?.status === 'complete' && nextAt === null && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Gerade ist kein nächster Übungszeitpunkt verfügbar.</p>}
    {needsRefresh && state.kind !== 'loading' && !reached && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Bitte prüfe den Stand erneut, um aktuelle Angaben zu sehen.</p>}
    <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
      {description?.link && <Button asChild variant="outline" className={actionClass}><Link prefetch={false} href={`/courses/${encodeURIComponent(courseId)}/practice/learn`} onClick={guardNavigation} onAuxClick={guardNavigation} onNavigate={guardNavigation}>{description.link}</Link></Button>}
      {state.kind === 'signIn' ? <Button asChild variant="outline" className={actionClass}><Link prefetch={false} href={signInHref} onClick={guardNavigation} onAuxClick={guardNavigation} onNavigate={guardNavigation}>Zur Anmeldung</Link></Button>
        : state.kind === 'accessChanged' ? <Button type="button" variant="outline" className={actionClass} onClick={() => act(onRefreshCourses)}>Kursliste aktualisieren</Button>
          : courseRefresh ? <Button type="button" variant="outline" className={actionClass} onClick={() => act(onRefreshCourse)}>Kursstand erneut prüfen</Button>
            : <Button type="button" variant="ghost" className={actionClass} aria-disabled={state.kind === 'loading'} onClick={() => act(() => load())}>{state.kind === 'error' || state.kind === 'unsafe' || state.kind === 'invalid' ? 'Erneut versuchen' : 'Stand aktualisieren'}</Button>}
    </div>
  </section>;
}
