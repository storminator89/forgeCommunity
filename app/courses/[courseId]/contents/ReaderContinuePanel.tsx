'use client'

import { Check, FileText, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { projectReaderProgress } from './reader-progress'

type Props = {
  projection: ReturnType<typeof projectReaderProgress>
  entry: boolean
  selectedComplete: boolean
  busy: boolean
  onOpen: (id: string, trigger: HTMLButtonElement) => void
  onRefresh: () => void
}

const actionClassName = 'h-auto min-h-11 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]'

export function ReaderContinuePanel({ projection, entry, selectedComplete, busy, onOpen, onRefresh }: Props) {
  const refresh = <Button type="button" variant="outline" className={actionClassName} disabled={busy} onClick={onRefresh}>{busy ? 'Wird geprüft …' : 'Lernfortschritt aktualisieren'}</Button>
  if (!entry && !selectedComplete && projection.state !== 'unavailable') return <div className="min-w-0 max-w-full border-t pt-5">{refresh}</div>
  const Heading = entry ? 'h2' : 'h3'
  const state = projection.state
  const title = state === 'complete' ? 'Aktuelle Inhalte abgeschlossen' : state === 'empty' ? 'Noch keine Kursinhalte' :
    state === 'locked' ? 'Weitere Inhalte sind noch gesperrt' : state === 'unavailable' ? 'Lernfortschritt neu laden' :
      entry ? 'Dein nächster Lernschritt' : 'Nächster Lernschritt'
  const Icon = state === 'complete' ? Check : state === 'locked' ? LockKeyhole : FileText
  return <div className="min-w-0 max-w-full space-y-4 rounded-xl border bg-card p-5 text-left sm:p-6" aria-label="Nächster Lernschritt" aria-busy={busy}>
    <div className="flex items-start gap-3"><Icon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${state === 'complete' ? 'text-success' : 'text-muted-foreground'}`} />
      <div className="min-w-0 space-y-2"><Heading className="break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</Heading>
        {state === 'ready' && projection.next ? <p className="break-words text-sm [overflow-wrap:anywhere]">{projection.next.title}</p> :
          <p className="break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{state === 'complete' ? 'Lektionen und Freigaben findest du im Inhaltsverzeichnis.' :
            state === 'empty' ? 'Für diesen Kurs wurden noch keine Inhalte angelegt.' :
              state === 'locked' ? 'Prüfe die Voraussetzungen und Kapitelfreigaben im Inhaltsverzeichnis.' : 'Dein nächster Lernschritt konnte nicht sicher geprüft werden.'}</p>}
      </div>
    </div>
    <div className="flex min-w-0 flex-wrap gap-2">
      {state === 'ready' && projection.next && <Button type="button" className={`${actionClassName} text-left`} disabled={busy} onClick={event => onOpen(projection.next!.id, event.currentTarget)}>{entry ? projection.completedCount ? 'Weiterlernen' : 'Kurs starten' : 'Nächste Lektion öffnen'}</Button>}
      {refresh}
    </div>
  </div>
}
