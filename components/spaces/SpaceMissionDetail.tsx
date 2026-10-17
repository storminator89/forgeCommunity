'use client';

/* Friendly mission workbench. Motion follows confirmed server changes only. */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Check, Lightbulb, LockKeyhole, MessageCircle, Users } from 'lucide-react';
import { FriendlyMotionToggle, useFriendlyMotion } from '@/components/community/FriendlyMotion';
import { MissionGoalTrail, MissionIllustration } from './MissionVisuals';
import styles from './friendly-missions.module.css';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PageState } from '@/components/page-state';
import { ReportControl } from '@/components/community/ReportControl';
import { useSpaceAccess, useSpaceListGeneration } from '@/hooks/useSpaceAccess';
import { SpaceShell } from './SpaceShell';
import { SpaceAuthorLine } from './SpaceAuthorLine';
import { SpaceMissionConfirm } from './SpaceMissionConfirm';
import { SpaceMissionModeration } from './SpaceMissionModeration';
import { MissionInvitationComposer } from './MissionInvitationComposer';
import { MissionInvitationDecision } from './MissionInvitationDecision';
import { missionNextStep } from './mission-invitation-ui';
import invitationStyles from './mission-invitations.module.css';
import { MissionBookmarkButton } from './MissionBookmarkButton';
import { useMissionFocusReturn } from './useMissionFocusReturn';
import { apiSpaceUrl, isSpaceAbort, spaceUrl, SpaceHttpError, type SpaceSummary } from './space-api';
import { isOwnBookmark, missionAccessDenied, missionApiUrl, missionBookmarkPrivacy, missionPrivacy, missionWeekDates, missionWindowLabel, type MissionContribution, type OwnBookmark, type SpaceMission } from './mission-api';

type Snapshot = { space: SpaceSummary; mission: SpaceMission };

export function SpaceMissionDetail({ spaceId, missionId, viewerId, invitationId }: { spaceId: string; missionId: string; viewerId: string; invitationId?: string }) {
  const base = missionApiUrl(spaceId, missionId);
  const { enabled: motionEnabled } = useFriendlyMotion();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bookmarkPending, setBookmarkPending] = useState(false);
  const [bookmarkNotice, setBookmarkNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const bookmarkPrivacyId = useId();
  const bookmarkButtonRef = useRef<HTMLButtonElement>(null);
  const bookmarkActionRef = useRef(false);
  const bookmarkComposerRef = useRef(false);
  const bookmarkFocusRef = useRef(false);
  const participationTargetRef = useRef<HTMLHeadingElement>(null);
  const contributionTargetRef = useRef<HTMLHeadingElement>(null);
  const { capture: captureBookmarkFocus, restore: restoreBookmarkFocus } = useMissionFocusReturn();
  const [kind, setKind] = useState<MissionContribution['kind']>('INSIGHT');
  const [content, setContent] = useState('');
  const [targetId, setTargetId] = useState('');
  const contentId = useId(); const targetLabelId = useId(); const privacyId = useId(); const feedbackId = useId();
  const beginRead = useSpaceListGeneration();
  const actionRef = useRef(false);
  const aliveRef = useRef(true);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const focusAfterReadRef = useRef(false);
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);
  const participationRef = useRef<{ epoch: number; active: boolean } | null>(null);
  const { request: accessRequest, invalidate, accessLost } = useSpaceAccess(() => {
    setSnapshot(null); setContent(''); setTargetId(''); setKind('INSIGHT');
    requestIdRef.current = null; participationRef.current = null; bookmarkComposerRef.current = false;
  });
  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    try { return await accessRequest<T>(path, init); }
    catch (caught) { if (missionAccessDenied(caught)) invalidate(); throw caught; }
  }, [accessRequest, invalidate]);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const load = useCallback(async (preserveReplay = false, preserveComposer = false) => {
    const read = beginRead();
    setSnapshot(null); setLoading(true); setError('');
    if (bookmarkActionRef.current) { bookmarkActionRef.current = false; actionRef.current = false; setBookmarkPending(false); }
    // Consent and targets may have changed while this tab was away.
    if (!preserveComposer) { setContent(''); setTargetId(''); }
    if (!preserveReplay) requestIdRef.current = null;
    try {
      const [space, mission] = await Promise.all([
        request<SpaceSummary>(apiSpaceUrl(spaceId), { signal: read.signal }),
        request<SpaceMission>(base, { signal: read.signal }),
      ]);
      if (!read.isCurrent()) return;
      if (space.visibility !== 'PRIVATE' || mission.spaceId !== spaceId || mission.id !== missionId) { invalidate(); return; }
      if (mission.ownBookmark !== null && !isOwnBookmark(mission.ownBookmark)) throw new Error('Invalid bookmark state');
      // Composer choices belong to this consent epoch, including changes in another tab.
      const participation = participationRef.current;
      if (!participation || participation.epoch !== mission.participation.epoch || participation.active !== mission.participation.active) {
        setKind('INSIGHT'); requestIdRef.current = null;
        setContent(''); setTargetId('');
      } else if (preserveComposer) {
        if (mission.closedAt || !mission.participation.active) { setContent(''); setTargetId(''); }
        else setTargetId(current => mission.contributions.some(item => item.id === current && item.kind === 'INSIGHT' && item.author.id !== viewerId) ? current : '');
      }
      participationRef.current = { epoch: mission.participation.epoch, active: mission.participation.active };
      bookmarkComposerRef.current = false;
      setSnapshot({ space, mission });
      return read;
    } catch (caught) {
      if (read.isCurrent()) {
        bookmarkComposerRef.current = false;
        setContent(''); setTargetId('');
        if (!isSpaceAbort(caught) && !missionAccessDenied(caught)) setError('Mission konnte nicht geladen werden.');
      }
      return false;
    } finally { if (read.isCurrent()) setLoading(false); }
  }, [base, spaceId, missionId, viewerId, beginRead, request, invalidate]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    const recheck = () => { if ((!actionRef.current || bookmarkActionRef.current) && document.visibilityState !== 'hidden') { setFeedback(''); setActionError(''); setBookmarkNotice(null); void load(false, bookmarkActionRef.current || bookmarkComposerRef.current); } };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => { window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [load]);
  useEffect(() => {
    if (focusAfterReadRef.current && !loading && !busy && snapshot) {
      focusAfterReadRef.current = false; feedbackRef.current?.focus();
    }
  }, [loading, busy, snapshot, feedback]);

  useEffect(() => {
    if (bookmarkFocusRef.current && !loading && !bookmarkPending) {
      bookmarkFocusRef.current = false;
      restoreBookmarkFocus(bookmarkButtonRef.current);
    }
  }, [loading, bookmarkPending, snapshot, restoreBookmarkFocus]);

  async function toggleBookmark() {
    const mission = snapshot?.mission;
    if (!mission?.ownBookmark || mission.closedAt || actionRef.current || accessLost) return;
    actionRef.current = true; bookmarkActionRef.current = true; bookmarkComposerRef.current = true;
    const operation = beginRead();
    captureBookmarkFocus(bookmarkButtonRef.current);
    bookmarkFocusRef.current = true;
    setBookmarkPending(true); setBookmarkNotice(null); setFeedback(''); setActionError(''); focusAfterReadRef.current = false;
    let notice = { text: mission.ownBookmark.saved ? 'Merker entfernt.' : 'Für später gemerkt.', failed: false };
    try {
      const state = await request<OwnBookmark>(`${base}/bookmark`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: operation.signal,
        body: JSON.stringify({ saved: !mission.ownBookmark.saved, expectedRevision: mission.ownBookmark.revision, accessEpoch: mission.ownBookmark.accessEpoch }),
      });
      if (!isOwnBookmark(state)) throw new Error('Invalid bookmark state');
    } catch (caught) {
      if (isSpaceAbort(caught) || missionAccessDenied(caught)) return;
      notice = { text: caught instanceof SpaceHttpError && caught.status === 409
        ? 'Der Merker wurde inzwischen geändert. Prüfe den aktuellen Stand und wähle erneut.'
        : 'Der Merker konnte nicht gespeichert werden. Prüfe den aktuellen Stand und versuche es erneut.', failed: true };
    }
    if (!operation.isCurrent() || !aliveRef.current) return;
    // A bookmark never changes consent or consumes the independently written draft.
    const refreshed = await load(true, true);
    if (refreshed && refreshed.isCurrent() && aliveRef.current) setBookmarkNotice(notice);
  }

  function goToTask(target: HTMLHeadingElement | null) {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  async function mutate(path: string, method: string, body: object, success: string) {
    if (actionRef.current || accessLost) return;
    actionRef.current = true; setBusy(true); setFeedback(''); setActionError(''); setError('');
    beginRead(); setSnapshot(null); setLoading(true); setContent(''); setTargetId('');
    let failure = '';
    try { await request<SpaceMission>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (caught) {
      if (isSpaceAbort(caught) || missionAccessDenied(caught)) return;
      failure = caught instanceof Error ? caught.message : 'Änderung konnte nicht gespeichert werden.';
    } finally {
      if (aliveRef.current) {
        // Never apply a mutation's old projection over a newer consent snapshot.
        await load(Boolean(failure));
        if (aliveRef.current) { setFeedback(failure ? '' : success); setActionError(failure); focusAfterReadRef.current = true; setBusy(false); }
      }
      actionRef.current = false;
    }
  }

  function contribute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mission = snapshot?.mission;
    if (!mission?.participation.active || mission.closedAt || actionRef.current) return;
    const input = { kind, content: content.trim(), epoch: mission.participation.epoch, targetContributionId: kind === 'BUILD_ON' ? targetId : null };
    const payload = JSON.stringify(input);
    if (!requestIdRef.current || requestIdRef.current.payload !== payload) requestIdRef.current = { payload, id: crypto.randomUUID() };
    void mutate(`${base}/contributions`, 'POST', { ...input, requestId: requestIdRef.current.id }, 'Dein Beitrag ist im Space sichtbar.');
  }

  if (accessLost) return <SpaceShell><h1 className="sr-only">Mission nicht verfügbar</h1><PageState kind="error" title="Mission nicht verfügbar" description="Du hast keinen Zugriff auf diese Mission." action={<Button asChild variant="outline"><Link href="/community/spaces">Zur Übersicht</Link></Button>} /></SpaceShell>;
  if (loading) return <SpaceShell><h1 className="sr-only">Mission</h1><PageState kind="loading" title={busy ? 'Mission wird aktualisiert' : 'Mission wird geladen'} /></SpaceShell>;
  if (!snapshot) return <SpaceShell><h1 className="sr-only">Mission nicht verfügbar</h1><PageState kind="error" title="Mission nicht verfügbar" description={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Erneut versuchen</Button>} /></SpaceShell>;

  const { space, mission } = snapshot;
  const ownInsight = mission.ownContributions.some(item => item.kind === 'INSIGHT' && !item.hidden);
  const ownBuildOn = mission.ownContributions.some(item => item.kind === 'BUILD_ON' && !item.hidden);
  const targets = mission.contributions.filter(item => item.kind === 'INSIGHT' && item.author.id !== viewerId);
  const availableKind = kind === 'INSIGHT' ? !ownInsight : !ownBuildOn && targets.length > 0;
  const mayPost = mission.participation.active && !mission.closedAt && (!ownInsight || !ownBuildOn);
  const nextStep = mission.myNextAction ? missionNextStep(mission.myNextAction) : null;
  const hasContributionTask = mayPost && (!ownInsight || (!ownBuildOn && targets.length > 0));

  return <SpaceShell>
    <nav aria-label="Pfad" className="mb-6 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"><Link prefetch={false} href="/community/spaces" className="rounded-sm py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Spaces</Link><span aria-hidden="true">/</span><Link prefetch={false} href={spaceUrl(spaceId)} className="min-w-0 max-w-full truncate rounded-sm py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{space.name}</Link><span className="ml-auto"><FriendlyMotionToggle /></span></nav>
    <div data-confirmed={Boolean(feedback && !actionError)} className={`max-w-4xl ${motionEnabled ? styles.motion : ''}`}>
    <header className={`${styles.surface} ${styles.hero}`}>
      <div className={styles.heroCopy}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={styles.eyebrow}><LockKeyhole size={14} aria-hidden="true" /> Privater Space <span aria-hidden="true">·</span> {mission.closedAt ? 'Geschlossen' : 'Freiwillige Mission'}</p>
        </div>
        <h1 className="mt-3 min-w-0 text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{mission.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {hasContributionTask ? <Button type="button" variant="outline" size="sm" onClick={() => goToTask(contributionTargetRef.current)}>Zum Beitrag</Button>
            : mission.canJoin ? <Button type="button" variant="outline" size="sm" onClick={() => goToTask(participationTargetRef.current)}>Zur Teilnahme</Button> : null}
          {mission.ownBookmark && !mission.closedAt && <MissionBookmarkButton ref={bookmarkButtonRef} title={mission.title} saved={mission.ownBookmark.saved} pending={bookmarkPending} disabled={busy} describedBy={bookmarkPrivacyId} onClick={() => void toggleBookmark()} />}
        </div>
        {mission.ownBookmark && !mission.closedAt && <p id={bookmarkPrivacyId} className="mt-2 text-xs leading-relaxed text-muted-foreground">{missionBookmarkPrivacy}</p>}
        {bookmarkNotice && <p role={bookmarkNotice.failed ? 'alert' : 'status'} className={`mt-2 text-sm ${bookmarkNotice.failed ? 'text-destructive' : 'text-muted-foreground'}`}>{bookmarkNotice.text}</p>}
        <p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed">{mission.prompt}</p>
      </div>
      <MissionIllustration />
    </header>
    {mission.week && <div className={`${styles.week} mt-3`}>
      <CalendarDays size={18} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{missionWindowLabel(mission)}</p>
        <p className="text-muted-foreground [overflow-wrap:anywhere]">{missionWeekDates(mission.week)}</p>
        {mission.windowState === 'past' && <p className="mt-1 text-muted-foreground">Spätere Beiträge zählen weiter; sie belegen keine Teilnahme innerhalb der Lernwoche.</p>}
        <details className={styles.disclosure}><summary>Zum Zeitrahmen</summary><p>Der Zeitraum endet am folgenden Montag um 00:00 Uhr in dieser Zeitzone. Die Lernwoche ist ein freiwilliger Zeitrahmen. {mission.closedAt ? 'Die Mission ist geschlossen.' : 'Die Mission bleibt danach offen, bis ein Admin sie schließt.'}</p></details>
      </div>
    </div>}

    {invitationId && <MissionInvitationDecision viewerId={viewerId} spaceId={spaceId} missionId={missionId} invitationId={invitationId} onMission={updated => { if (updated.id === missionId && updated.spaceId === spaceId) { participationRef.current = updated.participation; setSnapshot({ space, mission: updated }); setContent(''); setTargetId(''); setKind('INSIGHT'); } }} />}
    {nextStep && <section className={invitationStyles.region} data-invitation-region="next-action" aria-labelledby="mission-next-action">
      <h2 id="mission-next-action" tabIndex={-1}>Dein nächster Schritt</h2>
      {nextStep.href ? <a className={invitationStyles.link} href={nextStep.href}>{nextStep.text}</a> : <p>{nextStep.text}</p>}
    </section>}
    <div className="mt-4">
      <p ref={feedbackRef} id={feedbackId} tabIndex={-1} role={actionError ? 'alert' : 'status'} data-feedback={Boolean(feedback && !actionError)} className={`${styles.confirmed} text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${actionError ? 'text-destructive' : 'text-muted-foreground'}`}>{actionError || feedback}</p>
      <section aria-labelledby="mission-goal" className={`${styles.surface} ${styles.goalPanel} mt-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mission-goal" className="text-lg font-semibold">Das gemeinsame Ziel</h2><span className={styles.pill}><Users size={14} aria-hidden="true" /> Gemeinsam</span></div>
        <MissionGoalTrail progress={mission.progress} />
        <p className={styles.goalStatus} role="status">{mission.progress.complete ? <Check size={18} aria-hidden="true" /> : <MessageCircle size={18} aria-hidden="true" />}{mission.progress.complete ? 'Gemeinsam weitergedacht. Das aktuelle Ziel ist erreicht.' : 'Das gemeinsame Ziel ist noch offen.'}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Kein Wissensnachweis. Kein Einfluss auf deinen Kursfortschritt.</p>
        <details className={`${styles.disclosure} mt-1`}><summary>So funktioniert das Ziel</summary>
          <p>Zwei verschiedene Personen teilen je eine Erkenntnis. Eine Person baut auf der Erkenntnis einer anderen auf.</p>
          <p className="mt-2">Lies eine Erkenntnis im Abschnitt „Erkenntnisse und Gedanken“. Lesen wird nicht erfasst oder abgehakt.</p>
          <p className="mt-2">Gezählt werden nur aktuell sichtbare Beiträge aktiver Teilnehmender. Das kann sich ändern. Diese Mission bewertet kein Wissen und verändert deinen Kursfortschritt nicht. Sie belegt keine Qualifikation.</p>
        </details>
      </section>

      <section aria-labelledby="mission-participation" className="border-b py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="mission-participation" className="text-lg font-semibold">Wer dabei ist</h2><p className="text-sm text-muted-foreground">{mission.participants.length}/{mission.participantLimit} Personen</p></div>
        {mission.participants.length ? <ul className={styles.participants}>{mission.participants.map(person => <li key={person.id}><span aria-hidden="true" className={styles.initial}>{(person.name || 'M').slice(0, 1)}</span><span className="min-w-0">{person.name || 'Mitglied'}{person.id === viewerId ? ' (du)' : ''}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Bisher nimmt niemand teil.</p>}
        <h3 ref={participationTargetRef} tabIndex={-1} className={`${styles.taskTarget} mt-4 text-base font-semibold`}>Deine Teilnahme</h3>
        <p className="mt-3 text-sm text-muted-foreground">Freiwillig dabei. Dein Name und deine Beiträge sind im privaten Space sichtbar.</p>
        <details open={mission.canJoin} className={`${styles.disclosure} mt-1`}><summary>Teilnahme und Privatsphäre</summary><p id={privacyId}>{missionPrivacy}</p></details>
        <div className="mt-3 flex flex-wrap gap-2">
          {mission.participation.active ? <SpaceMissionConfirm label="Teilnahme beenden" description="Deine Missionsbeiträge werden für Mitglieder verborgen und zählen nicht mehr zum Ziel. Erneutes Beitreten macht alte Beiträge nicht wieder sichtbar. Admins können sie zur Moderation aufbewahren." onConfirm={() => void mutate(`${base}/participation`, 'DELETE', { epoch: mission.participation.epoch }, 'Deine Teilnahme ist beendet. Deine Beiträge werden nicht mehr mitgezählt.')} /> : mission.canJoin && <Button type="button" aria-describedby={privacyId} onClick={() => void mutate(`${base}/participation`, 'POST', { expectedEpoch: mission.participation.epoch }, 'Du nimmst jetzt freiwillig teil.')}>Freiwillig teilnehmen</Button>}
          {mission.canManage && !mission.closedAt && <SpaceMissionConfirm label="Mission schließen" description="Danach sind keine neuen Teilnahmen oder Beiträge möglich. Sichtbare Beiträge bleiben im privaten Space. Teilnehmende können weiter austreten und eigene Beiträge zurückziehen." onConfirm={() => void mutate(base, 'PATCH', { closed: true }, 'Die Mission ist geschlossen.')} />}
        </div>
        {mission.closedAt ? <p className="mt-3 text-sm text-muted-foreground">Die Mission ist geschlossen. Du kannst deine Teilnahme weiterhin beenden und eigene Beiträge zurückziehen.</p> : !mission.participation.active && !mission.canJoin && <p className="mt-3 text-sm text-muted-foreground">{mission.participants.length >= mission.participantLimit ? 'Alle fünf Plätze sind belegt. Du kannst die Beiträge trotzdem lesen.' : 'Eine Teilnahme ist aktuell nicht möglich. Du kannst die Beiträge trotzdem lesen.'}</p>}
      </section>

      <section aria-labelledby="mission-contributions" className="py-6">
        <h2 id="mission-contributions" className="text-lg font-semibold">Erkenntnisse und Gedanken</h2>
        {mission.contributions.length ? <ul className={`${styles.list} mt-4`}>{mission.contributions.map(item => {
          const target = mission.contributions.find(other => other.id === item.targetContributionId);
          return <li id={`mission-contribution-${item.id}`} key={item.id} data-kind={item.kind} className={styles.contribution}>
            <p className={`${styles.pill} mb-3`}>{item.kind === 'INSIGHT' ? <Lightbulb size={14} aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}{item.kind === 'INSIGHT' ? 'Erkenntnis' : 'Weitergedacht'}</p>
            <SpaceAuthorLine author={item.author} date={item.createdAt} />
            {target && <p className="mt-2 text-sm text-muted-foreground">Baut auf <a href={`#mission-contribution-${target.id}`} className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{target.author.name || 'Mitglied'}s Erkenntnis</a> auf.</p>}
            <p className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed">{item.content}</p>
            <div className="mt-3 flex flex-wrap items-start gap-2">
              {item.canWithdraw && <SpaceMissionConfirm label="Beitrag zurückziehen" description="Dieser Beitrag wird für Mitglieder verborgen und nicht mehr mitgezählt. Darauf aufbauende Beiträge werden ebenfalls nicht mehr angezeigt oder gezählt. Admins können den Inhalt zur Moderation aufbewahren." onConfirm={() => void mutate(`${base}/contributions/${encodeURIComponent(item.id)}`, 'DELETE', { epoch: mission.participation.epoch }, 'Dein Beitrag ist zurückgezogen und wird nicht mehr mitgezählt.')} />}
              <ReportControl targetType="SPACE_MISSION_CONTRIBUTION" targetId={item.id} request={request} />
              {mission.canManage && <Button type="button" variant="outline" onClick={() => void mutate(`${base}/contributions/${encodeURIComponent(item.id)}/moderation`, 'PATCH', { hidden: true }, 'Der Beitrag ist ausgeblendet.')}>Ausblenden</Button>}
            </div>
          </li>;
        })}</ul> : <p className="mt-4 text-sm text-muted-foreground">Noch keine sichtbaren Beiträge. Wer freiwillig teilnimmt, kann eine Erkenntnis teilen.</p>}

        {mission.ownContributions.filter(item => !mission.contributions.some(visible => visible.id === item.id)).map(item => <div id={`mission-own-contribution-${item.id}`} key={item.id} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y py-4">
          <p className="text-sm text-muted-foreground">Dein Beitrag ({item.kind === 'INSIGHT' ? 'Erkenntnis' : 'Weitergedacht'}) ist {item.hidden ? 'ausgeblendet' : 'wegen einer nicht mehr sichtbaren Erkenntnis verborgen'} und zählt nicht zum Ziel.</p>
          {item.canWithdraw && <SpaceMissionConfirm label="Beitrag zurückziehen" description="Der Beitrag bleibt für Mitglieder verborgen. Admins können den Inhalt zur Moderation aufbewahren. Er wird auch nach erneuter Teilnahme nicht wieder sichtbar." onConfirm={() => void mutate(`${base}/contributions/${encodeURIComponent(item.id)}`, 'DELETE', { epoch: mission.participation.epoch }, 'Dein verborgener Beitrag ist zurückgezogen.')} />}
        </div>)}

        {mayPost && <form onSubmit={contribute} aria-describedby={privacyId} className={`${styles.surface} ${styles.form} space-y-4`}>
          <h3 id="mission-contributions-composer" ref={contributionTargetRef} tabIndex={-1} className={`${styles.taskTarget} text-base font-semibold`}>Dein Beitrag</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">Im privaten Space sichtbar. In kleinen Gruppen können Änderungen einzelne Personen erkennen lassen.</p>
          <fieldset><legend className="mb-2 text-sm font-medium">Was möchtest du teilen?</legend><div className={styles.kindChoices}><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="mission-kind" checked={kind === 'INSIGHT'} onChange={() => { setKind('INSIGHT'); setContent(''); setTargetId(''); }} disabled={ownInsight} className="h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />Eine Erkenntnis{ownInsight ? ' (geteilt)' : ''}</label><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="mission-kind" checked={kind === 'BUILD_ON'} onChange={() => { setKind('BUILD_ON'); setContent(''); setTargetId(''); }} disabled={ownBuildOn || targets.length === 0} className="h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />Darauf aufbauen{ownBuildOn ? ' (geteilt)' : ''}</label></div></fieldset>
          {!targets.length && !ownBuildOn && <p className="text-sm text-muted-foreground">Aufbauen ist möglich, sobald eine andere teilnehmende Person eine Erkenntnis teilt.</p>}
          {kind === 'BUILD_ON' && <fieldset aria-labelledby={targetLabelId}><legend id={targetLabelId} className="mb-2 text-sm font-medium">Auf welche Erkenntnis?</legend><div className="space-y-2">{targets.map(target => <label key={target.id} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm"><input type="radio" name="mission-target" value={target.id} checked={targetId === target.id} onChange={() => setTargetId(target.id)} required className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" /><span className="min-w-0 whitespace-pre-wrap break-words"><span className="font-medium">{target.author.name || 'Mitglied'}: </span>{target.content}</span></label>)}</div></fieldset>}
          {availableKind && <><div className="space-y-2"><label htmlFor={contentId} className="text-sm font-medium">{kind === 'INSIGHT' ? 'Deine Erkenntnis' : 'Dein weiterführender Gedanke'}</label><Textarea id={contentId} value={content} onChange={event => setContent(event.target.value)} minLength={10} maxLength={2000} required aria-required="true" rows={4} /></div><Button type="submit" disabled={kind === 'BUILD_ON' && !targetId}><ArrowRight size={16} aria-hidden="true" />Im Space teilen</Button></>}
          {!availableKind && <p className="text-sm text-muted-foreground">Wähle die andere Beitragsart, um weiterzumachen.</p>}
        </form>}
      </section>
      <MissionInvitationComposer viewerId={viewerId} spaceId={spaceId} missionId={missionId} participantEpoch={mission.participation.epoch} eligible={space.isMember && space.canWrite !== false && mission.myNextAction !== null && mission.participation.active && !mission.closedAt} />
      {mission.creator && <details className={styles.disclosure}><summary>Mission erstellt von</summary><SpaceAuthorLine author={mission.creator} date={mission.createdAt} /></details>}
      {mission.canManage && <SpaceMissionModeration base={base} request={request} onModerate={(id, hidden) => void mutate(`${base}/contributions/${encodeURIComponent(id)}/moderation`, 'PATCH', { hidden }, hidden ? 'Der Beitrag ist ausgeblendet.' : 'Moderation gespeichert. Nur aktuell gültige Beiträge sind sichtbar.')} />}
    </div>
    </div>
  </SpaceShell>;
}
