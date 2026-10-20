'use client';

/* Hallmark · quiet learner workbench · design-system: design.md */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { UserNav, useSignInHref } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { LoadingScreen, PageState } from '@/components/page-state';
import { JourneyMascot } from './JourneyMascot';
import { SparkEntryFigure } from '@/components/spark-entry';
import { journeyMotionSnapshot as motionSnapshot, setJourneyMotionEnabled, sparkMotionSnapshot, useJourneyMotion } from '@/hooks/useSparkMotion';
import { sparkVisibilitySnapshot as mascotSnapshot, useSparkVisibility } from '@/hooks/useSparkVisibility';
import { eligibleJourneyCourses, projectJourney, type JourneyContent, type JourneyCourse } from './journey-progress';
import { JourneyWorld } from './JourneyWorld';
import { JourneyPracticeReturnCard } from './JourneyPracticeReturnCard';
import { groupJourneyTrail, readJourneyCourses, readJourneyDetail, type JourneyProgress } from './journey-trail-data';
import { journeyCourseHref, resolveJourneyCourseId } from './journey-course-url';

type Detail = { kind: 'idle' } | { kind: 'loading' | 'error'; courseId: string } | { kind: 'ready'; courseId: string; contents: JourneyContent[]; progress: JourneyProgress };

function subscribeCourseSelection(callback: () => void) {
  window.addEventListener('popstate', callback);
  window.addEventListener('forge-journey-course-change', callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener('forge-journey-course-change', callback);
  };
}

function courseSelectionSnapshot() {
  return window.location.search;
}

// Document-local token for a genuinely new completion, never historical state.
let nextCelebrationId = 0;

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function reducedMotionSnapshot() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

export default function JourneyClient() {
  const { data: session, status } = useSession();
  const signInHref = useSignInHref();
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'authenticated' || !session?.user?.id) return <main className="mx-auto max-w-xl px-4 py-16">
    <h1 className="text-2xl font-semibold">Mein Lernweg</h1>
    <p className="mt-3 text-sm text-muted-foreground">Melde dich an, um deinen Lernweg zu sehen.</p>
    <Button asChild className="mt-5"><Link prefetch={false} href={signInHref}>Zur Anmeldung</Link></Button>
  </main>;
  if (session.user.role !== 'USER') return <AppShell data-page-family="learning"><Sidebar /><div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <AppHeader><div className="app-header-row"><h1 className="app-header-title">Mein Lernweg</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
    <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6"><div className="mx-auto max-w-3xl"><PageState title="Lernweg für Lernende" description="Hier siehst du angemeldete Kurse anderer Lehrkräfte mit bestätigten nächsten Schritten." action={<Button asChild variant="outline"><Link href="/courses">Zur Kursübersicht</Link></Button>} /></div></main>
  </div></AppShell>;
  // A role refresh must unmount private learner state before the next account
  // or staff role can render any previous journey response.
  return <ScopedJourney key={JSON.stringify([session.user.id, session.user.role])} signInHref={signInHref} />;
}

function ScopedJourney({ signInHref }: { signInHref: string }) {
  const [courses, setCourses] = useState<JourneyCourse[] | null>(null);
  const [courseError, setCourseError] = useState(false);
  const [courseRetry, setCourseRetry] = useState(0);
  const courseSearch = useSyncExternalStore(subscribeCourseSelection, courseSelectionSnapshot, () => '');
  const selectedId = resolveJourneyCourseId(courseSearch, courses ?? []);
  const [detail, setDetail] = useState<Detail>({ kind: 'idle' });
  const [detailRetry, setDetailRetry] = useState(0);
  const { visible: mascotVisible } = useSparkVisibility();
  const motionEnabled = useJourneyMotion();
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true);
  const [celebration, setCelebration] = useState<{ id: number; courseId: string; publicationId: string } | null>(null);
  const completionBefore = useRef(new Map<string, boolean>());
  const detailSequence = useRef(0);
  const preferenceEpoch = useRef(0);
  const [chapterChoices, setChapterChoices] = useState(new Map<string, boolean>());

  useEffect(() => {
    // A preference change consumes the current celebration, including changes
    // from another tab or the operating system. Re-enabling motion never
    // replays an earlier completion.
    const cancel = () => {
      preferenceEpoch.current++;
      setCelebration(null);
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    window.addEventListener('storage', cancel);
    window.addEventListener('forge-journey-motion-change', cancel);
    window.addEventListener('forge-community-motion-change', cancel);
    window.addEventListener('forge-journey-mascot-visibility-change', cancel);
    media.addEventListener('change', cancel);
    return () => {
      window.removeEventListener('storage', cancel);
      window.removeEventListener('forge-journey-motion-change', cancel);
      window.removeEventListener('forge-community-motion-change', cancel);
      window.removeEventListener('forge-journey-mascot-visibility-change', cancel);
      media.removeEventListener('change', cancel);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/courses', { cache: 'no-store', signal: controller.signal })
      .then(readResponse)
      .then(readJourneyCourses)
      .then(rows => {
        if (controller.signal.aborted) return;
        const enrolled = eligibleJourneyCourses('USER', rows);
        detailSequence.current++;
        setCourses(enrolled);
        setCourseError(false);
        setDetail({ kind: 'idle' });
        setDetailRetry(value => value + 1);
      })
      .catch(() => { if (!controller.signal.aborted) setCourseError(true); });
    return () => controller.abort();
  }, [courseRetry]);

  useEffect(() => {
    if (!courses || !selectedId || courseSearch !== window.location.search || window.location.pathname !== '/courses/journey') return;
    // Wait for the eligible list before normalizing an absent/unknown choice.
    // Replace the entry so the default course also survives a reader return,
    // even if completion later changes the list's first-course ordering.
    const href = journeyCourseHref(selectedId, window.location.hash);
    if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    window.history.replaceState(window.history.state, '', href);
    window.dispatchEvent(new Event('forge-journey-course-change'));
  }, [courses, selectedId, courseSearch]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const sequence = ++detailSequence.current;
    const requestedPreferenceEpoch = preferenceEpoch.current;
    const courseId = encodeURIComponent(selectedId);
    setCelebration(null);
    setDetail({ kind: 'loading', courseId: selectedId });
    // History can change before React runs this effect's cleanup. Do not
    // record old-course progress or a celebration for a newer URL selection.
    const stillSelected = () => window.location.pathname === '/courses/journey' &&
      resolveJourneyCourseId(window.location.search, courses ?? []) === selectedId;
    void Promise.all([
      fetch(`/api/courses/${courseId}/contents`, { cache: 'no-store', signal: controller.signal })
        .then(readResponse),
      fetch(`/api/courses/${courseId}/progress`, { cache: 'no-store', signal: controller.signal })
        .then(readResponse),
    ]).then(([contentsValue, progressValue]) => {
      if (controller.signal.aborted || sequence !== detailSequence.current || !stillSelected()) return;
      const { contents, progress } = readJourneyDetail(contentsValue, progressValue, selectedId);
      const completionKey = JSON.stringify([selectedId, progress.publicationId]);
      const before = completionBefore.current.get(completionKey);
      completionBefore.current.set(completionKey, progress.complete);
      setDetail({ kind: 'ready', courseId: selectedId, contents, progress });
      // Read the current preferences when the response settles, rather than
      // capturing the values from before a slow request. An initially complete
      // course (or a new publication) is never a new completion event.
      if (before === false && progress.complete && requestedPreferenceEpoch === preferenceEpoch.current && mascotSnapshot() && sparkMotionSnapshot() && !reducedMotionSnapshot()) {
        setCelebration({ id: ++nextCelebrationId, courseId: selectedId, publicationId: progress.publicationId });
      }
    }).catch(() => { if (!controller.signal.aborted && sequence === detailSequence.current && stillSelected()) setDetail({ kind: 'error', courseId: selectedId }); });
    return () => controller.abort();
  }, [selectedId, detailRetry, courses]);

  const selectCourse = useCallback((id: string) => {
    if (!courses?.some(course => course.id === id) || resolveJourneyCourseId(window.location.search, courses) === id) return;
    detailSequence.current++;
    setCelebration(null);
    setDetail({ kind: 'loading', courseId: id });
    setDetailRetry(value => value + 1);
    window.history.pushState(window.history.state, '', journeyCourseHref(id, window.location.hash));
    window.dispatchEvent(new Event('forge-journey-course-change'));
  }, [courses]);

  const toggleMotion = () => setJourneyMotionEnabled(!motionSnapshot());

  const retryCourses = () => { detailSequence.current++; setCelebration(null); setCourses(null); setCourseError(false); setDetail({ kind: 'idle' }); setCourseRetry(value => value + 1); };
  const retryDetail = () => { if (!selectedId) return; detailSequence.current++; setCelebration(null); setDetail({ kind: 'loading', courseId: selectedId }); setDetailRetry(value => value + 1); };

  const isCurrentSelection = useCallback(() => window.location.pathname === '/courses/journey' &&
    resolveJourneyCourseId(window.location.search, courses ?? []) === selectedId, [courses, selectedId]);
  const refreshPracticeCourse = () => { document.getElementById('journey-course-selection')?.focus(); retryDetail(); };
  const refreshPracticeCourses = () => { document.getElementById('page-content')?.focus(); retryCourses(); };

  const selectedCourse = courses?.find(course => course.id === selectedId);
  const currentDetail = detail.kind !== 'idle' && detail.courseId === selectedId ? detail : null;
  const detailPending = Boolean(selectedId && (!currentDetail || currentDetail.kind === 'loading'));
  const projection = currentDetail?.kind === 'ready' ? projectJourney(currentDetail.contents, currentDetail.progress.completedContentIds, currentDetail.progress.awaitingGradeContentIds) : null;
  const complete = Boolean(projection && currentDetail?.kind === 'ready' && currentDetail.progress.complete);
  const groups = projection && currentDetail?.kind === 'ready' ? groupJourneyTrail(currentDetail.contents, projection) : [];
  const chapterScope = currentDetail?.kind === 'ready' ? JSON.stringify([currentDetail.courseId, currentDetail.progress.publicationId]) : '';
  const openChapters: Record<string, boolean> = Object.create(null);
  for (const group of groups) {
    const key = JSON.stringify([chapterScope, group.id]);
    if (chapterChoices.has(key)) openChapters[group.id] = chapterChoices.get(key)!;
  }
  const toggleChapter = (id: string, open: boolean) => {
    const key = JSON.stringify([chapterScope, id]);
    setChapterChoices(current => {
      if (current.get(key) === open) return current;
      const next = new Map(current);
      next.set(key, open);
      return next;
    });
  };
  const readerHref = selectedId ? `/courses/${encodeURIComponent(selectedId)}/contents` : '/courses';

  return <AppShell data-page-family="learning">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row"><h1 className="app-header-title">Mein Lernweg</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-4 sm:px-6 sm:pt-6">
          <nav aria-label="Brotkrumen" className="text-sm text-muted-foreground"><Link href="/courses" className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Kurse</Link><span className="mx-2" aria-hidden="true">/</span><span aria-current="page" className="text-foreground">Mein Lernweg</span></nav>

          {courses === null && !courseError && <div className="mt-4"><PageState kind="loading" title="Deine Kurse werden geladen" /></div>}
          {courseError && <div className="mt-4"><PageState kind="error" title="Deine Kurse konnten nicht geladen werden" action={<Button type="button" variant="outline" onClick={retryCourses}>Erneut versuchen</Button>} /></div>}
          {courses?.length === 0 && <section className="mt-4 rounded-2xl border border-dashed bg-card px-6 py-6 text-center" role="status" aria-live="polite">
            {mascotVisible && <div className="mx-auto mb-3 w-fit"><SparkEntryFigure /></div>}
            <h2 className="text-base font-semibold">Wähle deinen ersten Kurs</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Hier erscheinen deine angemeldeten Kurse anderer Lehrkräfte.</p>
            <div className="mt-5 flex justify-center"><Button asChild className="h-auto min-h-11 max-w-full whitespace-normal py-2"><Link href="/courses">Kurse entdecken</Link></Button></div>
          </section>}
          {courses && courses.length > 0 && <div className="mt-3 space-y-4">
            <section id="journey-course-selection" tabIndex={-1} aria-label="Deine angemeldeten Kurse" className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b pb-3">
              {courses.length > 1 ? <div className="min-w-0 flex-1 basis-64">
                <label htmlFor="journey-course" className="mb-1.5 block text-sm font-medium">Kurs auswählen <span className="font-normal text-muted-foreground">({courses.length})</span></label>
                <select id="journey-course" value={selectedId ?? ''} onChange={event => selectCourse(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
              </div> : <p className="text-sm font-medium">Dein angemeldeter Kurs</p>}
              <Button type="button" variant="ghost" className="min-h-11 max-w-full aria-disabled:cursor-wait aria-disabled:text-muted-foreground"
                aria-disabled={detailPending} onClick={() => { if (!detailPending) retryDetail(); }}>Stand aktualisieren</Button>
            </section>

            {detailPending && <PageState kind="loading" title="Lernschritte werden geprüft" />}
            {currentDetail?.kind === 'error' && <PageState kind="error" title="Der Kursstand konnte nicht geladen werden" description="Vielleicht hat sich deine Anmeldung oder der Kurs geändert." action={<div className="flex flex-wrap justify-center gap-2"><Button type="button" variant="outline" onClick={retryDetail}>Erneut versuchen</Button><Button type="button" variant="ghost" onClick={retryCourses}>Kursliste aktualisieren</Button></div>} />}
            {currentDetail?.kind === 'ready' && selectedCourse && projection && <JourneyWorld
              key={chapterScope} courseTitle={selectedCourse.title} projection={projection} groups={groups}
              complete={complete} readerHref={readerHref} motionEnabled={motionEnabled && !reducedMotion} openChapters={openChapters} onChapterToggle={toggleChapter}
              mascot={mascotVisible ? <JourneyMascot complete={complete} celebrationId={motionEnabled && !reducedMotion && celebration?.courseId === selectedId && celebration.publicationId === currentDetail.progress.publicationId ? celebration.id : null} ambientMotion={motionEnabled && !reducedMotion} /> : null} />}
            {currentDetail?.kind === 'ready' && selectedCourse && projection && <JourneyPracticeReturnCard
              key={JSON.stringify([selectedCourse.id, currentDetail.progress.publicationId])}
              courseId={selectedCourse.id} publicationId={currentDetail.progress.publicationId} signInHref={signInHref}
              isCurrentSelection={isCurrentSelection} onRefreshCourse={refreshPracticeCourse} onRefreshCourses={refreshPracticeCourses} />}
          </div>}

          {mascotVisible && <div className="mt-3 border-b pb-4">
            <Button type="button" variant="ghost" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal py-2 [overflow-wrap:anywhere] sm:h-auto" aria-pressed={motionEnabled && !reducedMotion} onClick={toggleMotion} disabled={reducedMotion}>{reducedMotion ? 'Figurenanimationen aus' : `Figurenanimationen ${motionEnabled ? 'an' : 'aus'}`}</Button>
            {reducedMotion && <p className="mt-1 text-xs text-muted-foreground">Weniger Bewegung ist am Gerät eingestellt.</p>}
          </div>}

          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">Gemeinsam mit anderen lernen: <Link prefetch={false} href="/community/missions" className="inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Space-Missionen entdecken</Link><br /><Link prefetch={false} href="/community/missions?view=saved" className="inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Gemerkte Space-Missionen</Link></p>
        </div>
      </main>
    </div>
  </AppShell>;
}
