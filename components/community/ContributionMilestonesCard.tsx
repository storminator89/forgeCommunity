import { Button } from '@/components/ui/button'
import { CONTRIBUTION_TARGETS, type ContributionSummary } from '@/lib/contributions'

interface Props {
  summary: ContributionSummary | null
  loading: boolean
  error: boolean
  isSignedIn: boolean
  onRefresh: () => void
}

export function ContributionMilestonesCard({ summary, loading, error, isSignedIn, onRefresh }: Props) {
  const count = summary?.selectedByAuthors ?? 0
  const nextTarget = CONTRIBUTION_TARGETS.find(target => count < target)

  return <section aria-labelledby="contribution-milestones-title" className="border-t pt-5">
    <h2 id="contribution-milestones-title" className="text-base font-semibold tracking-tight">Meine Diskussionsmeilensteine</h2>
    <p className="mt-2 text-sm text-muted-foreground">Nur für dich sichtbar. Hier zählt, wie viele unterschiedliche Diskussionsautoren aktuell eine deiner Antworten als Lösung ausgewählt haben.</p>
    {!isSignedIn ? <p className="mt-3 text-sm">Melde dich an, um deinen aktuellen Diskussionsstand zu sehen.</p>
      : loading ? <p className="mt-3 text-sm" role="status">Diskussionsmeilensteine werden geladen…</p>
      : error || !summary ? <div className="mt-3">
        <p className="text-sm text-destructive" role="alert">Diskussionsmeilensteine konnten nicht geladen werden.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={onRefresh}>Diskussionsmeilensteine erneut laden</Button>
      </div>
      : <>
        {!summary.eligible ? <p className="mt-3 text-sm">Diese Ansicht gilt für reguläre Mitgliedskonten. Für dieses Konto werden derzeit keine Diskussionsmeilensteine angezeigt.</p>
          : <>
            <p className="mt-4 text-sm font-medium tabular-nums">{count === 0 ? 'Noch keine aktuelle Auswahl durch andere Diskussionsautoren.' : `Aktuell von ${summary.saturated ? '5+' : count} ${count === 1 ? 'Diskussionsautor' : 'Diskussionsautoren'} ausgewählt`}</p>
            <ol className="mt-4 space-y-2 text-sm" aria-label="Aktuelle Diskussionsmeilensteine">
              {CONTRIBUTION_TARGETS.map(target => <li key={target} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span>{target} {target === 1 ? 'Diskussionsautor' : 'unterschiedliche Diskussionsautoren'}</span>
                <span className={count >= target ? "text-coral" : "text-muted-foreground"}>{count >= target ? 'Aktuell erreicht' : 'Noch nicht erreicht'}</span>
              </li>)}
            </ol>
            {nextTarget ? <>
              <p className="mt-4 text-sm tabular-nums">{count} von {nextTarget} unterschiedlichen Diskussionsautoren</p>
              <progress value={count} max={nextTarget} aria-label={`Diskussionsmeilenstein: ${count} von ${nextTarget} unterschiedlichen Diskussionsautoren`} className="mt-2 h-2 w-full accent-progress">{count} von {nextTarget}</progress>
            </> : <p className="mt-4 text-sm">Alle derzeitigen Diskussionsmeilensteine sind aktuell erreicht. Die Anzeige endet bei 5+.</p>}
          </>}
        <Button type="button" variant="outline" className="mt-4" onClick={onRefresh}>Diskussionsmeilensteine aktualisieren</Button>
      </>}
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Eine persönliche Auswahl, keine unabhängige Prüfung. Sie vergibt keine Punkte und beeinflusst keine öffentliche Rangliste oder Abzeichen. Jeder Autor zählt einmal; eigene Antworten, Test- und Betreuungskonten zählen nicht.</p>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Der Stand kann sinken, wenn eine Auswahl entfernt oder ersetzt wird, Inhalte gelöscht oder unveröffentlicht werden oder ein beteiligtes Konto nicht mehr berechtigt ist.</p>
  </section>
}
