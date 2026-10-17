'use client';

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 */
/* Hallmark · genre: editorial · macrostructure: private course ledger · design-system: design.md · designed-as-app */

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/user-nav';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { PageState } from '@/components/page-state';
import { canSeeLearnerPathways } from '@/lib/pathway-visibility';
import { type MemberPathway, latestRelevantRevocation, pathwayReason, pathwayStatus } from './pathway-types';

function dateLabel(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
}

function PathwaysAccessDenied() {
  return <AppShell>
    <Sidebar hideLearnerPathways />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row"><h1 className="app-header-title">Lernpfade</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <PageState kind="error" title="Kein Zugriff auf Lernpfade"
            description="Private Lernpfade sind nur für reguläre Mitglieder verfügbar. Dieses Konto hat derzeit keinen Zugriff."
            action={<Button asChild variant="outline"><Link href="/courses">Kurse ansehen</Link></Button>} />
        </div>
      </main>
    </div>
  </AppShell>;
}

export default function PathwaysClient({ pathwayId }: { pathwayId?: string }) {
  const { data: session, status } = useSession();
  if (status === 'loading') return <PageState kind="loading" title="Lernpfade werden vorbereitet" />;
  if (status !== 'authenticated' || !session?.user?.id) return <main className="mx-auto max-w-xl px-4 py-16">
    <h1 className="text-2xl font-semibold">Lernpfade</h1>
    <p className="mt-3 text-sm text-muted-foreground">Melde dich an, um deine privaten Lernpfade zu sehen.</p>
    <Button asChild className="mt-5"><Link href="/login">Zur Anmeldung</Link></Button>
  </main>;
  if (!canSeeLearnerPathways(session.user.role)) return <PathwaysAccessDenied />;
  // Unmount account-specific state before another account can receive an older response.
  return <ScopedPathways key={session.user.id} pathwayId={pathwayId} />;
}

function ScopedPathways({ pathwayId }: { pathwayId?: string }) {
  const router = useRouter();
  const [pathways, setPathways] = useState<MemberPathway[] | null>(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [joiningCourseId, setJoiningCourseId] = useState<string | null>(null);
  const [courseError, setCourseError] = useState<{ courseId: string; message: string } | null>(null);
  const mounted = useRef(true);
  const requestSequence = useRef(0);
  const mutationInFlight = useRef(false);
  const courseJoinInFlight = useRef(false);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const joinRef = useRef<HTMLButtonElement>(null);

  async function load(signal?: AbortSignal) {
    const sequence = ++requestSequence.current;
    try {
      const response = await fetch('/api/learning-pathways/me', { cache: 'no-store', signal });
      if (response.status === 403) {
        if (mounted.current && !signal?.aborted && sequence === requestSequence.current) {
          setPathways(null);
          setError('');
          setForbidden(true);
        }
        return;
      }
      if (!response.ok) throw new Error('load');
      const result = await response.json() as { pathways: MemberPathway[] };
      if (mounted.current && !signal?.aborted && sequence === requestSequence.current) {
        setError('');
        setPathways(result.pathways);
      }
    } catch {
      if (mounted.current && !signal?.aborted && sequence === requestSequence.current) setError('Deine Lernpfade konnten nicht geladen werden.');
    }
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  const changeParticipation = async (id: string, method: 'POST' | 'DELETE') => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    ++requestSequence.current; // An older refresh cannot restore a superseded participation state.
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/learning-pathways/${encodeURIComponent(id)}/participation`, { method, cache: 'no-store' });
      if (response.status === 403) {
        if (mounted.current) {
          setPathways(null);
          setForbidden(true);
        }
        return;
      }
      const result = await response.json().catch(() => null) as { pathway?: MemberPathway; error?: string } | null;
      if (!response.ok || !result?.pathway) throw new Error(result?.error || 'Deine Änderung konnte nicht gespeichert werden.');
      if (!mounted.current) return;
      setPathways(current => current?.map(row => row.id === id ? result.pathway! : row) ?? null);
      setNotice(method === 'POST' ? 'Deine private Teilnahme ist aktiv.' : 'Deine Teilnahme wurde beendet.');
      window.requestAnimationFrame(() => {
        if (mounted.current) (method === 'POST' ? statusRef.current : joinRef.current)?.focus();
      });
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Deine Änderung konnte nicht gespeichert werden.');
      }
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const joinCourse = async (courseId: string) => {
    if (courseJoinInFlight.current) return;
    courseJoinInFlight.current = true;
    setJoiningCourseId(courseId);
    setCourseError(null);
    try {
      // Path participation never enrolls a learner into its courses. This is
      // a separate, explicit click through the existing free-course flow.
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/enrollment`, { method: 'POST', cache: 'no-store' });
      if (!response.ok) {
        const message = response.status === 409 ? 'Dieser Kurs ist derzeit ausgebucht. Bitte versuche es später erneut.'
          : response.status === 404 ? 'Dieser Kurs ist nicht mehr verfügbar. Bitte prüfe den Lernpfad erneut.'
          : response.status === 403 ? 'Ein Beitritt zu diesem Kurs ist derzeit nicht möglich.'
          : 'Der Kursbeitritt konnte nicht gespeichert werden. Bitte versuche es erneut.';
        throw new Error(message);
      }
      if (!mounted.current) return;
      setPathways(current => current?.map(pathway => ({ ...pathway, courses: pathway.courses.map(course =>
        course.courseId === courseId ? { ...course, isEnrolled: true } : course) })) ?? null);
      router.push(`/courses/${encodeURIComponent(courseId)}/contents`);
    } catch (cause) {
      if (mounted.current) setCourseError({ courseId, message: cause instanceof Error ? cause.message : 'Der Kursbeitritt konnte nicht gespeichert werden.' });
    } finally {
      courseJoinInFlight.current = false;
      if (mounted.current) setJoiningCourseId(null);
    }
  };

  const selected = pathwayId ? pathways?.find(pathway => pathway.id === pathwayId) : null;
  const joined = selected?.participation && !selected.participation.optedOutAt;
  const latestRevocation = selected ? latestRelevantRevocation(selected) : null;
  const needsRevalidation = Boolean(selected && joined && !selected.participation?.badgeActive && latestRevocation);

  if (forbidden) return <PathwaysAccessDenied />;

  return <AppShell>
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row"><h1 className="app-header-title">{pathwayId ? 'Mein Lernpfad' : 'Lernpfade'}</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10 lg:px-8">
          <nav aria-label="Brotkrumen" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/courses" className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Kurse</Link>
            <span aria-hidden="true">/</span>
            {pathwayId ? <><Link href="/courses/pathways" className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Lernpfade</Link><span aria-hidden="true">/</span><span aria-current="page" className="truncate text-foreground">{selected?.title ?? 'Lernpfad'}</span></> : <span aria-current="page" className="text-foreground">Lernpfade</span>}
          </nav>
          <header className="mt-6 flex min-w-0 flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 max-w-[68ch]">
              <h2 className="mt-2 break-words text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold leading-tight tracking-tight">{pathwayId ? selected?.title ?? 'Dein Lernpfad' : 'Ein Weg durch passende Kurse'}</h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{pathwayId && selected ? selected.description : 'Lernpfade verbinden zwei bis vier veröffentlichte Kurse. Du entscheidest selbst, ob du teilnimmst. Dein Fortschritt und dein Abzeichen sind nur für dich sichtbar.'}</p>
            </div>
            <Button type="button" variant="outline" className="self-start whitespace-nowrap sm:self-auto" onClick={() => void load()} disabled={pending}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />Stand prüfen
            </Button>
          </header>
          {notice && <p role="status" aria-live="polite" className="mt-5 rounded-xl border bg-card px-4 py-3 text-sm font-medium">{notice}</p>}
          {error && <div className="mt-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>Erneut laden</Button></div>}
          {pathways === null && !error && <div className="mt-7"><PageState kind="loading" title="Lernpfade werden geladen" /></div>}
          {pathways !== null && !pathwayId && <section aria-labelledby="pathway-list-title" className="mt-8">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h3 id="pathway-list-title" className="text-xl font-semibold tracking-tight">Verfügbare Lernpfade</h3><p className="text-sm text-muted-foreground">{pathways.length} {pathways.length === 1 ? 'Lernpfad' : 'Lernpfade'}</p></div>
            {pathways.length === 0 ? <PageState title="Noch keine Lernpfade verfügbar" description="Schau später noch einmal vorbei. Deine Kurse bleiben wie gewohnt verfügbar." action={<Button asChild variant="outline"><Link href="/courses">Kurse ansehen</Link></Button>} />
              : <ol className="divide-y border-y">{pathways.map((pathway, index) => <li key={pathway.id} className="min-w-0">
                <Link href={`/courses/pathways/${encodeURIComponent(pathway.id)}`} className="group grid min-h-32 min-w-0 gap-3 py-5 focus-visible:rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:items-start sm:gap-5">
                  <span className="hidden pt-0.5 text-xl font-semibold tabular-nums text-muted-foreground sm:block" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className="min-w-0"><span className="block break-words text-lg font-semibold tracking-tight group-hover:underline">{pathway.title}</span><span className="mt-1 block max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{pathway.description}</span><span className="mt-3 block text-xs font-medium text-foreground">{pathwayStatus(pathway)} · {pathway.requiredCount} Kurse</span></span>
                  <span className="flex items-center gap-2 text-sm font-medium text-primary sm:mt-1">Details ansehen <ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                </Link>
              </li>)}</ol>}
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">Ein Abzeichen hier ist eine private Anerkennung deiner aktuell bestätigten Kursabschlüsse. Es ist kein Zertifikat und wird nicht im Profil oder in Ranglisten angezeigt.</p>
          </section>}
          {pathways !== null && pathwayId && !selected && <div className="mt-8"><PageState kind="empty" title="Lernpfad nicht gefunden" description="Dieser Lernpfad ist nicht verfügbar." action={<Button asChild variant="outline"><Link href="/courses/pathways">Alle Lernpfade ansehen</Link></Button>} /></div>}
          {selected && <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,18rem)] lg:gap-12">
            <div className="min-w-0">
              <section aria-labelledby="pathway-progress-title">
                <div className="flex flex-col gap-2 border-b pb-5 sm:flex-row sm:items-end sm:justify-between"><div><h3 id="pathway-progress-title" ref={statusRef} tabIndex={-1} className="mt-1 text-xl font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{pathwayStatus(selected)}</h3></div><p className="text-sm tabular-nums text-muted-foreground">{selected.creditedCount} von {selected.requiredCount} Kursen aktuell bestätigt</p></div>
                <progress className="mt-5 h-3 w-full accent-progress" value={Math.min(selected.creditedCount, selected.requiredCount)} max={selected.requiredCount || 1} aria-label={`Lernpfad: ${selected.creditedCount} von ${selected.requiredCount} Kursen aktuell bestätigt`}>{selected.creditedCount} von {selected.requiredCount}</progress>
                {needsRevalidation && <div role="status" className="mt-5 border-l-2 border-destructive bg-muted/50 px-4 py-3"><p className="font-medium">Abzeichen derzeit nicht aktiv</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{pathwayReason(latestRevocation?.reason ?? null)} Wenn die Voraussetzungen wieder erfüllt sind, kann es erneut aktiv werden. <Button type="button" variant="link" className="h-auto p-0 align-baseline" onClick={() => void load()}>Stand erneut prüfen</Button></p></div>}
                {joined && selected.participation?.badgeActive && <div className="mt-5 border-l-2 border-reward-foreground bg-reward px-4 py-3 text-reward-foreground"><p className="font-medium">Privates Abzeichen aktiv: {selected.badgeLabel}</p><p className="mt-1 text-sm leading-relaxed">Diese Anerkennung ist nur in deinem Lernpfad sichtbar. Sie ist kein Zertifikat.</p></div>}
                {!joined && <div className="mt-5 border-l-2 border-border bg-muted/50 px-4 py-3"><p className="text-sm leading-relaxed">Du kannst diesen Weg freiwillig beginnen. Erst mit deiner Teilnahme wird ein privates Pfad-Abzeichen für dich geführt. Du kannst jederzeit wieder aussteigen.</p></div>}
              </section>
              <section aria-labelledby="pathway-courses-title" className="mt-10"><div className="border-b pb-4"><h3 id="pathway-courses-title" className="mt-1 text-xl font-semibold">Kurse in diesem Lernpfad</h3></div>
                <ol className="divide-y">{[...selected.courses].sort((a, b) => a.order - b.order).map((course, index) => <li key={course.courseId} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 py-5 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-5">
                  <span className="pt-0.5 text-lg font-semibold tabular-nums text-muted-foreground" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><h4 className="break-words font-semibold">{course.title}</h4><p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">{!course.available ? <><BookOpen className="h-4 w-4" aria-hidden="true" /> Kurs nicht mehr verfügbar</> : course.creditActive ? <><Check className="h-4 w-4 text-primary" aria-hidden="true" /> Aktuell bestätigt</> : <><BookOpen className="h-4 w-4" aria-hidden="true" /> Noch nicht bestätigt</>}</p>{courseError?.courseId === course.courseId && <p role="alert" className="mt-2 text-sm text-destructive">{courseError.message}</p>}</div>{course.available && (course.isEnrolled ? <Link href={`/courses/${encodeURIComponent(course.courseId)}/contents`} className="col-start-2 flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:col-start-3">Kurs öffnen <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : <Button type="button" variant="outline" className="col-start-2 min-h-11 self-start sm:col-start-3" aria-label={`Kurs beitreten: ${course.title}`} disabled={joiningCourseId !== null} onClick={() => void joinCourse(course.courseId)}>{joiningCourseId === course.courseId ? 'Beitritt läuft…' : 'Kurs beitreten'}</Button>)}
                </li>)}</ol>
                {selected.courses.some(course => !course.available) && <p role="status" className="mt-4 border-l-2 border-destructive bg-muted/50 px-4 py-3 text-sm leading-relaxed">Ein Kurs dieses Lernpfads ist nicht mehr verfügbar. Sein früherer Stand bleibt sichtbar, aber das Pfad-Abzeichen kann derzeit nicht neu aktiviert werden.</p>}
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Die Reihenfolge ist eine Empfehlung. Auch bereits bestätigte Abschlüsse zählen, sofern sie noch aktuell sind. Ändert sich eine Kursfreigabe oder ein Abschluss, kann der Stand sinken und ein Abzeichen vorübergehend entfallen.</p>
              </section>
              {selected.history.length > 0 && <section aria-labelledby="pathway-history-title" className="mt-10"><h3 id="pathway-history-title" className="border-b pb-4 text-lg font-semibold">Verlauf deiner Anerkennung</h3><ol className="divide-y">{[...selected.history].sort((a, b) => b.at.localeCompare(a.at)).map((event, index) => {
                const priorOptOut = event.type === 'REVOKED' && event.reason === 'OPTED_OUT' &&
                  Boolean(selected.participation?.joinedAt && selected.participation.joinedAt > event.at);
                return <li key={`${event.type}-${event.at}-${index}`} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:justify-between sm:gap-4"><span>{priorOptOut ? 'Frühere Teilnahme beendet' : event.type === 'AWARDED' ? 'Abzeichen erstmals aktiv' : event.type === 'REINSTATED' ? 'Abzeichen erneut aktiv' : 'Abzeichen nicht mehr aktiv'}{event.type === 'REVOKED' && !priorOptOut && <span className="block text-muted-foreground">{pathwayReason(event.reason)}</span>}</span><time dateTime={event.at} className="shrink-0 text-muted-foreground">{dateLabel(event.at)}</time></li>;
              })}</ol></section>}
            </div>
            <aside className="min-w-0 self-start border-t pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0"><ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" /><h3 className="mt-3 text-lg font-semibold">Deine Entscheidung</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Teilnahme und Abzeichen sind privat. Niemand sieht hier eine Liste von Teilnehmenden.</p>
              {joined ? <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" className="mt-5 w-full whitespace-nowrap" disabled={pending}>Teilnahme beenden</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Teilnahme an diesem Lernpfad beenden?</AlertDialogTitle><AlertDialogDescription>Dein Pfad-Abzeichen wird inaktiv. Deine Kursabschlüsse bleiben erhalten. {selected.unavailable ? 'Eine erneute Teilnahme ist derzeit nicht möglich, da mindestens ein Kurs entfernt oder unveröffentlicht ist.' : 'Du kannst später erneut teilnehmen.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Weiter teilnehmen</AlertDialogCancel><AlertDialogAction onClick={() => void changeParticipation(selected.id, 'DELETE')}>Teilnahme beenden</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : selected.unavailable ? <p className="mt-5 text-sm text-muted-foreground">Eine neue Teilnahme ist derzeit nicht möglich.</p> : <Button ref={joinRef} type="button" className="mt-5 w-full whitespace-nowrap" disabled={pending} onClick={() => void changeParticipation(selected.id, 'POST')}>{pending ? 'Wird gespeichert…' : selected.participation ? 'Erneut privat teilnehmen' : 'Privat teilnehmen'}</Button>}
              <Button asChild variant="link" className="mt-2 w-full"><Link href="/courses/pathways"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Alle Lernpfade</Link></Button>
            </aside>
          </div>}
        </div>
      </main>
    </div>
  </AppShell>;
}
