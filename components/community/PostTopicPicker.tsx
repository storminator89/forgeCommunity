'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchCommunityJson, isAbortError } from '@/lib/community-feed'
import { MAX_POST_TOPICS, MAX_TOPIC_LENGTH, normalizeTopicName, validTopicName } from '@/lib/community-topics'

type Topic = { id: string; name: string }

export function PostTopicPicker({ value, onChange, disabled }: { value: string[]; onChange: (topics: string[]) => void; disabled: boolean }) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<Topic[]>([])
  const [error, setError] = useState('')
  const [suggestionError, setSuggestionError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!focused || value.length >= MAX_POST_TOPICS) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSuggestionError(false)
      void fetchCommunityJson<{ topics: Topic[] }>(`/api/posts/topics?q=${encodeURIComponent(input.trim())}`, { signal: controller.signal, cache: 'no-store' })
        .then(data => { if (!controller.signal.aborted && Array.isArray(data.topics)) setSuggestions(data.topics) })
        .catch(cause => { if (!controller.signal.aborted && !isAbortError(cause)) { setSuggestions([]); setSuggestionError(true) } })
    }, input ? 180 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [focused, input, value.length, attempt])

  const add = (raw: string) => {
    const name = normalizeTopicName(raw)
    if (!validTopicName(name)) { setError('Bitte verwende höchstens 48 Zeichen, beginnend mit einem Buchstaben oder einer Zahl.'); return }
    if (value.some(topic => topic.toLowerCase() === name.toLowerCase())) { setError('Dieses Thema ist bereits ausgewählt.'); return }
    if (value.length >= MAX_POST_TOPICS) return
    onChange([...value, name])
    setInput('')
    setError('')
    setFocused(false)
  }

  return <div>
    <Label htmlFor="post-topic-input" className="block text-sm font-medium">Themen (optional, bis zu 3)</Label>
    <p id="post-topic-help" className="mt-1 text-xs text-muted-foreground">Hilft anderen, deinen Beitrag wiederzufinden. Wähle ein bestehendes Thema oder lege eines an.</p>
    {value.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="Ausgewählte Themen">
      {value.map(topic => <li key={topic}><Button type="button" variant="outline" size="sm" disabled={disabled}
        aria-label={`Thema ${topic} entfernen`} onClick={() => onChange(value.filter(item => item !== topic))}>{topic} ×</Button></li>)}
    </ul>}
    {value.length < MAX_POST_TOPICS && <div className="mt-3 flex flex-wrap gap-2">
      <Input id="post-topic-input" value={input} disabled={disabled} maxLength={MAX_TOPIC_LENGTH} aria-describedby="post-topic-help"
        onFocus={() => setFocused(true)} onChange={event => { setInput(event.target.value); setError(''); setFocused(true) }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(input) } else if (event.key === 'Escape') setFocused(false) }}
        placeholder="Thema eingeben" className="min-w-[12rem] flex-1" />
      <Button type="button" variant="outline" disabled={disabled || !input.trim()} onClick={() => add(input)}>Thema hinzufügen</Button>
    </div>}
    {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
    {focused && suggestionError && <div aria-live="polite" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-destructive">Bestehende Themen konnten nicht geladen werden. Du kannst ein neues Thema hinzufügen. <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Themen erneut laden</Button></div>}
    {focused && value.length < MAX_POST_TOPICS && suggestions.length > 0 && <ul className="mt-2 flex flex-wrap gap-2" aria-label="Bestehende Themen">
      {suggestions.filter(topic => !value.some(selected => selected.toLowerCase() === topic.name.toLowerCase())).map(topic => <li key={topic.id}>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => add(topic.name)}>{topic.name}</Button>
      </li>)}
    </ul>}
  </div>
}
