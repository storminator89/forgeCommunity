import type { PracticeLearnerState } from './practice-learner-api'

export function practiceReturnLabel(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Display the server's effective return window, never the answer's raw due date. */
export function PracticeAvailabilityNotice({ state }: { state: PracticeLearnerState | null | undefined }) {
  if (!state) return null
  if (state.availability === 'resume') return <p>Eine geöffnete Frage wartet auf dich.</p>
  if (state.availability === 'ready' || state.status === 'ready') return <p>{state.dueCount === 1 ? '1 Frage ist jetzt verfügbar.' : `${state.dueCount} Fragen sind jetzt verfügbar.`}</p>
  if (state.status === 'unavailable') return <p>Privates Üben ist vorübergehend nicht verfügbar. Bitte prüfe den Stand später erneut.</p>
  const label = practiceReturnLabel(state.nextAvailableAt)
  return <>
    {state.availability === 'sessionComplete' && <p>Schließe diese Sitzung bewusst ab. Ein möglicher Rückkehrzeitpunkt gilt für eine neue Sitzung.</p>}
    {label ? <p>Voraussichtlich wieder ab <time dateTime={state.nextAvailableAt!}>{label}</time> (deine Ortszeit).</p>
      : (state.availability === 'waiting' || state.availability === 'sessionComplete') && <p>Derzeit lässt sich kein nächster Zeitpunkt anzeigen. Prüfe den Stand später erneut.</p>}
    {(state.availability === 'waiting' || state.availability === 'sessionComplete') && <p>Fällig heißt nicht sofort verfügbar: In dieser Sitzung gezeigte Fragen werden nicht wiederholt. Die zuletzt geöffneten Fragen können zusätzlich gesperrt sein.</p>}
  </>
}
