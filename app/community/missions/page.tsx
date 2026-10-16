'use client';

/* Quiet, read-only directory · design.md semantic tokens and responsive list rhythm. */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { missionUrl, missionWeekDates, type SpaceMissionOverview } from '@/components/spaces/mission-api';
import { spaceJson, SpaceHttpError, type SpacePage } from '@/components/spaces/space-api';
import { useSpaceListGeneration } from '@/hooks/useSpaceAccess';

export default function MissionOverviewPage() {
  const { data, status } = useSession();
  if (status === 'loading') return <SpaceShell><h1 className="sr-only">Space-Missionen</h1><PageState kind="loading" title="Space-Missionen werden geladen" /></SpaceShell>;
  if (status !== 'authenticated' || !data?.user?.id) return <SpaceShell><h1 className="sr-only">Space-Missionen</h1><PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um Missionen deiner privaten Spaces zu sehen." action={<Button asChild variant="outline"><Link href="/login?callbackUrl=%2Fcommunity%2Fmissions">Zur Anmeldung</Link></Button>} /></SpaceShell>;
  // Account and role transitions discard every previous response and visible row.
  return <MissionOverview key={JSON.stringify([data.user.id, data.user.role ?? ''])} />;
}

function MissionOverview() {
  const [items, setItems] = useState<SpaceMissionOverview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const depthRef = useRef(1);
  const focusAfterPageRef = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const beginRead = useSpaceListGeneration();

  const load = useCallback(async (depth: number, more = false) => {
    const read = beginRead();
    // Never keep a cached prefix visible while checking current membership.
    setItems([]); setCursor(null); setError(''); setLoading(true); setLoadingMore(more);
    focusAfterPageRef.current = more;
    try {
      const fresh = new Map<string, SpaceMissionOverview>();
      let nextCursor: string | null = null;
      let pagesRead = 0;
      do {
        const path: string = nextCursor ? `/api/space-missions?cursor=${encodeURIComponent(nextCursor)}` : '/api/space-missions';
        const page: SpacePage<SpaceMissionOverview> = await spaceJson(path, { signal: read.signal });
        if (!read.isCurrent()) return;
        page.items.forEach(item => fresh.set(item.id, item));
        nextCursor = page.nextCursor;
        pagesRead += 1;
      } while (nextCursor && pagesRead < depth);
      if (!read.isCurrent()) return;
      // Load-more replaces the reauthorized prefix plus its new page, never appends
      // previously cached rows. Each page is a server authorization snapshot.
      depthRef.current = pagesRead;
      setItems(Array.from(fresh.values())); setCursor(nextCursor);
    } catch (caught) {
      if (!read.isCurrent()) return;
      setItems([]); setCursor(null); depthRef.current = 1;
      setError(caught instanceof SpaceHttpError && caught.status === 401
        ? 'Deine Anmeldung ist nicht mehr gültig. Melde dich erneut an.'
        : 'Die Missionen konnten nicht geprüft werden. Versuche es erneut.');
    } finally {
      if (read.isCurrent()) { setLoading(false); setLoadingMore(false); }
    }
  }, [beginRead]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(1); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    const recheck = () => { if (document.visibilityState !== 'hidden') void load(depthRef.current); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => { window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [load]);
  useEffect(() => {
    if (!loading && focusAfterPageRef.current) {
      focusAfterPageRef.current = false;
      resultRef.current?.focus();
    }
  }, [loading]);

  return <SpaceShell>
    <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Deine privaten Spaces</p>
        <h1 className="mt-2 text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight [overflow-wrap:anywhere]">Space-Missionen</h1>
        <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">Offene Missionen aus privaten Spaces, in denen du Mitglied bist. Öffne eine Mission, um mehr zu erfahren und freiwillig teilzunehmen.</p>
      </div>
      <Button type="button" variant="outline" onClick={() => void load(depthRef.current)}>Übersicht aktualisieren</Button>
    </div>
    <div className="mt-6" aria-busy={loading}>
      {loading ? <PageState kind="loading" title="Missionen werden geprüft" description="Deine aktuellen Space-Mitgliedschaften werden erneut berücksichtigt." />
        : error ? <PageState kind="error" title="Missionen nicht verfügbar" description={error} action={<Button type="button" variant="outline" onClick={() => void load(depthRef.current)}>Erneut versuchen</Button>} />
          : items.length === 0 ? <PageState title="Keine offenen Missionen" description="In deinen privaten Spaces sind gerade keine offenen Missionen verfügbar." action={<Button asChild variant="outline"><Link href="/community/spaces">Zu den Spaces</Link></Button>} />
            : <ul className="divide-y border-y">{items.map(item => <li key={item.id} className="min-w-0 py-5 sm:py-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="min-w-0 text-lg font-semibold"><Link prefetch={false} href={missionUrl(item.space.id, item.id)} className="rounded-sm underline-offset-4 [overflow-wrap:anywhere] hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{item.title}</Link></h2>
                {item.participationActive && <p className="text-sm font-medium">Du nimmst teil</p>}
              </div>
              <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">Space: {item.space.name}</p>
              <p className="mt-3 text-sm leading-relaxed">{!item.week ? 'Ohne feste Lernwoche · In deinem Tempo' : item.windowState === 'past' ? 'Lernwoche vorbei · Mission bleibt offen' : 'Diese Lernwoche · Ohne verpflichtende Frist'}</p>
              {item.week && <p className="mt-1 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{missionWeekDates(item.week)}</p>}
            </li>)}</ul>}
      <p ref={resultRef} tabIndex={-1} role="status" className="mt-4 rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{loading ? 'Aktueller Stand wird geladen…' : error ? 'Keine Missionsdaten angezeigt.' : `${items.length} ${items.length === 1 ? 'Mission' : 'Missionen'} ${cursor ? 'bisher geladen' : 'geladen'}`}</p>
      {(cursor || loadingMore) && <Button type="button" variant="outline" className="mt-4" disabled={loading} onClick={() => void load(depthRef.current + 1, true)}>{loadingMore ? 'Wird geprüft…' : 'Weitere Missionen laden'}</Button>}
    </div>
  </SpaceShell>;
}
