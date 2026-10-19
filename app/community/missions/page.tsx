'use client';

/* A friendly private invitation; personal markers never create participation. */

import { Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Lightbulb, LockKeyhole, RefreshCw } from 'lucide-react';
import { FriendlyMotionToggle } from '@/components/community/FriendlyMotion';
import { useInvitationAccount } from '@/components/spaces/mission-invitation-ui';
import { MissionInvitationInbox } from '@/components/spaces/MissionInvitationInbox';
import { MissionIllustration } from '@/components/spaces/MissionVisuals';
import styles from '@/components/spaces/friendly-missions.module.css';
import { useSession } from '@/lib/sites-auth/react';
import { useSearchParams } from 'next/navigation';
import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { isOwnBookmark, missionApiUrl, missionBookmarkPrivacy, missionUrl, missionWeekDates, type OwnBookmark, type SpaceMissionOverview } from '@/components/spaces/mission-api';
import { spaceJson, SpaceHttpError, type SpacePage } from '@/components/spaces/space-api';
import { useSpaceListGeneration } from '@/hooks/useSpaceAccess';
import { MissionBookmarkButton } from '@/components/spaces/MissionBookmarkButton';
import { useMissionFocusReturn } from '@/components/spaces/useMissionFocusReturn';
import { MissionQuestLine } from '@/components/spaces/MissionQuestLine';
import { isMissionQuestCandidate, missionQuestAccessChanged, projectMissionQuest, type MissionQuestCandidate, type MissionQuestSnapshot } from '@/components/spaces/mission-quest-projection';

export default function MissionOverviewPage() {
  return <Suspense fallback={<SpaceShell><PageState kind="loading" title="Space-Missionen werden geladen" /></SpaceShell>}><MissionOverviewSession /></Suspense>;
}

function MissionOverviewSession() {
  const params = useSearchParams();
  const view = params.get('view') === 'saved' ? 'saved' : 'all';
  const { data, status } = useSession();
  useInvitationAccount(status === 'authenticated' ? data?.user?.id ?? null : status === 'unauthenticated' ? null : undefined);
  if (status === 'loading') return <SpaceShell><h1 className="sr-only">Space-Missionen</h1><PageState kind="loading" title="Space-Missionen werden geladen" /></SpaceShell>;
  if (status !== 'authenticated' || !data?.user?.id) return <SpaceShell><h1 className="sr-only">Space-Missionen</h1><PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um Missionen deiner privaten Spaces zu sehen." action={<Button asChild variant="outline"><Link href="/login?callbackUrl=%2Fcommunity%2Fmissions">Zur Anmeldung</Link></Button>} /></SpaceShell>;
  // Account and role transitions discard every previous response and visible row.
  return <MissionOverview key={JSON.stringify([data.user.id, data.user.role ?? '', view])} view={view} viewerId={data.user.id} role={data.user.role ?? undefined} />;
}

function MissionOverview({ view, viewerId, role }: { view: 'all' | 'saved'; viewerId: string; role?: string }) {
  const [items, setItems] = useState<SpaceMissionOverview[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [signInRequired, setSignInRequired] = useState(false);
  const [quest, setQuest] = useState<MissionQuestSnapshot | null>(null);
  const [bookmarkNotice, setBookmarkNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const bookmarkPrivacyId = useId();
  const actionRef = useRef(false);
  const bookmarkButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusOwnerRef = useRef<string | 'results' | null>(null);
  const removalFocusFallbackRef = useRef(false);
  const { capture: captureFocus, restore: restoreFocus } = useMissionFocusReturn();
  const questTitleLinkRef = useRef<HTMLAnchorElement>(null);
  const questActionRef = useRef<HTMLAnchorElement>(null);
  const questFocusOwnerRef = useRef<{ snapshot: MissionQuestSnapshot; isCurrent: () => boolean } | null>(null);
  const depthRef = useRef(1);
  const questSuppressedRef = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const beginRead = useSpaceListGeneration();

  const load = useCallback(async function loadOverview(depth: number, more = false, notice: { text: string; failed: boolean } | null = null, suppressQuest = false): Promise<void> {
    questFocusOwnerRef.current = null;
    setQuest(null);
    const read = beginRead();
    // Never keep a cached prefix visible while checking current membership.
    if (!notice || notice.failed) removalFocusFallbackRef.current = false;
    setItems([]); setCursor(null); setError(''); setBookmarkNotice(notice); setPendingId(null); actionRef.current = false; setLoading(true); setLoadingMore(more);
    try {
      const fresh = new Map<string, SpaceMissionOverview>();
      let nextCursor: string | null = null;
      let pagesRead = 0;
      let candidate: MissionQuestCandidate | null = null;
      do {
        const base = view === 'saved' ? '/api/space-missions?view=saved' : '/api/space-missions';
        const path: string = nextCursor ? `${base}${view === 'saved' ? '&' : '?'}cursor=${encodeURIComponent(nextCursor)}` : base;
        const page: SpacePage<SpaceMissionOverview> = await spaceJson(path, { signal: read.signal });
        if (!read.isCurrent()) return;
        if (!Array.isArray(page.items) || page.items.some(item => !isOwnBookmark(item.ownBookmark))) throw new Error('Invalid bookmark state');
        // Only page one chooses a candidate. Later pages never fill a gap or
        // replace it, even when the first candidate has no usable detail.
        if (pagesRead === 0 && role === 'USER' && !suppressQuest && !questSuppressedRef.current) {
          const first = page.items.find(item => item.participationActive === true);
          if (first) candidate = { id: first.id, spaceId: first.space.id };
        }
        page.items.forEach(item => fresh.set(item.id, item));
        nextCursor = page.nextCursor;
        pagesRead += 1;
      } while (nextCursor && pagesRead < depth);
      if (!read.isCurrent()) return;
      // Load-more replaces the reauthorized prefix plus its new page, never appends
      // previously cached rows. Each page is a server authorization snapshot.
      depthRef.current = pagesRead;
      setSignInRequired(false);
      setItems(Array.from(fresh.values())); setCursor(nextCursor);
      setLoading(false); setLoadingMore(false);
      if (candidate) {
        // The keyed viewer/role/view and this read generation own the exact
        // first-page identity. This is its only detail GET; retry uses load().
        const owner = candidate;
        setQuest({ candidate: owner, status: 'loading' });
        if (!isMissionQuestCandidate(owner)) { setQuest({ candidate: owner, status: 'unknown' }); return; }
        try {
          const detail = await spaceJson<unknown>(missionApiUrl(owner.spaceId, owner.id), { signal: read.signal });
          if (!read.isCurrent()) return;
          if (missionQuestAccessChanged(detail, owner)) {
            // Drop stale discovery as well as progress. This one reauthorization
            // cannot choose a replacement quest or issue another detail GET.
            questSuppressedRef.current = true;
            await loadOverview(depth, false, null, true);
            return;
          }
          const progress = projectMissionQuest(detail, owner, viewerId);
          const nextQuest: MissionQuestSnapshot = progress ? { candidate: owner, status: 'ready', progress } : { candidate: owner, status: 'unknown' };
          questFocusOwnerRef.current = null;
          // Replacing a focused title link with the single quest action must
          // preserve that exact focus owner, without autofocus for other rows.
          if (progress && questTitleLinkRef.current && document.activeElement === questTitleLinkRef.current) {
            captureFocus(questTitleLinkRef.current);
            questFocusOwnerRef.current = { snapshot: nextQuest, isCurrent: read.isCurrent };
          }
          setQuest(nextQuest);
        } catch (caught) {
          if (!read.isCurrent()) return;
          questFocusOwnerRef.current = null;
          if (caught instanceof SpaceHttpError && caught.status === 401) {
            questSuppressedRef.current = true;
            setQuest(null); setItems([]); setCursor(null); depthRef.current = 1;
            setSignInRequired(true); setError('Deine Anmeldung ist nicht mehr gültig. Melde dich erneut an.');
          } else if (caught instanceof SpaceHttpError && (caught.status === 403 || caught.status === 404)) {
            questSuppressedRef.current = true;
            await loadOverview(depth, false, null, true);
          } else {
            // Unknown data never triggers a fallback candidate or detail retry.
            setQuest({ candidate: owner, status: 'unknown' });
          }
        }
      }
    } catch (caught) {
      if (!read.isCurrent()) return;
      questFocusOwnerRef.current = null;
      removalFocusFallbackRef.current = false;
      setItems([]); setCursor(null); setQuest(null); depthRef.current = 1;
      if (caught instanceof SpaceHttpError && caught.status === 401) setSignInRequired(true);
      setError(caught instanceof SpaceHttpError && caught.status === 401
        ? 'Deine Anmeldung ist nicht mehr gültig. Melde dich erneut an.'
        : 'Die Missionen konnten nicht geprüft werden. Versuche es erneut.');
    } finally {
      if (read.isCurrent()) { setLoading(false); setLoadingMore(false); }
    }
  }, [beginRead, view, role, viewerId, captureFocus]);

  function refreshOverview() {
    // Only an explicit overview refresh retries a quest after known access loss.
    // Focus, visibility, load-more and bookmark revalidation keep it suppressed.
    questSuppressedRef.current = false;
    void load(depthRef.current);
  }

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
    if (!loading && focusOwnerRef.current) {
      const owner = focusOwnerRef.current;
      focusOwnerRef.current = null;
      const replacement = owner === 'results' ? resultRef.current : bookmarkButtons.current.get(owner) ?? (removalFocusFallbackRef.current ? resultRef.current : null);
      restoreFocus(replacement, replacement !== resultRef.current);
      removalFocusFallbackRef.current = false;
    }
  }, [loading, items, restoreFocus]);
  useEffect(() => {
    const owner = questFocusOwnerRef.current;
    // A queued effect for the loading snapshot cannot consume the ready handoff.
    if (!owner || quest !== owner.snapshot) return;
    questFocusOwnerRef.current = null;
    if (owner.isCurrent() && quest?.status === 'ready') restoreFocus(questActionRef.current);
  }, [quest, restoreFocus]);

  async function toggleBookmark(item: SpaceMissionOverview) {
    if (actionRef.current || loading) return;
    actionRef.current = true;
    // A bookmark write starts a new authorization generation before its PUT.
    questFocusOwnerRef.current = null;
    setQuest(null);
    const operation = beginRead();
    captureFocus(bookmarkButtons.current.get(item.id) ?? null);
    focusOwnerRef.current = item.id; removalFocusFallbackRef.current = false;
    setPendingId(item.id); setBookmarkNotice(null);
    let notice = { text: item.ownBookmark.saved ? 'Merker entfernt.' : 'Für später gemerkt.', failed: false };
    try {
      const state = await spaceJson<OwnBookmark>(`${missionApiUrl(item.space.id, item.id)}/bookmark`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: operation.signal,
        body: JSON.stringify({ saved: !item.ownBookmark.saved, expectedRevision: item.ownBookmark.revision, accessEpoch: item.ownBookmark.accessEpoch }),
      });
      if (!isOwnBookmark(state)) throw new Error('Invalid bookmark state');
    } catch (caught) {
      notice = { text: caught instanceof SpaceHttpError && caught.status === 409
        ? 'Der Merker wurde inzwischen geändert. Prüfe den aktuellen Stand und wähle erneut.'
        : caught instanceof SpaceHttpError && [401, 403, 404].includes(caught.status)
          ? 'Diese Mission ist nicht mehr verfügbar.'
          : 'Der Merker konnte nicht gespeichert werden. Prüfe den aktuellen Stand und versuche es erneut.', failed: true };
    }
    // A newer focus/read, filter or account owns the UI even if abort was ignored.
    if (!operation.isCurrent()) return;
    removalFocusFallbackRef.current = !notice.failed && view === 'saved' && item.ownBookmark.saved;
    await load(depthRef.current, false, notice);
  }

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
      <div className={styles.utility}><Button type="button" variant="ghost" size="icon" aria-label="Übersicht aktualisieren" title="Übersicht aktualisieren" onClick={refreshOverview}><RefreshCw size={18} aria-hidden="true" /></Button><FriendlyMotionToggle /></div>
    </div>
    {!signInRequired && <MissionInvitationInbox viewerId={viewerId} role={role} />}
    <nav aria-label="Missionen filtern" className="mt-4 flex flex-wrap gap-2">
      <Button asChild size="sm" variant={view === 'all' ? 'default' : 'outline'}><Link prefetch={false} href="/community/missions" aria-current={view === 'all' ? 'page' : undefined}>Alle</Link></Button>
      <Button asChild size="sm" variant={view === 'saved' ? 'default' : 'outline'}><Link prefetch={false} href="/community/missions?view=saved" aria-current={view === 'saved' ? 'page' : undefined}>Gemerkte</Link></Button>
    </nav>
    <p id={bookmarkPrivacyId} className="mt-3 max-w-[65ch] text-xs leading-relaxed text-muted-foreground">{missionBookmarkPrivacy}</p>
    {bookmarkNotice && <p role={bookmarkNotice.failed ? 'alert' : 'status'} className={`mt-3 text-sm ${bookmarkNotice.failed ? 'text-destructive' : 'text-muted-foreground'}`}>{bookmarkNotice.text}</p>}
    <div className="mt-4" aria-busy={loading}>
      {loading ? <PageState kind="loading" title="Missionen werden geprüft" description="Deine aktuellen Space-Mitgliedschaften werden erneut berücksichtigt." />
        : error ? <PageState kind="error" title="Missionen nicht verfügbar" description={error} action={signInRequired ? <Button asChild variant="outline"><Link prefetch={false} href="/login?callbackUrl=%2Fcommunity%2Fmissions">Zur Anmeldung</Link></Button> : <Button type="button" variant="outline" onClick={refreshOverview}>Erneut versuchen</Button>} />
          : items.length === 0 ? <PageState title={view === 'saved' ? 'Keine gemerkten Missionen' : 'Keine offenen Missionen'} description={view === 'saved' ? 'Merke dir eine offene Mission unter „Alle“, um sie hier wiederzufinden.' : 'In deinen privaten Spaces sind gerade keine offenen Missionen verfügbar.'} action={<Button asChild variant="outline"><Link href="/community/spaces">Zu den Spaces</Link></Button>} />
            : <ul className={styles.list}>{items.map(item => {
              const rowQuest = quest?.candidate.id === item.id && quest.candidate.spaceId === item.space.id ? quest : null;
              return <li key={item.id} className={styles.listItem}>
              <span className={styles.listArt} aria-hidden="true"><Lightbulb size={22} /></span>
              <div className={styles.listContent}>
                <p className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.space.name}</p>
                <h2 className="min-w-0 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{rowQuest?.status === 'ready' ? item.title : <Link ref={rowQuest ? questTitleLinkRef : undefined} prefetch={false} href={missionUrl(item.space.id, item.id)} className={styles.missionLink}>{item.title}</Link>}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <MissionBookmarkButton ref={node => { if (node) bookmarkButtons.current.set(item.id, node); else bookmarkButtons.current.delete(item.id); }} title={item.title} saved={item.ownBookmark.saved} pending={pendingId === item.id} disabled={Boolean(pendingId)} describedBy={bookmarkPrivacyId} onClick={() => void toggleBookmark(item)} />
                  {item.participationActive && <p className={styles.pill}>Du nimmst teil</p>}
                </div>
                <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed"><CalendarDays size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{!item.week ? 'Ohne feste Lernwoche · In deinem Tempo' : item.windowState === 'past' ? 'Lernwoche vorbei · Mission bleibt offen' : 'Diese Lernwoche · Ohne verpflichtende Frist'}</span></p>
                {item.week && <p className="mt-1 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{missionWeekDates(item.week)}</p>}
                {rowQuest && <MissionQuestLine snapshot={rowQuest} title={item.title} actionRef={questActionRef} />}
              </div><ArrowUpRight size={20} className={styles.arrow} aria-hidden="true" />
            </li>; })}</ul>}
      <p ref={resultRef} tabIndex={-1} role="status" className="mt-4 rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{loading ? 'Aktueller Stand wird geladen…' : error ? 'Keine Missionsdaten angezeigt.' : `${items.length} ${items.length === 1 ? 'Mission' : 'Missionen'} ${cursor ? 'bisher geladen' : 'geladen'}`}</p>
      {(cursor || loadingMore) && <Button type="button" variant="outline" className="mt-4" disabled={loading} onClick={event => { captureFocus(event.currentTarget); focusOwnerRef.current = 'results'; void load(depthRef.current + 1, true); }}>{loadingMore ? 'Wird geprüft…' : 'Weitere Missionen laden'}</Button>}
    </div>
  </SpaceShell>;
}
