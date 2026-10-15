'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { LoadingScreen } from '@/components/page-state';

type LearningGoal = {
  targetLeaves: number;
  durationDays: number;
  timezone: string;
  startedAt: string;
  endsAt: string;
  pausedAt: string | null;
  completedLeaves: number;
  status: 'active' | 'paused' | 'achieved' | 'ended';
};

export default function CourseGoalsClient() {
  const { data: session, status } = useSession();
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'authenticated' || !session?.user?.id) return <main className="mx-auto max-w-xl px-4 py-16">
    <h1 className="text-2xl font-semibold">Mein Lernziel</h1>
    <p className="mt-3 text-sm text-muted-foreground">Melde dich an, um dein privates Lernziel zu sehen.</p>
    <Button asChild className="mt-5"><Link href="/login">Zur Anmeldung</Link></Button>
  </main>;
  return <ScopedCourseGoals key={session.user.id} />;
}

function ScopedCourseGoals() {
  const [goal, setGoal] = useState<LearningGoal | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [targetLeaves, setTargetLeaves] = useState(3);
  const [durationDays, setDurationDays] = useState(7);
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const targetRef = useRef<HTMLSelectElement>(null);
  const goalStateRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const readSequence = useRef(0);
  const mutationInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void loadGoal(controller);
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  async function loadGoal(controller?: AbortController) {
    const sequence = ++readSequence.current;
    setError('');
    try {
      const response = await fetch('/api/learning-goals/me', { cache: 'no-store', signal: controller?.signal });
      if (!response.ok) throw new Error();
      const result = await response.json() as { goal: LearningGoal | null };
      if (mounted.current && !controller?.signal.aborted && sequence === readSequence.current) setGoal(result.goal);
    } catch {
      if (mounted.current && !controller?.signal.aborted && sequence === readSequence.current) setError('Dein Lernziel konnte nicht geladen werden.');
    }
  }

  async function changeGoal(method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    ++readSequence.current; // A slower refresh must not replace the saved mutation result.
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/learning-goals/me', {
        method, cache: 'no-store',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { goal: LearningGoal | null };
      if (!mounted.current) return;
      setGoal(result.goal);
      setNotice(method === 'POST' ? 'Dein privates Lernziel wurde gestartet.'
        : method === 'DELETE' ? 'Dein Lernziel wurde beendet.'
          : body?.action === 'pause' ? 'Dein Lernziel ist pausiert.' : 'Dein Lernziel läuft wieder.');
      if (method === 'POST') window.requestAnimationFrame(() => { if (mounted.current) goalStateRef.current?.focus(); });
      if (method === 'DELETE') window.requestAnimationFrame(() => { if (mounted.current) targetRef.current?.focus(); });
    } catch {
      if (mounted.current) {
        await loadGoal();
        if (mounted.current) setError('Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.');
      }
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function startGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void changeGoal('POST', { targetLeaves, durationDays, timezone });
  }

  const dueDate = goal ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: goal.timezone })
    .format(new Date(new Date(goal.endsAt).getTime() - 1)) : '';
  const goalNoun = goal?.targetLeaves === 1 ? 'Kursinhalt' : 'Kursinhalten';

  return <AppShell>
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="flex items-center justify-between gap-3"><h1>Mein Lernziel</h1><div className="flex items-center gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
          <Link href="/courses" className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Zur Kursübersicht</Link>
          <div className="mt-6 border-b pb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">In deinem Tempo</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Ein kleines Ziel für deinen nächsten Lernschritt</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Freiwillig und nur für dich sichtbar. Es zählen aktuelle, serverbestätigte Abschlüsse von Kursinhalten, keine Seitenaufrufe oder Klicks. Es gibt dafür keine Punkte, Rangliste oder Serie.</p>
          </div>
          <section aria-labelledby="learning-goal-title" className="mt-7 rounded-2xl border bg-card p-5 sm:p-7">
            <h3 id="learning-goal-title" className="text-lg font-semibold">Dein persönliches Lernziel</h3>
            {goal === undefined && !error && <p role="status" className="mt-4 text-sm text-muted-foreground">Lernziel wird geladen…</p>}
            {error && <div className="mt-4"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" className="mt-3" onClick={() => void loadGoal()} disabled={pending}>Erneut laden</Button></div>}
            {notice && <p role="status" aria-live="polite" className="mt-4 text-sm font-medium">{notice}</p>}
            {goal === null && <form onSubmit={startGoal} className="mt-5 space-y-5">
              <p className="text-sm text-muted-foreground">Wähle ein erreichbares Ziel. Nur neue Abschlüsse ab dem Start zählen; du kannst jederzeit pausieren oder das Ziel beenden.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="goal-target" className="mb-1.5 block text-sm font-medium">Kursinhalte abschließen</label>
                  <select ref={targetRef} id="goal-target" value={targetLeaves} onChange={event => setTargetLeaves(Number(event.target.value))} className="h-11 w-full rounded-xl border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value={1}>1 Inhalt</option><option value={3}>3 Inhalte</option><option value={5}>5 Inhalte</option>
                  </select></div>
                <div><label htmlFor="goal-duration" className="mb-1.5 block text-sm font-medium">Zeitraum</label>
                  <select id="goal-duration" value={durationDays} onChange={event => setDurationDays(Number(event.target.value))} className="h-11 w-full rounded-xl border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value={7}>7 Kalendertage</option><option value={14}>14 Kalendertage</option><option value={28}>28 Kalendertage</option>
                  </select></div>
              </div>
              <p className="text-xs text-muted-foreground">Der Zeitraum endet um Mitternacht in deiner aktuellen Zeitzone ({timezone}). Frühere Abschlüsse zählen nicht.</p>
              <Button type="submit" disabled={pending}>{pending ? 'Wird gestartet…' : 'Privates Lernziel starten'}</Button>
            </form>}
            {goal && <div className="mt-5">
              <p ref={goalStateRef} tabIndex={-1} className="text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{goal.status === 'achieved' ? 'Ziel erreicht' : goal.status === 'paused' ? 'Pausiert' : goal.status === 'ended' ? 'Zeitraum beendet' : 'Du bist unterwegs'}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{goal.completedLeaves} von {goal.targetLeaves} {goalNoun}</p>
              <progress className="mt-3 h-3 w-full accent-primary" value={Math.min(goal.completedLeaves, goal.targetLeaves)} max={goal.targetLeaves} aria-label={`Lernziel: ${goal.completedLeaves} von ${goal.targetLeaves} ${goalNoun} abgeschlossen`}>{goal.completedLeaves} von {goal.targetLeaves}</progress>
              <p className="mt-3 text-sm text-muted-foreground">{goal.status === 'paused' ? `Vorläufig bis einschließlich ${dueDate} (${goal.timezone}). Das Enddatum verschiebt sich für jeden pausierten Kalendertag; bestätigtes Lernen zählt auch während der Pause.` : `Bis einschließlich ${dueDate} (${goal.timezone}).`}</p>
              <p className="mt-2 text-xs text-muted-foreground">Wenn ein Kursinhalt geändert oder entfernt wird, kann der Zähler sinken. Das ist keine Strafe; dein bisheriges Lernen bleibt wertvoll.</p>
              {goal.status === 'ended' && <p className="mt-3 text-sm">Du kannst dieses Ziel beenden und jederzeit ein neues wählen.</p>}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild variant="outline"><Link href="/courses">Kurse entdecken</Link></Button>
                <Button type="button" variant="outline" onClick={() => void loadGoal()} disabled={pending}>Fortschritt aktualisieren</Button>
                {(goal.status === 'active' || goal.status === 'paused') && <Button type="button" variant="outline" disabled={pending} onClick={() => void changeGoal('PATCH', { action: goal.pausedAt ? 'resume' : 'pause' })}>{goal.pausedAt ? 'Ziel fortsetzen' : 'Ziel pausieren'}</Button>}
                <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" disabled={pending}>Ziel beenden</Button></AlertDialogTrigger>
                  <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Privates Lernziel beenden?</AlertDialogTitle><AlertDialogDescription>Dein aktuelles Ziel wird entfernt. Deine Kursfortschritte bleiben erhalten. Du kannst später ein neues Ziel setzen.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Weiterlernen</AlertDialogCancel><AlertDialogAction onClick={() => void changeGoal('DELETE')}>Ziel beenden</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent></AlertDialog>
              </div>
            </div>}
          </section>
        </div>
      </main>
    </div>
  </AppShell>;
}
