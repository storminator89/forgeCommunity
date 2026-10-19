'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProgressSpark } from '@/components/community/ProgressSpark';
import { CourseNextStep } from './CourseNextStep';
import { learningGoalDeadline, readLearningGoal, type LearningGoalView } from './goals/learning-goal-view';

type GoalState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; goal: LearningGoalView | null };
const textLink = 'inline-flex min-h-11 items-center rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

/** Actor-keyed by CourseClient. Goal reads never select or scan another course. */
export function CourseGoalSummary({ actorKey, learner, courses, isLoading, loadError }: {
  actorKey: string; learner: boolean; courses: unknown; isLoading: boolean; loadError: boolean;
}) {
  const [state, setState] = useState<GoalState>({ kind: 'loading' });
  const [timezone, setTimezone] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const progressId = useId();
  const disclosureId = useId();

  const loadGoal = useCallback(async () => {
    const request = ++sequence.current;
    controller.current?.abort();
    const readController = new AbortController();
    controller.current = readController;
    setState({ kind: 'loading' });
    const current = () => mounted.current && !readController.signal.aborted && request === sequence.current;
    try {
      const response = await fetch('/api/learning-goals/me', { cache: 'no-store', signal: readController.signal });
      if (!response.ok) throw new Error('Learning goal unavailable');
      const goal = readLearningGoal(await response.json());
      if (!current()) return false;
      setState({ kind: 'ready', goal });
      return true;
    } catch {
      if (current()) setState({ kind: 'error' });
      return false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    try { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); }
    catch { setTimezone(null); }
    void loadGoal();
    return () => { mounted.current = false; sequence.current++; controller.current?.abort(); };
  }, [loadGoal]);

  const refreshGoal = useCallback(() => {
    if (mutationInFlight.current) return;
    setNotice('');
    void loadGoal();
  }, [loadGoal]);

  async function startGoal() {
    if (mutationInFlight.current || state.kind !== 'ready' || state.goal !== null || !timezone) return;
    // Only this deliberate click can create a goal. Never POST again to recover
    // an uncertain result: first establish the existing state with the GET.
    mutationInFlight.current = true;
    const request = ++sequence.current;
    controller.current?.abort();
    setStarting(true);
    setNotice('');
    setState({ kind: 'loading' });
    try {
      const response = await fetch('/api/learning-goals/me', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLeaves: 3, durationDays: 7, timezone }),
      });
      if (!mounted.current || request !== sequence.current) return;
      if (response.status === 409) {
        if (await loadGoal() && mounted.current) setNotice('Dein aktueller Lernzielstand wurde geladen.');
        return;
      }
      if (!response.ok) throw new Error('Learning goal start unconfirmed');
      const goal = readLearningGoal(await response.json());
      if (!goal) throw new Error('Learning goal start unconfirmed');
      if (!mounted.current || request !== sequence.current) return;
      setState({ kind: 'ready', goal });
      setNotice('Dein privates Lernziel ist gestartet.');
      window.requestAnimationFrame(() => { if (mounted.current) summaryRef.current?.focus(); });
    } catch {
      if (!mounted.current || request !== sequence.current) return;
      const recovered = await loadGoal();
      if (mounted.current) setNotice(recovered
        ? 'Der Start konnte nicht bestätigt werden. Angezeigt ist dein erneut geladener Lernzielstand.'
        : 'Der Start ist unklar. Prüfe zuerst den aktuellen Stand, bevor du es erneut versuchst.');
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setStarting(false);
    }
  }

  const goal = state.kind === 'ready' ? state.goal : null;
  const heading = goal ? `Dein ${goal.durationDays}-Tage-Lernziel` : state.kind === 'ready' ? 'Dein 7-Tage-Lernziel' : 'Dein privates Lernziel';
  const summary = <div ref={summaryRef} tabIndex={-1} aria-labelledby={headingId} aria-busy={state.kind === 'loading'}
    className={`${learner ? 'mt-4 border-b pb-4' : ''} min-w-0 [overflow-wrap:anywhere] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring`}>
    <div className="flex min-w-0 items-start gap-3 sm:gap-5">
      <div className="min-w-0 flex-1">
        <h3 id={headingId} className="flex min-w-0 items-center gap-2 text-sm font-semibold"><Target aria-hidden="true" className="size-4 shrink-0 text-primary" />{heading}</h3>
        {state.kind === 'loading' && <p role="status" className="mt-2 text-sm text-muted-foreground">{starting ? 'Dein Lernziel wird gestartet …' : 'Dein Lernziel wird geprüft …'}</p>}
        {state.kind === 'error' && <div className="mt-2">
          <p role="alert" className="text-sm text-destructive">Dein Lernzielstand ist gerade unbekannt.</p>
          <Button type="button" variant="outline" className="mt-3 h-auto min-h-11 max-w-full whitespace-normal" disabled={starting} onClick={refreshGoal}>Lernziel erneut prüfen</Button>
        </div>}
        {state.kind === 'ready' && !goal && <>
          <p className="mt-2 text-base font-semibold">3 neue Inhalte in 7 Kalendertagen</p>
          <p className="mt-1 text-sm text-muted-foreground">Freiwillig, privat und erst ab deinem Start.</p>
          <p className="mt-1 text-xs text-muted-foreground">{timezone ? `Die Frist endet um Mitternacht in ${timezone}.` : 'Deine Zeitzone konnte nicht bestimmt werden. Wähle dein Ziel im Planer.'}</p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => void startGoal()} disabled={starting || !timezone}>7-Tage-Ziel starten</Button>
            <Link prefetch={false} href="/courses/goals" className={textLink}>Anderes Ziel wählen</Link>
          </div>
        </>}
        {goal && <>
          <p id={progressId} className="mt-2 text-lg font-semibold tabular-nums">{goal.completedLeaves} von {goal.targetLeaves} {goal.targetLeaves === 1 ? 'Inhalt' : 'Inhalten'} bestätigt</p>
          <progress className="mt-2 block h-2 w-full max-w-xl accent-progress" value={Math.min(goal.completedLeaves, goal.targetLeaves)} max={goal.targetLeaves} aria-labelledby={progressId}>{goal.completedLeaves} von {goal.targetLeaves}</progress>
          <p role="status" className={`mt-2 flex items-start gap-2 text-sm ${goal.status === 'achieved' ? 'font-semibold text-success' : 'text-muted-foreground'}`}>
            {goal.status === 'achieved' && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            {goal.status === 'achieved' ? 'Ziel erreicht. Gut gemacht!' : goal.status === 'paused' ? 'Pausiert. Bestätigtes Lernen zählt weiterhin.' : goal.status === 'ended' ? 'Zeitraum beendet. Neue Abschlüsse zählen hierfür nicht mehr.' : 'Ein Schritt nach dem anderen.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{goal.pausedAt ? 'Vorläufig bis' : 'Bis'} einschließlich {learningGoalDeadline(goal)} ({goal.timezone}).</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal px-0 text-left" onClick={refreshGoal} disabled={starting}>Zielstand aktualisieren</Button>
            <Link prefetch={false} href="/courses/goals" className={textLink}>{goal.status === 'ended' ? 'Ziel beenden oder neu wählen' : 'Ziel verwalten'}</Link>
          </div>
        </>}
        {notice && <p role="status" className="mt-2 text-sm text-muted-foreground">{notice}</p>}
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" aria-controls={disclosureId}>Was zählt? · Freiwilligkeit &amp; Pause</summary>
          <div id={disclosureId} className="max-w-prose space-y-2 pb-2 leading-relaxed">
            <p>Es zählen neue, serverbestätigte Inhalte ab deinem Start aus angemeldeten Kursen anderer Lehrkräfte. Quizze müssen bestanden und Aufgaben ausreichend bewertet sein.</p>
            <p>Aktuelle Kursversionen und Voraussetzungen gelten weiter. Änderungen, eine beendete Anmeldung oder zurückgenommene Bewertungen können den Zähler senken. Dein bisheriges Lernen bleibt wertvoll.</p>
            <p>{goal ? `Der Zeitraum umfasst ${goal.durationDays} Kalendertage ab dem Starttag, keine feste Kalenderwoche.` : state.kind === 'ready' ? 'Das vorgeschlagene Ziel umfasst 7 Kalendertage ab dem Starttag, keine feste Kalenderwoche.' : 'Der gewählte Zeitraum beginnt am Starttag und ist keine feste Kalenderwoche.'} Bei einer Pause verschiebt sich die Frist mit jedem Tageswechsel in der Ziel-Zeitzone; bestätigtes Lernen zählt während einer Pause weiter.</p>
            <p>Du kannst das Ziel im Planer jederzeit pausieren oder beenden. Es ist nur für dich sichtbar und vergibt keine Punkte oder Serie.</p>
          </div>
        </details>
      </div>
      {state.kind === 'ready' && <div className="shrink-0"><ProgressSpark state={goal?.status === 'achieved' ? 'reached' : goal && goal.status === 'active' ? 'target' : 'neutral'} /></div>}
    </div>
  </div>;

  return learner
    ? <CourseNextStep actorKey={actorKey} courses={courses} isLoading={isLoading} loadError={loadError} goalSummary={summary} onProgressRefresh={refreshGoal} />
    : <section aria-labelledby={headingId} className="mb-6 min-w-0 rounded-2xl border border-primary/20 bg-card p-5 shadow-sm sm:p-6">{summary}</section>;
}
