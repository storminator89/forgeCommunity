'use client'

import { useEffect, useRef } from 'react'
import { ArrowRight, MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CONTRIBUTION_TARGETS, type ContributionSummary } from '@/lib/contributions'
import { MilestoneTrack } from './MilestoneTrack'
import { ProgressSpark } from './ProgressSpark'
import { getPreferredScrollBehavior } from '@/lib/scroll-behavior'

interface Props {
  summary: ContributionSummary | null
  loading: boolean
  error: boolean
  isSignedIn: boolean
  onRefresh: () => void
}

export function ContributionMilestonesCard({ summary, loading, error, isSignedIn, onRefresh }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const ready = isSignedIn && !loading && !error && summary !== null
  const count = ready && summary.eligible ? summary.selectedByAuthors : null
  const nextTarget = count === null ? undefined : CONTRIBUTION_TARGETS.find(target => count < target)
  const failed = isSignedIn && !loading && (error || summary === null)

  useEffect(() => {
    if (failed && detailsRef.current) detailsRef.current.open = true
  }, [failed])

  return <section aria-labelledby="contribution-milestones-title" className="flex min-w-0 flex-col p-4 [overflow-wrap:anywhere] sm:p-5">
    <header className="min-w-0">
      <h3 id="contribution-milestones-title" className="flex items-center gap-2 text-base font-semibold tracking-tight"><MessagesSquare className="size-4 shrink-0 text-coral" aria-hidden="true" />Deine Hilfe wirkt</h3>
      <p className="mt-1 text-xs text-muted-foreground">Aktuell ausgewählt</p>
    </header>
    <div className="mt-3 flex min-h-20 min-w-0 items-center justify-between gap-3" aria-busy={isSignedIn && loading}>
      <div className="min-w-0">
        {!isSignedIn ? <p className="text-sm text-muted-foreground">Melde dich an, um deinen aktuellen Diskussionsstand zu sehen.</p>
          : loading ? <p className="text-sm text-muted-foreground" role="status">Diskussionsmeilensteine werden geladen…</p>
          : failed ? <p className="text-sm text-destructive" role="alert">Diskussionsmeilensteine konnten nicht geladen werden.</p>
          : ready && (!summary.eligible ? <p className="text-sm text-muted-foreground">Für dieses Konto werden derzeit keine Diskussionsmeilensteine angezeigt.</p>
            : count !== null && <>
              <p className={`text-4xl font-semibold tracking-tight tabular-nums ${count > 0 ? 'text-coral' : 'text-foreground'}`}><span className="mr-1.5 text-sm font-normal text-muted-foreground">Von</span>{summary.saturated ? '5+' : count}</p>
              <p className="mt-1 text-xs text-muted-foreground">{count === 1 ? 'Diskussionsautor' : 'unterschiedlichen Diskussionsautoren'} ausgewählt</p>
            </>)}
      </div>
      <ProgressSpark state={count === null ? 'neutral' : count >= CONTRIBUTION_TARGETS[0] ? 'reached' : 'target'} />
    </div>

    {count !== null && <MilestoneTrack count={count} targets={CONTRIBUTION_TARGETS} current tone="contribution"
      label="Aktuelle Diskussionsmeilensteine" unit={target => target === 1 ? 'Autor' : 'Autoren'}
      remaining={remaining => `Noch ${remaining} ${remaining === 1 ? 'weiterer Diskussionsautor' : 'weitere Diskussionsautoren'} bis dahin`}
      complete="Alle drei Meilensteine aktuell erreicht · Anzeige endet bei 5+"
      progressDescription={nextTarget ? `Aktuell von ${count} ${count === 1 ? 'Diskussionsautor' : 'unterschiedlichen Diskussionsautoren'} ausgewählt; nächster Meilenstein: ${nextTarget} ${nextTarget === 1 ? 'Diskussionsautor' : 'unterschiedliche Diskussionsautoren'}` : 'Der Meilenstein bei 5 unterschiedlichen Diskussionsautoren ist aktuell erreicht; die Anzeige 5+ ist keine genaue Gesamtzahl'} />}

    <div className="mt-auto pt-4">
      <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal">
        <a href="#community-feed-title" onClick={event => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
            event.preventDefault()
            // Keep all post/comment drafts mounted: this action only moves focus.
            const feed = document.getElementById('community-feed-title')
            feed?.focus({ preventScroll: true })
            feed?.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'start' })
          }
        }}>
          {count !== null && !nextTarget ? 'Weiter Wissen teilen' : 'Gespräche finden'}
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </a>
      </Button>
    </div>

    {isSignedIn && <details ref={detailsRef} className="mt-2 min-w-0 border-t text-sm text-muted-foreground">
      <summary className="min-h-11 cursor-pointer rounded-sm py-3 text-sm text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">So wird gezählt</summary>
      <div className="space-y-3 pb-1 text-sm leading-relaxed">
        <p>Hier zählt, wie viele unterschiedliche Autoren veröffentlichter Diskussionen aktuell eine deiner Antworten als Lösung ausgewählt haben. Jeder Autor zählt einmal; die Anzeige endet bei 5+ und ist dann keine genaue Gesamtzahl.</p>
        <p>Es zählen nur reguläre Mitgliedskonten (Rolle USER, keine Testkonten), sowohl bei dir als auch bei den Diskussionsautoren. Eigene Antworten auf eigene Diskussionen, Test- und Betreuungskonten sowie unveröffentlichte Diskussionen zählen nicht.</p>
        <p>Eine persönliche Auswahl, keine unabhängige Prüfung. Sie vergibt keine Punkte und beeinflusst keine öffentliche Rangliste oder Abzeichen.</p>
        <p>Der Stand und die aktuell erreichten Diskussionsmeilensteine können sinken, wenn eine Auswahl entfernt oder ersetzt wird, Inhalte gelöscht oder unveröffentlicht werden oder ein beteiligtes Konto nicht mehr berechtigt ist.</p>
        <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left aria-disabled:cursor-wait aria-disabled:border-input aria-disabled:bg-muted aria-disabled:text-muted-foreground"
          aria-disabled={loading} onClick={() => { if (!loading) onRefresh() }}>
          {failed ? 'Diskussionsmeilensteine erneut laden' : 'Diskussionsmeilensteine aktualisieren'}
        </Button>
      </div>
    </details>}
  </section>
}
