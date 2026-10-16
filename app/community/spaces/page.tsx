'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: editorial workbench · structure: compact directory · design-system: design.md */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageState } from '@/components/page-state';
import { SpaceGlobeIcon, SpaceLockIcon } from '@/components/spaces/SpaceIcons';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { revalidateSpacePages, spaceJson, spaceUrl, type SpacePage, type SpaceSummary } from '@/components/spaces/space-api';

export default function SpacesPage() {
  const { data, status } = useSession();
  if (status === 'loading') return <SpaceShell><PageState kind="loading" title="Spaces werden geladen" /></SpaceShell>;
  if (!data?.user?.id) return <SpaceShell><PageState kind="error" title="Anmeldung erforderlich" /></SpaceShell>;
  return <SpacesDirectory key={`${data.user.id}:${data.user.role ?? ''}`} canCreate={data.user.role === 'ADMIN'} />;
}

function SpacesDirectory({ canCreate }: { canCreate: boolean }) {
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PUBLIC' | 'PRIVATE'>('ALL');
  const epochRef = useRef(0);
  const requestsRef = useRef(new Set<AbortController>());
  const resultRef = useRef<HTMLParagraphElement>(null);
  const focusAfterPageRef = useRef(false);
  const nameId = useId();
  const descriptionId = useId();
  const visibilityId = useId();

  useEffect(() => {
    const controller = new AbortController();
    const epoch = epochRef.current;
    const requests = requestsRef.current;
    requests.add(controller);
    void spaceJson<SpacePage<SpaceSummary>>('/api/spaces', { signal: controller.signal })
      .then(page => { if (!controller.signal.aborted && epoch === epochRef.current) { setSpaces(page.items); setCursor(page.nextCursor); setLoaded(true); } })
      .catch(() => { if (!controller.signal.aborted && epoch === epochRef.current) { setSpaces([]); setCursor(null); setLoaded(false); setError('Spaces konnten nicht geladen werden.'); } })
      .finally(() => { requests.delete(controller); if (!controller.signal.aborted && epoch === epochRef.current) setLoading(false); });
    return () => { controller.abort(); requests.delete(controller); };
  }, [refresh]);

  const refreshDirectory = useCallback(() => {
    epochRef.current += 1;
    requestsRef.current.forEach(controller => controller.abort());
    requestsRef.current.clear();
    setLoading(true); setLoadingMore(false); setError(''); setLoaded(false); setSpaces([]); setCursor(null);
    setRefresh(value => value + 1);
  }, []);

  useEffect(() => {
    if (!loaded || loading) return;
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return;
      epochRef.current += 1;
      requestsRef.current.forEach(controller => controller.abort());
      requestsRef.current.clear();
      setLoadingMore(false);
      const epoch = epochRef.current;
      const controller = new AbortController();
      requestsRef.current.add(controller);
      setLoading(true);
      void revalidateSpacePages<SpaceSummary>('/api/spaces', spaces.length, path => spaceJson(path, { signal: controller.signal }))
        .then(page => { if (!controller.signal.aborted && epoch === epochRef.current) { setSpaces(page.items); setCursor(page.nextCursor); setError(''); } })
        .catch(() => { if (!controller.signal.aborted && epoch === epochRef.current) { setSpaces([]); setCursor(null); setLoaded(false); setError('Spaces konnten nicht erneut geprüft werden.'); } })
        .finally(() => { requestsRef.current.delete(controller); if (!controller.signal.aborted && epoch === epochRef.current) setLoading(false); });
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => { window.removeEventListener('focus', revalidate); document.removeEventListener('visibilitychange', revalidate); };
  }, [loaded, loading, spaces.length]);

  useEffect(() => () => {
    epochRef.current += 1;
    requestsRef.current.forEach(controller => controller.abort());
    requestsRef.current.clear();
  }, []);

  useEffect(() => {
    if (focusAfterPageRef.current && !loadingMore && !cursor && document.activeElement === document.body) {
      focusAfterPageRef.current = false;
      resultRef.current?.focus();
    }
  }, [loadingMore, cursor]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const epoch = epochRef.current;
    const controller = new AbortController();
    requestsRef.current.add(controller);
    setLoadingMore(true);
    focusAfterPageRef.current = true;
    setError('');
    try {
      const page = await spaceJson<SpacePage<SpaceSummary>>(`/api/spaces?cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal });
      if (controller.signal.aborted || epoch !== epochRef.current) return;
      setSpaces(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))]);
      setCursor(page.nextCursor);
    } catch { if (!controller.signal.aborted && epoch === epochRef.current) setError('Weitere Spaces konnten nicht geladen werden.'); }
    finally { requestsRef.current.delete(controller); if (epoch === epochRef.current) setLoadingMore(false); }
  }, [cursor, loadingMore]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setCreateError('');
    try {
      await spaceJson<SpaceSummary>('/api/spaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), visibility }),
      });
      setName(''); setDescription(''); setVisibility('PUBLIC'); setShowCreate(false); refreshDirectory();
    } catch (caught) { setCreateError(caught instanceof Error ? caught.message : 'Space konnte nicht erstellt werden.'); }
    finally { setSaving(false); }
  }

  const visibleSpaces = spaces.filter(space => filter === 'ALL' || space.visibility === filter);
  const resultCount = `${visibleSpaces.length} ${visibleSpaces.length === 1 ? 'Space' : 'Spaces'}`;
  return <SpaceShell>
    <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Community / Spaces</p>
        <h1 className="mt-2 text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight">Spaces</h1>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">Austausch in klaren Themenräumen.</p>
      </div>
      {canCreate && <Button type="button" onClick={() => { setShowCreate(value => !value); setCreateError(''); }} aria-expanded={showCreate} aria-controls="create-space">{showCreate ? 'Schließen' : 'Space erstellen'}</Button>}
    </div>

    {showCreate && canCreate && <form id="create-space" onSubmit={create} className="my-6 max-w-2xl space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-semibold">Neuer Space</h2>
      <div className="space-y-1"><label htmlFor={nameId} className="text-sm font-medium">Name</label><Input id={nameId} value={name} onChange={event => setName(event.target.value)} minLength={3} maxLength={80} required disabled={saving} /></div>
      <div className="space-y-1"><label htmlFor={descriptionId} className="text-sm font-medium">Beschreibung</label><Textarea id={descriptionId} value={description} onChange={event => setDescription(event.target.value)} maxLength={500} required disabled={saving} /></div>
      <div className="space-y-1"><label htmlFor={visibilityId} className="text-sm font-medium">Sichtbarkeit</label><select id={visibilityId} value={visibility} onChange={event => setVisibility(event.target.value as 'PUBLIC' | 'PRIVATE')} disabled={saving} className="flex min-h-11 w-full rounded-[10px] border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><option value="PUBLIC">Offen für Mitglieder</option><option value="PRIVATE">Privat</option></select></div>
      {visibility === 'PRIVATE' && <p className="text-sm text-muted-foreground">Nur Mitglieder und Administratoren können Inhalte sehen.</p>}
      {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
      <Button type="submit" disabled={saving || !name.trim() || !description.trim()}>{saving ? 'Wird erstellt…' : 'Erstellen'}</Button>
    </form>}

    <div className="flex flex-wrap items-center justify-between gap-3 py-5">
      <div role="group" aria-label="Spaces filtern" className="flex flex-wrap gap-2">{([['ALL', 'Alle'], ['PUBLIC', 'Offen'], ['PRIVATE', 'Privat']] as const).map(([value, label]) => <Button key={value} type="button" variant={filter === value ? 'secondary' : 'ghost'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}</div>
      <p ref={resultRef} tabIndex={-1} className="text-sm tabular-nums text-muted-foreground" aria-live="polite">{loading ? 'Wird geladen…' : `${resultCount} ${cursor ? 'bisher geladen' : 'gefunden'}`}</p>
    </div>
    {loading && <PageState kind="loading" title="Spaces werden geladen" />}
    {!loading && error && !loaded && <PageState kind="error" title="Spaces nicht verfügbar" description={error} action={<Button variant="outline" onClick={refreshDirectory}>Erneut versuchen</Button>} />}
    {!loading && loaded && visibleSpaces.length === 0 && <PageState
      title={cursor ? 'Noch kein passender Space geladen' : 'Keine Spaces gefunden'}
      description={cursor ? 'Auf weiteren Seiten können passende Spaces liegen.' : filter === 'ALL' ? 'Hier sind noch keine Spaces verfügbar.' : 'In dieser Ansicht gibt es keine Spaces.'}
      action={cursor ? <Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Wird geladen…' : 'Weitere Spaces laden'}</Button> : filter !== 'ALL' ? <Button variant="outline" onClick={() => setFilter('ALL')}>Alle anzeigen</Button> : undefined} />}
    {!loading && visibleSpaces.length > 0 && <ul className="divide-y border-y">{visibleSpaces.map(space => <li key={space.id} className="min-w-0"><Link href={spaceUrl(space.id)} className="group flex min-h-28 min-w-0 flex-col justify-center gap-2 py-5 transition-colors hover:bg-muted/40 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:px-2">
      <span className="min-w-0"><span className="block break-words text-lg font-semibold group-hover:text-primary">{space.name}</span><span className="mt-1 block max-w-[70ch] break-words text-sm leading-relaxed text-muted-foreground">{space.description}</span></span>
      <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:justify-end"><span className="inline-flex items-center gap-1.5">{space.visibility === 'PRIVATE' ? <SpaceLockIcon className="h-4 w-4" aria-hidden="true" /> : <SpaceGlobeIcon className="h-4 w-4" aria-hidden="true" />}{space.visibility === 'PRIVATE' ? 'Privat' : 'Offen für Mitglieder'}</span><span>{space.discussionCount} Diskussionen</span></span>
    </Link></li>)}</ul>}
    {error && loaded && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {cursor && !loading && visibleSpaces.length > 0 && <div className="mt-6"><Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Wird geladen…' : 'Weitere Spaces laden'}</Button></div>}
  </SpaceShell>;
}
