'use client';

/* Hallmark · quiet learner workbench · design-system: design.md */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { LoadingScreen, PageState } from '@/components/page-state';
import { JourneyMark } from './JourneyMark';
import { JourneyMascot } from './JourneyMascot';
import { eligibleJourneyCourses, projectJourney, type JourneyContent, type JourneyCourse, type JourneyLeaf } from './journey-progress';

type Progress = { completedContentIds: string[]; complete: boolean; canTrack: boolean; publicationId: string | null };
type Detail = { kind: 'idle' | 'loading' | 'error' } | { kind: 'ready'; courseId: string; contents: JourneyContent[]; progress: Progress };

const motionPreferenceKey = 'forge-journey-motion-off';
const mascotPreferenceKey = 'forge-journey-mascot-hidden';
let fallbackMotionEnabled = true;
let fallbackMascotVisible = true;

function subscribeMotion(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('forge-journey-motion-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('forge-journey-motion-change', callback);
  };
}

function motionSnapshot() {
  try { return window.localStorage.getItem(motionPreferenceKey) !== 'true'; }
  catch { return fallbackMotionEnabled; }
}

function subscribeMascot(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('forge-journey-mascot-visibility-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('forge-journey-mascot-visibility-change', callback);
  };
}

function mascotSnapshot() {
  try { return window.localStorage.getItem(mascotPreferenceKey) !== 'true'; }
  catch { return fallbackMascotVisible; }
}

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function reducedMotionSnapshot() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function contentLabel(type: JourneyLeaf['type']) {
  return ({ TEXT: 'Inhalt', VIDEO: 'Video', AUDIO: 'Audio', H5P: 'Übung', QUIZ: 'Quiz', ASSIGNMENT: 'Aufgabe' })[type];
}

function lockLabel(leaf: JourneyLeaf) {
  if (leaf.releaseLocked) return 'Noch nicht freigegeben';
  if (leaf.missingPrerequisites?.length) return 'Erst Voraussetzungen abschließen';
  return 'Noch gesperrt';
}

export default function JourneyClient() {
  const { data: session, status } = useSession();
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'authenticated' || !session?.user?.id) return <main className="mx-auto max-w-xl px-4 py-16">
    <h1 className="text-2xl font-semibold">Mein Lernweg</h1>
    <p className="mt-3 text-sm text-muted-foreground">Melde dich an, um deinen Lernweg zu sehen.</p>
    <Button asChild className="mt-5"><Link href="/login?callbackUrl=%2Fcourses%2Fjourney">Zur Anmeldung</Link></Button>
  </main>;
  if (session.user.role !== 'USER') return <AppShell><Sidebar /><div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <AppHeader><div className="flex items-center justify-between gap-3"><h1>Mein Lernweg</h1><div className="flex shrink-0 items-center gap-1 sm:gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
    <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6"><div className="mx-auto max-w-3xl"><PageState title="Lernweg für Lernende" description="Hier siehst du angemeldete Kurse anderer Lehrkräfte mit bestätigten nächsten Schritten." action={<Button asChild variant="outline"><Link href="/courses">Zur Kursübersicht</Link></Button>} /></div></main>
  </div></AppShell>;
  // A role refresh must unmount private learner state before the next account
  // or staff role can render any previous journey response.
  return <ScopedJourney key={JSON.stringify([session.user.id, session.user.role])} />;
}

function ScopedJourney() {
  const [courses, setCourses] = useState<JourneyCourse[] | null>(null);
  const [courseError, setCourseError] = useState(false);
  const [courseRetry, setCourseRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>({ kind: 'idle' });
  const [detailRetry, setDetailRetry] = useState(0);
  const mascotVisible = useSyncExternalStore(subscribeMascot, mascotSnapshot, () => false);
  const motionEnabled = useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true);
  const [celebration, setCelebration] = useState<{ id: number; courseId: string; publicationId: string } | null>(null);
  const completionBefore = useRef(new Map<string, boolean>());
  const celebrationSequence = useRef(0);
  const detailSequence = useRef(0);

  useEffect(() => {
    // A preference change consumes the current celebration, including changes
    // from another tab or the operating system. Re-enabling motion never
    // replays an earlier completion.
    const cancel = () => setCelebration(null);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    window.addEventListener('storage', cancel);
    window.addEventListener('forge-journey-motion-change', cancel);
    window.addEventListener('forge-journey-mascot-visibility-change', cancel);
    media.addEventListener('change', cancel);
    return () => {
      window.removeEventListener('storage', cancel);
      window.removeEventListener('forge-journey-motion-change', cancel);
      window.removeEventListener('forge-journey-mascot-visibility-change', cancel);
      media.removeEventListener('change', cancel);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/courses', { cache: 'no-store', signal: controller.signal })
      .then(response => readResponse<JourneyCourse[]>(response))
      .then(rows => {
        if (controller.signal.aborted) return;
        const enrolled = eligibleJourneyCourses('USER', rows);
        detailSequence.current++;
        setCourses(enrolled);
        setCourseError(false);
        setDetail({ kind: enrolled.length ? 'loading' : 'idle' });
        setSelectedId(current => current && enrolled.some(row => row.id === current) ? current : enrolled[0]?.id ?? null);
        setDetailRetry(value => value + 1);
      })
      .catch(() => { if (!controller.signal.aborted) setCourseError(true); });
    return () => controller.abort();
  }, [courseRetry]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const sequence = ++detailSequence.current;
    const courseId = encodeURIComponent(selectedId);
    void Promise.all([
      fetch(`/api/courses/${courseId}/contents`, { cache: 'no-store', signal: controller.signal })
        .then(response => readResponse<JourneyContent[]>(response)),
      fetch(`/api/courses/${courseId}/progress`, { cache: 'no-store', signal: controller.signal })
        .then(response => readResponse<Progress>(response)),
    ]).then(([contents, progress]) => {
      if (controller.signal.aborted || sequence !== detailSequence.current) return;
      if (!progress.canTrack) throw new Error('Enrollment changed');
      if (!progress.publicationId || contents.some(content => content.publicationId !== progress.publicationId)) throw new Error('Publication changed');
      const completionKey = JSON.stringify([selectedId, progress.publicationId]);
      const before = completionBefore.current.get(completionKey);
      completionBefore.current.set(completionKey, progress.complete);
      setDetail({ kind: 'ready', courseId: selectedId, contents, progress });
      // Read the current preferences when the response settles, rather than
      // capturing the values from before a slow request. An initially complete
      // course (or a new publication) is never a new completion event.
      if (before === false && progress.complete && mascotSnapshot() && motionSnapshot() && !reducedMotionSnapshot()) {
        setCelebration({ id: ++celebrationSequence.current, courseId: selectedId, publicationId: progress.publicationId });
      }
    }).catch(() => { if (!controller.signal.aborted && sequence === detailSequence.current) setDetail({ kind: 'error' }); });
    return () => controller.abort();
  }, [selectedId, detailRetry]);

  const selectCourse = useCallback((id: string) => {
    detailSequence.current++;
    setCelebration(null);
    setDetail({ kind: 'loading' });
    setSelectedId(id);
  }, []);

  const toggleMotion = () => {
    const next = !motionEnabled;
    fallbackMotionEnabled = next;
    try { window.localStorage.setItem(motionPreferenceKey, String(!next)); } catch { /* Memory preference still works. */ }
    window.dispatchEvent(new Event('forge-journey-motion-change'));
  };

  const toggleMascot = () => {
    const next = !mascotVisible;
    fallbackMascotVisible = next;
    try { window.localStorage.setItem(mascotPreferenceKey, String(!next)); } catch { /* Memory preference still works. */ }
    window.dispatchEvent(new Event('forge-journey-mascot-visibility-change'));
  };

  const retryCourses = () => { detailSequence.current++; setCelebration(null); setCourses(null); setCourseError(false); setDetail({ kind: 'idle' }); setCourseRetry(value => value + 1); };
  const retryDetail = () => { detailSequence.current++; setCelebration(null); setDetail({ kind: 'loading' }); setDetailRetry(value => value + 1); };

  const selectedCourse = courses?.find(course => course.id === selectedId);
  const projection = detail.kind === 'ready' && detail.courseId === selectedId ? projectJourney(detail.contents, detail.progress.completedContentIds) : null;
  const next = projection?.next;
  const complete = detail.kind === 'ready' && detail.progress.complete;
  const readerHref = selectedId ? `/courses/${encodeURIComponent(selectedId)}/contents` : '/courses';

  return <AppShell>
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="flex items-center justify-between gap-3"><h1>Mein Lernweg</h1><div className="flex shrink-0 items-center gap-1 sm:gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10 lg:px-8">
          <nav aria-label="Brotkrumen" className="text-sm text-muted-foreground"><Link href="/courses" className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Kurse</Link><span className="mx-2" aria-hidden="true">/</span><span aria-current="page" className="text-foreground">Mein Lernweg</span></nav>
          <div className="mt-6 flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">In deinem Tempo</p><h2 className="text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold leading-tight tracking-tight">Ein Schritt nach dem anderen.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">Dein bestätigter Kursfortschritt und ein freier nächster Schritt.</p></div>
            <div className="shrink-0"><div className="flex flex-wrap gap-2 sm:justify-end"><Button type="button" variant="outline" size="sm" aria-label="Maskottchen anzeigen" aria-pressed={mascotVisible} onClick={toggleMascot}>Figur {mascotVisible ? 'an' : 'aus'}</Button>{mascotVisible && <Button type="button" variant="outline" size="sm" aria-pressed={motionEnabled && !reducedMotion} onClick={toggleMotion} disabled={reducedMotion}>{reducedMotion ? 'Figurenanimationen aus' : `Figurenanimationen ${motionEnabled ? 'an' : 'aus'}`}</Button>}</div>{mascotVisible && reducedMotion && <p className="mt-1 text-xs text-muted-foreground">Weniger Bewegung ist am Gerät eingestellt.</p>}</div>
          </div>

          {courses === null && !courseError && <div className="mt-8"><PageState kind="loading" title="Deine Kurse werden geladen" /></div>}
          {courseError && <div className="mt-8"><PageState kind="error" title="Deine Kurse konnten nicht geladen werden" action={<Button type="button" variant="outline" onClick={retryCourses}>Erneut versuchen</Button>} /></div>}
          {courses?.length === 0 && <div className="mt-8"><PageState title="Dein Lernweg beginnt mit einem Kurs" description="Hier erscheinen deine angemeldeten Kurse anderer Lehrkräfte." action={<Button asChild><Link href="/courses">Kurse entdecken</Link></Button>} /></div>}
          {courses && courses.length > 0 && <div className="mt-8 space-y-8">
            <section aria-labelledby="journey-course-title" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,24rem)] sm:items-end">
              <div><h2 id="journey-course-title" className="text-xl font-semibold">Deine Kurse</h2><p className="mt-1 text-sm text-muted-foreground">{courses.length} {courses.length === 1 ? 'Kurs' : 'Kurse'} mit Anmeldung</p></div>
              <div><label htmlFor="journey-course" className="mb-1.5 block text-sm font-medium">Kurs auswählen</label><select id="journey-course" value={selectedId ?? ''} onChange={event => selectCourse(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></div>
            </section>

            {detail.kind === 'loading' && <PageState kind="loading" title="Lernschritte werden geprüft" />}
            {detail.kind === 'error' && <PageState kind="error" title="Der Kursstand konnte nicht geladen werden" description="Vielleicht hat sich deine Anmeldung oder der Kurs geändert." action={<div className="flex flex-wrap justify-center gap-2"><Button type="button" variant="outline" onClick={retryDetail}>Erneut versuchen</Button><Button type="button" variant="ghost" onClick={retryCourses}>Kursliste aktualisieren</Button></div>} />}
            {detail.kind === 'ready' && selectedCourse && projection && <>
              <section aria-labelledby="journey-progress-title" className="rounded-2xl border bg-card p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Dein Kurs</p><h2 id="journey-progress-title" className="mt-2 break-words text-xl font-semibold tracking-tight sm:text-2xl">{selectedCourse.title}</h2><p className="mt-3 text-sm font-medium" role="status" aria-live="polite">{complete ? 'Alle aktuellen Kursinhalte bestätigt' : projection.leaves.length ? `${projection.completedCount} von ${projection.leaves.length} Inhalten aktuell bestätigt` : 'Noch keine Kursinhalte verfügbar'}</p></div>
                  {mascotVisible && <JourneyMascot complete={complete} celebrationId={motionEnabled && !reducedMotion && celebration?.courseId === selectedId && celebration.publicationId === detail.progress.publicationId ? celebration.id : null} ambientMotion={motionEnabled && !reducedMotion} />}
                </div>
                {projection.leaves.length > 0 && <progress className="mt-5 h-3 w-full accent-primary" value={projection.completedCount} max={projection.leaves.length} aria-label={`${projection.completedCount} von ${projection.leaves.length} Kursinhalten aktuell bestätigt`}>{projection.completedCount} von {projection.leaves.length}</progress>}
                <div className="mt-5 border-t pt-5">
                  {next && !complete ? <><div className="flex items-start gap-3"><JourneyMark className="mt-0.5 size-9 shrink-0 text-primary" /><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Als Nächstes möglich</p><h3 className="mt-1 break-words text-lg font-semibold">{next.title}</h3><p className="mt-1 text-sm text-muted-foreground">{contentLabel(next.type)}</p></div></div><Button asChild className="mt-5"><Link href={`${readerHref}?content=${encodeURIComponent(next.id)}`}>Lernschritt öffnen</Link></Button></>
                    : complete ? <><p className="text-sm">Dein Kursabschluss ist aktuell bestätigt.</p><Button asChild variant="outline" className="mt-4"><Link href={readerHref}>Kurs ansehen</Link></Button></>
                      : projection.firstLocked ? <><p className="text-sm font-medium">Gerade ist kein weiterer Inhalt frei.</p><p className="mt-1 text-sm text-muted-foreground">{lockLabel(projection.firstLocked)}. Den aktuellen Stand siehst du im Kurs.</p><Button asChild variant="outline" className="mt-4"><Link href={readerHref}>Kurs ansehen</Link></Button></>
                        : <><p className="text-sm text-muted-foreground">Im Kurs findest du den aktuellen Stand.</p><Button asChild variant="outline" className="mt-4"><Link href={readerHref}>Kurs ansehen</Link></Button></>}
                </div>
              </section>

              {projection.leaves.length > 0 && <section aria-labelledby="journey-outline-title"><div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3"><h2 id="journey-outline-title" className="text-lg font-semibold">Nächste Stationen</h2><Button type="button" variant="ghost" size="sm" onClick={retryDetail}>Stand aktualisieren</Button></div><ol className="divide-y">{projection.leaves.filter(leaf => !leaf.completed).slice(0, 5).map((leaf, index) => <li key={leaf.id} className="flex min-w-0 items-start gap-4 py-3 text-sm"><span className="flex size-7 shrink-0 items-center justify-center rounded-full border font-medium tabular-nums" aria-hidden="true">{index + 1}</span><span className="min-w-0 flex-1"><span className="block break-words font-medium">{leaf.title}</span><span className="mt-0.5 block text-muted-foreground">{contentLabel(leaf.type)} · {leaf.locked ? lockLabel(leaf) : 'Jetzt möglich'}</span></span></li>)}</ol>{projection.leaves.every(leaf => leaf.completed) && <p className="py-4 text-sm text-muted-foreground">Alle aktuellen Inhalte bestätigt.</p>}<Link href={readerHref} className="mt-3 inline-flex rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Vollständiges Inhaltsverzeichnis im Kurs</Link></section>}
            </>}
          </div>}
        </div>
      </main>
    </div>
  </AppShell>;
}
