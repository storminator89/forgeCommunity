'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Editorial workbench · named teach-back reading column · existing rail and locked design.md tokens */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PageState } from '@/components/page-state';
import { ReportControl } from '@/components/community/ReportControl';
import { useSpaceAccess, useSpaceListGeneration } from '@/hooks/useSpaceAccess';
import { SpaceShell } from './SpaceShell';
import { SpaceAuthorLine } from './SpaceAuthorLine';
import { SpaceMissionConfirm } from './SpaceMissionConfirm';
import { SpaceMissionModeration } from './SpaceMissionModeration';
import { apiSpaceUrl, isSpaceAbort, spaceUrl, type SpaceSummary } from './space-api';
import { missionAccessDenied, missionApiUrl, missionPrivacy, missionWeekDates, missionWindowLabel, type MissionContribution, type SpaceMission } from './mission-api';

type Snapshot = { space: SpaceSummary; mission: SpaceMission };

export function SpaceMissionDetail({ spaceId, missionId, viewerId }: { spaceId: string; missionId: string; viewerId: string }) {
  const base = missionApiUrl(spaceId, missionId);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
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
    requestIdRef.current = null; participationRef.current = null;
  });
  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    try { return await accessRequest<T>(path, init); }
    catch (caught) { if (missionAccessDenied(caught)) invalidate(); throw caught; }
  }, [accessRequest, invalidate]);

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const load = useCallback(async (preserveReplay = false) => {
    const read = beginRead();
    setSnapshot(null); setLoading(true); setError('');
    // Consent and targets may have changed while this tab was away.
    setContent(''); setTargetId('');
    if (!preserveReplay) requestIdRef.current = null;
    try {
      const [space, mission] = await Promise.all([
        request<SpaceSummary>(apiSpaceUrl(spaceId), { signal: read.signal }),
        request<SpaceMission>(base, { signal: read.signal }),
      ]);
      if (!read.isCurrent()) return;
      if (space.visibility !== 'PRIVATE' || mission.spaceId !== spaceId || mission.id !== missionId) { invalidate(); return; }
      // Composer choices belong to this consent epoch, including changes in another tab.
      const participation = participationRef.current;
      if (!participation || participation.epoch !== mission.participation.epoch || participation.active !== mission.participation.active) {
        setKind('INSIGHT');
      }
      participationRef.current = { epoch: mission.participation.epoch, active: mission.participation.active };
      setSnapshot({ space, mission });
    } catch (caught) {
      if (read.isCurrent() && !isSpaceAbort(caught) && !missionAccessDenied(caught)) setError('Mission konnte nicht geladen werden.');
    } finally { if (read.isCurrent()) setLoading(false); }
  }, [base, spaceId, missionId, beginRead, request, invalidate]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    const recheck = () => { if (!actionRef.current && document.visibilityState !== 'hidden') { setFeedback(''); setActionError(''); void load(); } };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => { window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck); };
  }, [load]);
  useEffect(() => {
    if (focusAfterReadRef.current && !loading && !busy && snapshot) {
      focusAfterReadRef.current = false; feedbackRef.current?.focus();
    }
  }, [loading, busy, snapshot, feedback]);

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

  return <SpaceShell>
    <nav aria-label="Pfad" className="mb-6 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"><Link prefetch={false} href="/community/spaces" className="rounded-sm py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Spaces</Link><span aria-hidden="true">/</span><Link prefetch={false} href={spaceUrl(spaceId)} className="min-w-0 max-w-full truncate rounded-sm py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{space.name}</Link></nav>
    <header className="max-w-3xl border-b pb-6">
      <p className="text-sm font-medium text-muted-foreground">Freiwillige Mission · Privater Space · {mission.closedAt ? 'Geschlossen' : 'Offen'}</p>
      <h1 className="mt-2 min-w-0 text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight [overflow-wrap:anywhere]">{mission.title}</h1>
      <p className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed">{mission.prompt}</p>
      {mission.week && <div className="mt-4 space-y-2 text-sm leading-relaxed">
        <p className="font-medium">{missionWindowLabel(mission)}</p>
        <p className="text-muted-foreground [overflow-wrap:anywhere]">{missionWeekDates(mission.week)}</p>
        <p className="text-muted-foreground">Der Zeitraum endet am folgenden Montag um 00:00 Uhr in dieser Zeitzone. {mission.windowState === 'past' ? 'Spätere Beiträge gehören zum aktuellen gemeinsamen Stand dieser Mission; sie belegen keine Teilnahme innerhalb der Lernwoche.' : 'Die Lernwoche ist ein freiwilliger Zeitrahmen. Die Mission bleibt danach offen, bis ein Admin sie schließt.'}</p>
      </div>}
      {mission.creator && <div className="mt-4"><SpaceAuthorLine author={mission.creator} date={mission.createdAt} /></div>}
    </header>

    <div className="mt-6 max-w-3xl">
      <p ref={feedbackRef} id={feedbackId} tabIndex={-1} role={actionError ? 'alert' : 'status'} className={`text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${actionError ? 'text-destructive' : 'text-muted-foreground'}`}>{actionError || feedback}</p>
      <section aria-labelledby="mission-goal" className="mt-4 border-b pb-6">
        <h2 id="mission-goal" className="text-lg font-semibold">Das gemeinsame Ziel</h2>
        <ol className="mt-3 divide-y border-y text-sm leading-relaxed">
          <li className="py-3"><h3 className="font-medium">1. In eigenen Worten erklären</h3><p className="mt-1"><span aria-hidden="true" className="mr-2">{mission.progress.insightAuthors >= 2 ? '●' : '○'}</span>Zwei verschiedene Personen teilen je eine Erkenntnis. <span className="text-muted-foreground">{Math.min(mission.progress.insightAuthors, 2)}/2</span></p></li>
          <li className="py-3"><h3 className="font-medium">2. Eine andere Erklärung lesen</h3><p className="mt-1 text-muted-foreground">Lies eine Erkenntnis im Abschnitt „Erkenntnisse und Gedanken“. Lesen wird nicht erfasst oder abgehakt.</p></li>
          <li className="py-3"><h3 className="font-medium">3. Darauf aufbauen</h3><p className="mt-1"><span aria-hidden="true" className="mr-2">{mission.progress.hasCrossPersonBuildOn ? '●' : '○'}</span>Eine Person baut auf der Erkenntnis einer anderen auf. <span className="text-muted-foreground">{mission.progress.hasCrossPersonBuildOn ? '1/1' : '0/1'}</span></p></li>
        </ol>
        <p className="mt-3 text-sm font-medium" role="status">{mission.progress.complete ? 'Gemeinsam weitergedacht. Das aktuelle Ziel ist erreicht.' : 'Das gemeinsame Ziel ist noch offen.'}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Gezählt werden nur aktuell sichtbare Beiträge aktiver Teilnehmender. Das kann sich ändern. Diese Mission bewertet kein Wissen und verändert deinen Kursfortschritt nicht. Sie belegt keine Qualifikation.</p>
      </section>

      <section aria-labelledby="mission-participation" className="border-b py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="mission-participation" className="text-lg font-semibold">Wer dabei ist</h2><p className="text-sm text-muted-foreground">{mission.participants.length}/{mission.participantLimit} Personen</p></div>
        {mission.participants.length ? <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">{mission.participants.map(person => <li key={person.id} className="min-w-0 break-words">{person.name || 'Mitglied'}{person.id === viewerId ? ' (du)' : ''}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Bisher nimmt niemand teil.</p>}
        <p id={privacyId} className="mt-4 text-sm leading-relaxed text-muted-foreground">{missionPrivacy}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {mission.participation.active ? <SpaceMissionConfirm label="Teilnahme beenden" description="Deine Missionsbeiträge werden für Mitglieder verborgen und zählen nicht mehr zum Ziel. Erneutes Beitreten macht alte Beiträge nicht wieder sichtbar. Admins können sie zur Moderation aufbewahren." onConfirm={() => void mutate(`${base}/participation`, 'DELETE', { epoch: mission.participation.epoch }, 'Deine Teilnahme ist beendet. Deine Beiträge werden nicht mehr mitgezählt.')} /> : mission.canJoin && <Button type="button" aria-describedby={privacyId} onClick={() => void mutate(`${base}/participation`, 'POST', { expectedEpoch: mission.participation.epoch }, 'Du nimmst jetzt freiwillig teil.')}>Freiwillig teilnehmen</Button>}
          {mission.canManage && !mission.closedAt && <SpaceMissionConfirm label="Mission schließen" description="Danach sind keine neuen Teilnahmen oder Beiträge möglich. Sichtbare Beiträge bleiben im privaten Space. Teilnehmende können weiter austreten und eigene Beiträge zurückziehen." onConfirm={() => void mutate(base, 'PATCH', { closed: true }, 'Die Mission ist geschlossen.')} />}
        </div>
        {mission.closedAt ? <p className="mt-3 text-sm text-muted-foreground">Die Mission ist geschlossen. Du kannst deine Teilnahme weiterhin beenden und eigene Beiträge zurückziehen.</p> : !mission.participation.active && !mission.canJoin && <p className="mt-3 text-sm text-muted-foreground">{mission.participants.length >= mission.participantLimit ? 'Alle fünf Plätze sind belegt. Du kannst die Beiträge trotzdem lesen.' : 'Eine Teilnahme ist aktuell nicht möglich. Du kannst die Beiträge trotzdem lesen.'}</p>}
      </section>

      <section aria-labelledby="mission-contributions" className="py-6">
        <h2 id="mission-contributions" className="text-lg font-semibold">Erkenntnisse und Gedanken</h2>
        {mission.contributions.length ? <ul className="mt-4 divide-y border-y">{mission.contributions.map(item => {
          const target = mission.contributions.find(other => other.id === item.targetContributionId);
          return <li id={`mission-contribution-${item.id}`} key={item.id} className="min-w-0 scroll-mt-6 py-5">
            <p className="mb-2 text-sm font-medium">{item.kind === 'INSIGHT' ? 'Erkenntnis' : 'Weitergedacht'}</p>
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

        {mission.ownContributions.filter(item => !mission.contributions.some(visible => visible.id === item.id)).map(item => <div key={item.id} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y py-4">
          <p className="text-sm text-muted-foreground">Dein Beitrag ({item.kind === 'INSIGHT' ? 'Erkenntnis' : 'Weitergedacht'}) ist {item.hidden ? 'ausgeblendet' : 'wegen einer nicht mehr sichtbaren Erkenntnis verborgen'} und zählt nicht zum Ziel.</p>
          {item.canWithdraw && <SpaceMissionConfirm label="Beitrag zurückziehen" description="Der Beitrag bleibt für Mitglieder verborgen. Admins können den Inhalt zur Moderation aufbewahren. Er wird auch nach erneuter Teilnahme nicht wieder sichtbar." onConfirm={() => void mutate(`${base}/contributions/${encodeURIComponent(item.id)}`, 'DELETE', { epoch: mission.participation.epoch }, 'Dein verborgener Beitrag ist zurückgezogen.')} />}
        </div>)}

        {mayPost && <form onSubmit={contribute} aria-describedby={privacyId} className="mt-6 space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
          <h3 className="text-base font-semibold">Dein Beitrag</h3>
          <fieldset><legend className="mb-2 text-sm font-medium">Was möchtest du teilen?</legend><div className="flex flex-wrap gap-3"><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="mission-kind" checked={kind === 'INSIGHT'} onChange={() => { setKind('INSIGHT'); setContent(''); setTargetId(''); }} disabled={ownInsight} className="h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />Eine Erkenntnis{ownInsight ? ' (geteilt)' : ''}</label><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="mission-kind" checked={kind === 'BUILD_ON'} onChange={() => { setKind('BUILD_ON'); setContent(''); setTargetId(''); }} disabled={ownBuildOn || targets.length === 0} className="h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />Darauf aufbauen{ownBuildOn ? ' (geteilt)' : ''}</label></div></fieldset>
          {!targets.length && !ownBuildOn && <p className="text-sm text-muted-foreground">Aufbauen ist möglich, sobald eine andere teilnehmende Person eine Erkenntnis teilt.</p>}
          {kind === 'BUILD_ON' && <fieldset aria-labelledby={targetLabelId}><legend id={targetLabelId} className="mb-2 text-sm font-medium">Auf welche Erkenntnis?</legend><div className="space-y-2">{targets.map(target => <label key={target.id} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm"><input type="radio" name="mission-target" value={target.id} checked={targetId === target.id} onChange={() => setTargetId(target.id)} required className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" /><span className="min-w-0 whitespace-pre-wrap break-words"><span className="font-medium">{target.author.name || 'Mitglied'}: </span>{target.content}</span></label>)}</div></fieldset>}
          {availableKind && <><div className="space-y-2"><label htmlFor={contentId} className="text-sm font-medium">{kind === 'INSIGHT' ? 'Deine Erkenntnis' : 'Dein weiterführender Gedanke'}</label><Textarea id={contentId} value={content} onChange={event => setContent(event.target.value)} minLength={10} maxLength={2000} required aria-required="true" rows={5} /></div><Button type="submit" disabled={kind === 'BUILD_ON' && !targetId}>Im Space teilen</Button></>}
          {!availableKind && <p className="text-sm text-muted-foreground">Wähle die andere Beitragsart, um weiterzumachen.</p>}
        </form>}
      </section>
      {mission.canManage && <SpaceMissionModeration base={base} request={request} onModerate={(id, hidden) => void mutate(`${base}/contributions/${encodeURIComponent(id)}/moderation`, 'PATCH', { hidden }, hidden ? 'Der Beitrag ist ausgeblendet.' : 'Moderation gespeichert. Nur aktuell gültige Beiträge sind sichtbar.')} />}
    </div>
  </SpaceShell>;
}
