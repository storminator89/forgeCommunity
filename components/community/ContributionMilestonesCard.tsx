import { Check } from 'lucide-react'
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
  const ready = isSignedIn && !loading && !error && summary !== null
  const count = ready && summary.eligible ? summary.selectedByAuthors : null
  const nextTarget = count === null ? undefined : CONTRIBUTION_TARGETS.find(target => count < target)
  const failed = isSignedIn && !loading && (error || summary === null)

  return <section aria-labelledby="contribution-milestones-title" className="min-w-0 border-t pt-5 [overflow-wrap:anywhere]">
    <h2 id="contribution-milestones-title" className="text-base font-semibold tracking-tight">Deine Hilfe wirkt</h2>
    <p className="mt-2 text-sm text-muted-foreground">Nur für dich. Aktuelle Auswahl durch andere Diskussionsautoren.</p>
    <div className="mt-3" aria-busy={isSignedIn && loading}>
      {!isSignedIn ? <p className="text-sm">Melde dich an, um deinen aktuellen Diskussionsstand zu sehen.</p>
        : loading ? <p className="text-sm" role="status">Diskussionsmeilensteine werden geladen…</p>
        : failed ? <p className="text-sm text-destructive" role="alert">Diskussionsmeilensteine konnten nicht geladen werden.</p>
        : ready && (!summary.eligible ? <p className="text-sm">Diese Ansicht gilt für reguläre Mitgliedskonten. Für dieses Konto werden derzeit keine Diskussionsmeilensteine angezeigt.</p>
          : count !== null && <>
            <p className={`text-sm font-medium tabular-nums ${count > 0 ? 'text-coral' : 'text-foreground'}`}>Von {summary.saturated ? '5+' : count} {count === 1 ? 'Diskussionsautor' : 'Diskussionsautoren'} ausgewählt</p>
            <ol className="mt-4 space-y-2 text-sm" aria-label="Aktuelle Diskussionsmeilensteine">
              {CONTRIBUTION_TARGETS.map(target => <li key={target} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span>{target} {target === 1 ? 'Diskussionsautor' : 'unterschiedliche Diskussionsautoren'}</span>
                <span className={`inline-flex items-center gap-1 ${count >= target ? 'text-coral' : 'text-muted-foreground'}`}>
                  {count >= target && <Check className="size-4 shrink-0" aria-hidden="true" />}
                  {count >= target ? 'Aktuell erreicht' : 'Noch nicht erreicht'}
                </span>
              </li>)}
            </ol>
            {nextTarget ? <>
              <p className="mt-4 text-sm tabular-nums">{count} von {nextTarget} unterschiedlichen Diskussionsautoren</p>
              <progress value={count} max={nextTarget} aria-label={`Diskussionsmeilenstein: ${count} von ${nextTarget} unterschiedlichen Diskussionsautoren`} className="mt-2 h-2 w-full accent-progress">{count} von {nextTarget}</progress>
            </> : <p className="mt-4 text-sm">Alle derzeitigen Diskussionsmeilensteine sind aktuell erreicht. Die Anzeige endet bei 5+.</p>}
          </>)}
    </div>
    {isSignedIn && <Button type="button" variant="outline" className="mt-4 h-auto min-h-11 max-w-full whitespace-normal aria-disabled:cursor-wait aria-disabled:border-input aria-disabled:bg-muted aria-disabled:text-muted-foreground"
      aria-disabled={loading} onClick={() => { if (!loading) onRefresh() }}>
      {failed ? 'Diskussionsmeilensteine erneut laden' : 'Diskussionsmeilensteine aktualisieren'}
    </Button>}
    <details className="mt-3 text-sm text-muted-foreground">
      <summary className="min-h-11 cursor-pointer rounded-sm py-3 text-sm text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">So wird gezählt</summary>
      <div className="space-y-3 text-xs leading-relaxed">
        <p>Hier zählt, wie viele unterschiedliche Autoren veröffentlichter Diskussionen aktuell eine deiner Antworten als Lösung ausgewählt haben. Jeder Autor zählt einmal; die Anzeige endet bei 5+ und ist dann keine genaue Gesamtzahl.</p>
        <p>Es zählen nur reguläre Mitgliedskonten (Rolle USER, keine Testkonten), sowohl bei dir als auch bei den Diskussionsautoren. Eigene Antworten auf eigene Diskussionen, Test- und Betreuungskonten sowie unveröffentlichte Diskussionen zählen nicht.</p>
        <p>Eine persönliche Auswahl, keine unabhängige Prüfung. Sie vergibt keine Punkte und beeinflusst keine öffentliche Rangliste oder Abzeichen.</p>
        <p>Der Stand und die aktuell erreichten Diskussionsmeilensteine können sinken, wenn eine Auswahl entfernt oder ersetzt wird, Inhalte gelöscht oder unveröffentlicht werden oder ein beteiligtes Konto nicht mehr berechtigt ist.</p>
      </div>
    </details>
  </section>
}
