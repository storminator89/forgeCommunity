'use client'

import { Button } from '@/components/ui/button'
import type { CommunityFilters } from '@/lib/community-filters'

export function FeedFilters({ filters, topic, disabled, onChange, onClear }: {
  filters: CommunityFilters
  topic: string | null
  disabled: boolean
  onChange: (filters: CommunityFilters) => void
  onClear: () => void
}) {
  return <fieldset disabled={disabled} className="mt-5 min-w-0" aria-describedby="community-feed-filter-help">
    <legend className="text-sm font-medium">Beiträge filtern</legend>
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm disabled:opacity-50">
        <input type="checkbox" checked={filters.mine} onChange={event => onChange({ ...filters, mine: event.target.checked })} className="h-4 w-4 accent-primary" />
        Meine Beiträge
      </label>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm disabled:opacity-50">
        <input type="checkbox" checked={filters.unanswered} onChange={event => onChange({ ...filters, unanswered: event.target.checked })} className="h-4 w-4 accent-primary" />
        Ohne Antworten
      </label>
      {(topic || filters.mine || filters.unanswered) && <Button type="button" variant="ghost" size="sm" className="h-auto min-h-11 whitespace-normal" onClick={onClear}>Alle Filter zurücksetzen</Button>}
    </div>
    <p id="community-feed-filter-help" className="mt-1 text-sm text-muted-foreground">Ohne Antworten zeigt Beiträge ohne Kommentare. Eigene Kommentare zählen mit.</p>
    {disabled && <p className="mt-2 text-sm text-muted-foreground" role="status">Schließe zuerst deinen Beitragsentwurf oder warte auf die laufende Aktion, bevor du Filter wechselst.</p>}
  </fieldset>
}
