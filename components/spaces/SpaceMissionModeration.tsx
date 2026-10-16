'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSpaceListGeneration } from '@/hooks/useSpaceAccess';
import { SpaceAuthorLine } from './SpaceAuthorLine';
import { isSpaceAbort, type SpacePage } from './space-api';
import { type MissionAuditContribution, type MissionRequest } from './mission-api';

/** Retained content is fetched only in this explicit administrator view. */
export function SpaceMissionModeration({ base, request, onModerate }: {
  base: string; request: MissionRequest; onModerate: (id: string, hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MissionAuditContribution[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const beginRead = useSpaceListGeneration();
  const panelId = useId();
  const resultsRef = useRef<HTMLParagraphElement>(null);
  const focusAfterPageRef = useRef(false);

  useEffect(() => {
    if (focusAfterPageRef.current && !loading && !cursor) { focusAfterPageRef.current = false; resultsRef.current?.focus(); }
  }, [loading, cursor]);

  async function load(next?: string) {
    const read = beginRead();
    setLoading(true); setError('');
    try {
      const page = await request<SpacePage<MissionAuditContribution>>(`${base}/contributions/moderation${next ? `?cursor=${encodeURIComponent(next)}` : ''}`, { signal: read.signal });
      if (!read.isCurrent()) return;
      setItems(previous => next ? [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))] : page.items);
      setCursor(page.nextCursor);
    } catch (caught) {
      if (read.isCurrent() && !isSpaceAbort(caught)) { setItems([]); setCursor(null); setError('Moderationsansicht konnte nicht geladen werden.'); }
    } finally { if (read.isCurrent()) setLoading(false); }
  }

  function toggle() {
    beginRead(); setItems([]); setCursor(null); setError('');
    if (!open) void load();
    setOpen(value => !value);
  }

  return <section aria-labelledby={`${panelId}-title`} className="border-t pt-6">
    <h2 id={`${panelId}-title`} className="text-lg font-semibold">Moderation</h2>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Nur Admins können hier aufbewahrte Missionsbeiträge prüfen. Zurückgezogene Beiträge dürfen nicht wieder sichtbar gemacht werden.</p>
    <Button type="button" variant="outline" className="mt-3" aria-expanded={open} aria-controls={panelId} onClick={toggle}>{open ? 'Moderation schließen' : 'Moderation ansehen'}</Button>
    {open && <div id={panelId} className="mt-4">
      {items.length > 0 && <ul className="divide-y border-y">{items.map(item => <li key={item.id} className="min-w-0 py-4">
        <p className="mb-2 text-sm font-medium">{item.kind === 'INSIGHT' ? 'Erkenntnis' : 'Weitergedacht'} · {item.withdrawnAt ? 'Von der Person zurückgezogen' : item.hiddenAt ? 'Ausgeblendet' : 'Nicht zurückgezogen'}</p>
        <SpaceAuthorLine author={item.author} date={item.createdAt} />
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
        {!item.withdrawnAt && <Button type="button" variant="outline" className="mt-3" disabled={loading} onClick={() => onModerate(item.id, !item.hiddenAt)}>{item.hiddenAt ? 'Wieder einblenden' : 'Ausblenden'}</Button>}
        {item.hiddenAt && !item.withdrawnAt && <p className="mt-2 text-sm text-muted-foreground">Einblenden ist nur wirksam, wenn Teilnahme und gegebenenfalls Zielbeitrag noch gültig sind.</p>}
      </li>)}</ul>}
      {loading && <p role="status" className="mt-3 text-sm text-muted-foreground">Moderationsbeiträge werden geladen…</p>}
      {!loading && !error && <p ref={resultsRef} tabIndex={-1} role="status" className="mt-3 text-sm text-muted-foreground">{items.length ? `${items.length} Moderationsbeiträge geladen` : 'Keine aufbewahrten Beiträge.'}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {error && <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>Moderation erneut laden</Button>}
      {cursor && <Button type="button" variant="outline" className="mt-3" disabled={loading} onClick={() => { focusAfterPageRef.current = true; void load(cursor); }}>Weitere Moderationsbeiträge</Button>}
    </div>}
  </section>;
}
