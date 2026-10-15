'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchCommunityJson, isAbortError } from '@/lib/community-feed'
import { MAX_TOPIC_LENGTH } from '@/lib/community-topics'

type Topic = { id: string; name: string }

export function TopicNavigation({ selected, onSelect, disabled = false }: { selected: string | null; onSelect: (topic: string | null) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || disabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(false)
      void fetchCommunityJson<{ topics: Topic[] }>(`/api/posts/topics?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: 'no-store' })
        .then(data => {
          if (!controller.signal.aborted) {
            if (!Array.isArray(data.topics)) throw new Error('Ungültige Antwort')
            setTopics(data.topics)
          }
        })
        .catch(cause => { if (!controller.signal.aborted && !isAbortError(cause)) setError(true) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, query ? 180 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query, attempt, disabled])

  const choose = (topic: string | null) => {
    if (disabled) return
    setOpen(false)
    setQuery('')
    onSelect(topic)
  }

  return <section className="mt-6 rounded-[14px] border border-border bg-card p-4 sm:p-5" aria-labelledby="community-topic-heading">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="community-topic-heading" className="text-base font-semibold">Themen entdecken</h2>
      {selected && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => choose(null)}>Alle Beiträge zeigen</Button>}
    </div>
    {selected && <p className="mt-2 text-sm text-muted-foreground">Aktives Thema: <strong className="text-foreground">{selected}</strong></p>}
    {disabled && <p className="mt-2 text-sm text-muted-foreground" role="status">Schließe zuerst deinen Beitragsentwurf, bevor du das Thema wechselst.</p>}
    <Label htmlFor="community-topic-search" className="mt-4 block text-sm">Thema suchen</Label>
    <Input id="community-topic-search" type="search" value={query} maxLength={MAX_TOPIC_LENGTH} disabled={disabled} onFocus={() => setOpen(true)}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}
      onChange={event => { setQuery(event.target.value); setOpen(true) }} placeholder="z. B. Design oder Weiterbildung" className="mt-2" />
    {open && !disabled && <div className="mt-3">
      {loading && <p className="text-sm text-muted-foreground">Themen werden geladen…</p>}
      {error && <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm text-destructive">Themen konnten nicht geladen werden. <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Erneut versuchen</Button></div>}
      {!loading && !error && <>
        {topics.length > 0 ? <ul className="flex flex-wrap gap-2" aria-label="Gefundene Themen">
          {topics.map(topic => <li key={topic.id}><a href={`/community?tag=${encodeURIComponent(topic.name)}`}
            aria-current={selected === topic.name ? 'page' : undefined}
            onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); choose(topic.name) } }}
            className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm text-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{topic.name}</a></li>)}
        </ul> : <p className="text-sm text-muted-foreground">Keine öffentlichen Themen gefunden. Versuche einen anderen Suchbegriff.</p>}
      </>}
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(false)}>Vorschläge schließen</Button>
    </div>}
  </section>
}
