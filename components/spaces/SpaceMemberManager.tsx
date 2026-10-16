'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiSpaceUrl, isSpaceAbort, type SpaceAuthor, type SpacePage } from './space-api';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export function SpaceMemberManager({ spaceId, request, onChange }: { spaceId: string; request: Request; onChange: () => void }) {
  const base = apiSpaceUrl(spaceId);
  const searchId = useId();
  const optionsId = useId();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SpaceAuthor | null>(null);
  const [candidates, setCandidates] = useState<SpaceAuthor[]>([]);
  const [searching, setSearching] = useState(false);
  const [members, setMembers] = useState<SpaceAuthor[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void request<SpacePage<SpaceAuthor>>(`${base}/members`)
      .then(page => { if (active) { setMembers(page.items); setCursor(page.nextCursor); } })
      .catch(caught => { if (active && !isSpaceAbort(caught)) { setMembers([]); setCursor(null); setError('Mitglieder konnten nicht geladen werden.'); } })
      .finally(() => { if (active) setLoadingMembers(false); });
    return () => { active = false; };
  }, [base, request, refresh]);

  useEffect(() => {
    if (query.trim().length < 2 || selected) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void request<{ items: SpaceAuthor[] }>(`${base}/member-candidates?q=${encodeURIComponent(query.trim())}`)
        .then(result => { if (active) setCandidates(result.items); })
        .catch(caught => { if (active && !isSpaceAbort(caught)) { setCandidates([]); setError('Personensuche fehlgeschlagen.'); } })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [base, query, selected, request, refresh]);

  async function add() {
    if (!selected || pending) return;
    setPending(selected.id); setFeedback(''); setError('');
    try {
      await request(`${base}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selected.id }) });
      setSelected(null); setQuery(''); setCandidates([]); setFeedback('Mitglied hinzugefügt.'); setLoadingMembers(true);
      setRefresh(value => value + 1); onChange();
    } catch (caught) { if (!isSpaceAbort(caught)) setError(caught instanceof Error ? caught.message : 'Mitglied konnte nicht hinzugefügt werden.'); }
    finally { setPending(null); }
  }

  async function remove(member: SpaceAuthor) {
    if (pending) return;
    setPending(member.id); setFeedback(''); setError('');
    try {
      await request(`${base}/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' });
      setMembers(previous => previous.filter(item => item.id !== member.id));
      setFeedback('Mitglied entfernt.'); setLoadingMembers(true); setRefresh(value => value + 1); onChange();
    } catch (caught) { if (!isSpaceAbort(caught)) setError(caught instanceof Error ? caught.message : 'Mitglied konnte nicht entfernt werden.'); }
    finally { setPending(null); }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true); setError('');
    try {
      const page = await request<SpacePage<SpaceAuthor>>(`${base}/members?cursor=${encodeURIComponent(cursor)}`);
      setMembers(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))]);
      setCursor(page.nextCursor);
    } catch (caught) { if (!isSpaceAbort(caught)) setError('Weitere Mitglieder konnten nicht geladen werden.'); }
    finally { setLoadingMore(false); }
  }

  return <section aria-labelledby="space-members-title" className="mt-7 border-b pb-7">
    <h2 id="space-members-title" className="text-base font-semibold">Mitglieder verwalten</h2>
    <div className="mt-4 max-w-xl space-y-2">
      <label htmlFor={searchId} className="text-sm font-medium">Person hinzufügen</label>
      <Input id={searchId} role="combobox" aria-autocomplete="list" aria-controls={optionsId} aria-expanded={candidates.length > 0 && !selected}
        placeholder="Name oder Nutzer-ID suchen" value={query} disabled={!!pending}
        onChange={event => { setQuery(event.target.value); setSelected(null); setCandidates([]); setSearching(false); setFeedback(''); }}
        onKeyDown={event => { if (event.key === 'ArrowDown' && candidates.length) { event.preventDefault(); optionRefs.current[0]?.focus(); } }} />
      {searching && <p role="status" className="text-xs text-muted-foreground">Personen werden gesucht…</p>}
      <div id={optionsId} role="listbox" aria-label="Passende Personen" className={candidates.length && !selected ? 'max-h-64 overflow-y-auto rounded-xl border bg-card p-1' : 'hidden'}>
        {candidates.map((candidate, index) => <button key={candidate.id} ref={element => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selected?.id === candidate.id}
          className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          onClick={() => { setSelected(candidate); setQuery(candidate.name || candidate.id); setCandidates([]); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); optionRefs.current[index + 1]?.focus(); }
            if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) document.getElementById(searchId)?.focus(); else optionRefs.current[index - 1]?.focus(); }
            if (event.key === 'Escape') { event.preventDefault(); setCandidates([]); document.getElementById(searchId)?.focus(); }
          }}>{candidate.name || 'Mitglied'}<span className="sr-only"> ({candidate.id})</span></button>)}
      </div>
      {selected && <p className="text-xs text-muted-foreground">Ausgewählt: {selected.name || 'Mitglied'}</p>}
      <Button type="button" disabled={!selected || !!pending} onClick={add}>{pending && selected?.id === pending ? 'Wird hinzugefügt…' : 'Hinzufügen'}</Button>
    </div>
    <div className="mt-6 max-w-2xl"><h3 className="text-sm font-semibold">Aktuelle Mitglieder</h3>
      {loadingMembers ? <p role="status" className="mt-2 text-sm text-muted-foreground">Mitglieder werden geladen…</p> : members.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Noch keine Mitglieder.</p> : <ul className="mt-2 divide-y border-y">{members.map(member => <li key={member.id} className="flex min-w-0 items-center justify-between gap-3 py-2"><span className="min-w-0 break-words text-sm">{member.name || 'Mitglied'}</span><Button type="button" size="sm" variant="ghost" disabled={!!pending} aria-label={`${member.name || 'Mitglied'} entfernen`} onClick={() => remove(member)}>{pending === member.id ? 'Wird entfernt…' : 'Entfernen'}</Button></li>)}</ul>}
      {cursor && <Button type="button" variant="outline" className="mt-3" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Wird geladen…' : 'Weitere Mitglieder laden'}</Button>}
    </div>
    {feedback && <p role="status" className="mt-3 text-sm">{feedback}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>;
}
