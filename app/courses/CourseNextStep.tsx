'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProgressSpark } from '@/components/community/ProgressSpark';
import { eligibleJourneyCourses, projectJourney, type JourneyContent, type JourneyCourse, type JourneyLeaf } from './journey/journey-progress';
import { groupJourneyTrail, readJourneyCourses, readJourneyDetail, type JourneyProgress } from './journey/journey-trail-data';
import { journeyCourseHref } from './journey/journey-course-url';

const textLink = 'inline-flex min-h-11 items-center rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
type Detail = { kind: 'loading'; scope: string; courseId: string }
  | { kind: 'error'; scope: string; courseId: string; reason: 'unavailable' | 'unverified' }
  | { kind: 'ready'; scope: string; courseId: string; contents: JourneyContent[]; progress: JourneyProgress };

/** Use the existing catalog read. This panel never scans courses, goals or missions. */
export function CourseNextStep({ actorKey, courses, isLoading, loadError }: {
  actorKey: string; courses: unknown; isLoading: boolean; loadError: boolean;
}) {
  const list = useMemo(() => {
    if (isLoading) return { kind: 'loading' } as const;
    if (loadError) return { kind: 'error' } as const;
    try {
      const checked = readJourneyCourses(courses);
      const enrolled = eligibleJourneyCourses('USER', checked).sort((a, b) =>
        Number(a.completed) - Number(b.completed) || a.title.localeCompare(b.title, 'de') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { kind: 'ready', checked, enrolled, selected: enrolled.find(course => !course.completed) } as const;
    } catch { return { kind: 'error' } as const; }
  }, [courses, isLoading, loadError]);

  if (list.kind === 'loading') return <NextStepFrame busy><p role="status" className="mt-3 text-sm text-muted-foreground">Deine Kurse werden geladen.</p></NextStepFrame>;
  if (list.kind === 'error') return <NextStepFrame><p role="status" className="mt-3 text-sm text-muted-foreground">Dein nächster Schritt ist gerade unbekannt. Die Kursliste konnte nicht verlässlich geladen werden. Versuche es in der Kursübersicht unten erneut.</p></NextStepFrame>;
  if (!list.selected) return <NextStepFrame>
    <h3 className="mt-3 text-lg font-semibold">{list.enrolled.length ? 'Kein offener Lernschritt ausgewählt' : 'Wähle deinen Lernkurs'}</h3>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{list.enrolled.length
      ? 'Die Kursliste zeigt aktuell keinen offenen Kurs. In deinem Lernweg kannst du den aktuellen Stand eines Kurses prüfen.'
      : 'Melde dich unten zu einem Kurs einer anderen Lehrkraft an. Hier findest du dann einen bestätigten nächsten Schritt.'}</p>
    <Link prefetch={false} href={list.enrolled[0] ? journeyCourseHref(list.enrolled[0].id) : '/courses/journey'} className={`${textLink} mt-3`}>Lernweg öffnen</Link>
  </NextStepFrame>;

  // Reset private detail synchronously on actor, role or any allowlisted list /
  // enrollment change. An old response cannot render before effect cleanup.
  const scope = JSON.stringify([actorKey, list.checked]);
  return <SelectedNextStep key={scope} scope={scope} course={list.selected} />;
}

function NextStepFrame({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  const headingId = useId();
  return <section aria-labelledby={headingId} aria-busy={busy} className="mb-6 min-w-0 [overflow-wrap:anywhere] rounded-2xl border border-primary/20 bg-card p-5 shadow-sm sm:p-6">
    <div className="flex min-w-0 items-center gap-2 text-primary"><Compass aria-hidden="true" className="size-5 shrink-0" /><h2 id={headingId} className="text-lg font-semibold tracking-tight">Dein nächster Schritt</h2></div>
    {children}
    <nav aria-label="Freiwillige nächste Schritte" className="mt-4 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 border-t pt-3">
      <span className="text-xs text-muted-foreground">Wenn du möchtest:</span>
      <Link prefetch={false} href="/courses/goals" className={textLink}>Eigenes Lernziel planen</Link>
      <Link prefetch={false} href="/community/missions" className={textLink}>Missionen entdecken</Link>
    </nav>
  </section>;
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error('Course detail unavailable');
  return response.json() as Promise<unknown>;
}

function contentLabel(type: JourneyLeaf['type']) {
  return ({ TEXT: 'Leseinhalt', VIDEO: 'Video', AUDIO: 'Audio', H5P: 'Interaktive Übung', QUIZ: 'Quiz', ASSIGNMENT: 'Aufgabe' })[type];
}

function SelectedNextStep({ scope, course }: { scope: string; course: JourneyCourse }) {
  const [detail, setDetail] = useState<Detail>({ kind: 'loading', scope, courseId: course.id });
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const reading = useRef(true);
  const progressId = useId();

  useEffect(() => {
    const controller = new AbortController();
    reading.current = true;
    const request = ++sequence.current;
    const courseId = encodeURIComponent(course.id);
    const current = () => !controller.signal.aborted && request === sequence.current;
    setDetail({ kind: 'loading', scope, courseId: course.id });
    // Exactly one selected course and two reads. Never try another course on failure.
    void Promise.all([
      fetch(`/api/courses/${courseId}/contents`, { cache: 'no-store', signal: controller.signal }).then(readResponse),
      fetch(`/api/courses/${courseId}/progress`, { cache: 'no-store', signal: controller.signal }).then(readResponse),
    ]).then(([contentsValue, progressValue]) => {
      if (!current()) return;
      try {
        const { contents, progress } = readJourneyDetail(contentsValue, progressValue, course.id);
        if (current()) { reading.current = false; setDetail({ kind: 'ready', scope, courseId: course.id, contents, progress }); }
      } catch {
        if (current()) { reading.current = false; setDetail({ kind: 'error', scope, courseId: course.id, reason: 'unverified' }); }
      }
    }).catch(() => {
      if (current()) { reading.current = false; setDetail({ kind: 'error', scope, courseId: course.id, reason: 'unavailable' }); }
      controller.abort();
    });
    return () => { sequence.current++; controller.abort(); };
  }, [scope, course.id, retry]);

  const currentDetail = detail.scope === scope && detail.courseId === course.id ? detail : null;
  const ready = currentDetail?.kind === 'ready' ? currentDetail : null;
  const projection = ready ? projectJourney(ready.contents, ready.progress.completedContentIds, ready.progress.awaitingGradeContentIds) : null;
  const next = projection?.next;
  const awaiting = projection?.leaves.find(leaf => leaf.awaitingGrade);
  const locked = projection?.firstLocked;
  const chapter = next && ready && projection ? groupJourneyTrail(ready.contents, projection)
    .find(group => group.isChapter && group.stations.some(station => station.leaf.id === next.id)) : null;
  const showChapter = chapter && (chapter.stations.length > 1 || chapter.title !== next?.title);
  const busy = !currentDetail || currentDetail.kind === 'loading';
  const retryDetail = () => {
    if (reading.current) return;
    reading.current = true;
    sequence.current++;
    setDetail({ kind: 'loading', scope, courseId: course.id });
    setRetry(value => value + 1);
  };

  return <NextStepFrame busy={busy}>
    <div className="mt-3 flex min-w-0 items-start gap-4 sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{course.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">Alphabetisch erster offener Lernkurs aus der geladenen Kursauswahl.</p>
        {busy && <p role="status" className="mt-4 text-sm text-muted-foreground">Dein aktueller Lernstand wird geprüft.</p>}
        {currentDetail?.kind === 'error' && <div className="mt-4">
          <p role="status" className="text-sm leading-relaxed text-muted-foreground">{currentDetail.reason === 'unverified'
            ? 'Dein nächster Schritt ist gerade unbekannt. Inhalte und Fortschritt konnten nicht für dieselbe Kursveröffentlichung bestätigt werden.'
            : 'Dein Lernstand konnte nicht geladen werden. Dein nächster Schritt ist gerade unbekannt.'}</p>
        </div>}
        {ready && projection && <>
          {next && <p role="status" className="sr-only">Nächster Schritt: {next.title}.</p>}
          {projection.leaves.length > 0 && <div className="mt-4 max-w-xl">
            <p id={progressId} className="text-sm text-muted-foreground">{projection.completedCount} von {projection.leaves.length} {projection.leaves.length === 1 ? 'Station' : 'Stationen'} abgeschlossen</p>
            <div role="progressbar" aria-labelledby={progressId} aria-valuemin={0} aria-valuemax={projection.leaves.length} aria-valuenow={projection.completedCount} className="mt-2 h-2 overflow-hidden rounded-full bg-primary/10">
              <div className="h-full rounded-full bg-primary" style={{ width: `${projection.completedCount / projection.leaves.length * 100}%` }} />
            </div>
          </div>}
          {next ? <div className="mt-4">
            <p className="text-xs font-medium text-primary">{contentLabel(next.type)}</p>
            {showChapter && <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">Etappe „{chapter.title}“: {chapter.completedCount} von {chapter.stations.length} {chapter.stations.length === 1 ? 'Station' : 'Stationen'} abgeschlossen</p>}
            <h3 className="mt-1 text-xl font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">{next.title}</h3>
            <Button asChild className="mt-4 min-h-11 max-w-full"><Link prefetch={false} href={`/courses/${encodeURIComponent(course.id)}/contents?content=${encodeURIComponent(next.id)}`}><BookOpen aria-hidden="true" className="size-4 shrink-0" />Hier weiterlernen<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Link></Button>
          </div> : <div role="status" className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {ready.progress.complete ? 'In diesem Kurs sind alle aktuellen Stationen abgeschlossen.'
              : !projection.leaves.length ? 'Dieser Kurs hat derzeit keine Lernstationen.'
              : awaiting ? `„${awaiting.title}“ wartet auf Bewertung. Für diesen Kurs ist gerade kein weiterer freigegebener Lernschritt verfügbar.`
              : locked?.releaseLocked ? 'Der nächste Lernschritt ist noch nicht freigegeben.'
              : locked?.missingPrerequisites?.length ? 'Der nächste Lernschritt ist gesperrt, bis die Voraussetzungen bestätigt sind.'
              : 'Für diesen Kurs ist gerade kein freigegebener Lernschritt verfügbar.'}
          </div>}
        </>}
        {!next && awaiting && ready && <Button asChild className="mt-4 min-h-11 max-w-full"><Link prefetch={false} href={`/courses/${encodeURIComponent(course.id)}/contents?content=${encodeURIComponent(awaiting.id)}`}>Abgabe ansehen<ArrowRight aria-hidden="true" className="size-4 shrink-0" /></Link></Button>}
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <Link prefetch={false} href={journeyCourseHref(course.id)} className={textLink}>Kurs im Lernweg ansehen oder wechseln</Link>
          <Button type="button" variant="ghost" className="min-h-11 max-w-full whitespace-normal text-left" aria-disabled={busy} onClick={retryDetail}>{busy ? 'Lernstand wird geprüft …' : currentDetail?.kind === 'error' ? 'Erneut prüfen' : 'Lernstand aktualisieren'}</Button>
        </div>
      </div>
      <div className="hidden shrink-0 sm:block"><ProgressSpark state={next ? 'target' : 'neutral'} /></div>
    </div>
  </NextStepFrame>;
}
