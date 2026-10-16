'use client';

/* A friendly, read-only invitation; participation remains on the mission detail. */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Lightbulb, LockKeyhole, RefreshCw } from 'lucide-react';
import { FriendlyMotionToggle } from '@/components/community/FriendlyMotion';
import { MissionIllustration } from '@/components/spaces/MissionVisuals';
import styles from '@/components/spaces/friendly-missions.module.css';
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
    <header className={`${styles.surface} ${styles.hero}`}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}><LockKeyhole size={14} aria-hidden="true" /> Deine privaten Spaces</p>
        <h1 className="mt-2 text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight [overflow-wrap:anywhere]">Space-Missionen</h1>
        <p className="mt-2 text-sm text-muted-foreground">Eine Idee teilen. Gemeinsam weiterdenken.</p>
      </div>
      <MissionIllustration />
    </header>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">Entdecken & freiwillig mitmachen</p>
      <div className={styles.utility}><Button type="button" variant="ghost" size="icon" aria-label="Übersicht aktualisieren" title="Übersicht aktualisieren" onClick={() => void load(depthRef.current)}><RefreshCw size={18} aria-hidden="true" /></Button><FriendlyMotionToggle /></div>
    </div>
    <div className="mt-2" aria-busy={loading}>
      {loading ? <PageState kind="loading" title="Missionen werden geprüft" description="Deine aktuellen Space-Mitgliedschaften werden erneut berücksichtigt." />
        : error ? <PageState kind="error" title="Missionen nicht verfügbar" description={error} action={<Button type="button" variant="outline" onClick={() => void load(depthRef.current)}>Erneut versuchen</Button>} />
          : items.length === 0 ? <PageState title="Keine offenen Missionen" description="In deinen privaten Spaces sind gerade keine offenen Missionen verfügbar." action={<Button asChild variant="outline"><Link href="/community/spaces">Zu den Spaces</Link></Button>} />
            : <ul className={styles.list}>{items.map(item => <li key={item.id} className={styles.listItem}>
              <span className={styles.listArt} aria-hidden="true"><Lightbulb size={22} /></span>
              <div className={styles.listContent}>
                <p className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.space.name}</p>
                <h2 className="min-w-0 text-lg font-semibold leading-snug"><Link prefetch={false} href={missionUrl(item.space.id, item.id)} className={styles.missionLink}>{item.title}</Link></h2>
                {item.participationActive && <p className={`${styles.pill} mt-2`}>Du nimmst teil</p>}
                <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed"><CalendarDays size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{!item.week ? 'Ohne feste Lernwoche · In deinem Tempo' : item.windowState === 'past' ? 'Lernwoche vorbei · Mission bleibt offen' : 'Diese Lernwoche · Ohne verpflichtende Frist'}</span></p>
                {item.week && <p className="mt-1 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{missionWeekDates(item.week)}</p>}
              </div><ArrowUpRight size={20} className={styles.arrow} aria-hidden="true" />
            </li>)}</ul>}
      <p ref={resultRef} tabIndex={-1} role="status" className="mt-4 rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{loading ? 'Aktueller Stand wird geladen…' : error ? 'Keine Missionsdaten angezeigt.' : `${items.length} ${items.length === 1 ? 'Mission' : 'Missionen'} ${cursor ? 'bisher geladen' : 'geladen'}`}</p>
      {(cursor || loadingMore) && <Button type="button" variant="outline" className="mt-4" disabled={loading} onClick={() => void load(depthRef.current + 1, true)}>{loadingMore ? 'Wird geprüft…' : 'Weitere Missionen laden'}</Button>}
    </div>
  </SpaceShell>;
}
