'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SpaceHttpError } from './space-api';
import { missionApiUrl, missionPrivacy, type SpaceMission } from './mission-api';
import { isPendingInvitation } from './MissionInvitationInbox';
import { invitationProblem, invitationRecord, invitationRevision, useInvitationMutation, useInvitationRead, useInvitationScope } from './mission-invitation-ui';
import { missionInvitationConsent, missionInvitationFull, type MissionInvitationDetail, type MissionInvitationDecisionResult } from '@/types/space-mission-invitations';
import styles from './mission-invitations.module.css';

function detail(value: unknown): value is MissionInvitationDetail {
  if (!invitationRecord(value)) return false;
  if (value.state === 'UNAVAILABLE') return value.invitation === null;
  if (value.state === 'PENDING') return isPendingInvitation(value.invitation);
  return (value.state === 'ACCEPTED' || value.state === 'DECLINED') && invitationRecord(value.invitation)
    && value.invitation.state === value.state && typeof value.invitation.id === 'string' && invitationRevision(value.invitation.revision);
}
function decisionResult(value: unknown): value is MissionInvitationDecisionResult<SpaceMission> {
  return invitationRecord(value) && invitationRecord(value.invitation) && (value.invitation.state === 'ACCEPTED' || value.invitation.state === 'DECLINED')
    && typeof value.invitation.id === 'string' && invitationRevision(value.invitation.revision) && invitationRecord(value.mission)
    && typeof value.mission.id === 'string' && typeof value.mission.spaceId === 'string' && invitationRecord(value.mission.participation)
    && typeof value.mission.participation.active === 'boolean' && Array.isArray(value.mission.contributions) && Array.isArray(value.mission.ownContributions);
}
type Props = { viewerId: string; spaceId: string; missionId: string; invitationId: string; onMission: (mission: SpaceMission) => void };
export function MissionInvitationDecision(props: Props) {
  return <Decision key={JSON.stringify([props.viewerId, props.spaceId, props.missionId, props.invitationId])} {...props} />;
}
function Decision({ viewerId, spaceId, missionId, invitationId, onMission }: Props) {
  const scope = useInvitationScope(viewerId, JSON.stringify(['decision', spaceId, missionId, invitationId]));
  const base = `${missionApiUrl(spaceId, missionId)}/invitations/${encodeURIComponent(invitationId)}`;
  const read = useInvitationRead(scope.identity, scope.isCurrent, base, detail);
  const mutation = useInvitationMutation(scope.identity, scope.isCurrent, 'decision');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<'ACCEPTED' | 'DECLINED' | 'UNAVAILABLE' | null>(null);
  const [full, setFull] = useState(false);
  const helpId = useId();
  const invitation = read.value?.state === 'PENDING' ? read.value.invitation : null;
  const canAccept = Boolean(invitation?.canAccept && !full);
  async function decide(decision: 'ACCEPT' | 'DECLINE') {
    if (!scope.isCurrent() || (!mutation.unresolved && (!invitation || (decision === 'ACCEPT' && (!consent || !canAccept))))) return;
    setError('');
    try {
      const result = await mutation.execute(`${base}/decision`, 'POST', { decision, expectedRevision: invitation?.revision }, (value): value is MissionInvitationDecisionResult<SpaceMission> => decisionResult(value) && value.invitation.id === invitationId && value.mission.id === missionId && value.mission.spaceId === spaceId);
      if (!scope.isCurrent() || !result) return;
      if (result.invitation.id !== invitationId || result.mission.id !== missionId || result.mission.spaceId !== spaceId) { setError('Die Antwort passt nicht zu dieser Mission. Prüfe den aktuellen Stand.'); return; }
      setOutcome(result.invitation.state); setConsent(false); onMission(result.mission);
    } catch (caught) { if (scope.isCurrent()) {
      setError(invitationProblem(caught)); setConsent(false);
      if (caught instanceof SpaceHttpError && caught.code === 'MISSION_FULL') setFull(true);
      if (caught instanceof SpaceHttpError && ([401, 403, 404].includes(caught.status) || caught.code === 'MISSION_CLOSED')) setOutcome('UNAVAILABLE');
    } }
  }
  const state = outcome ?? read.value?.state;
  return <section id="mission-invitation" className={`${styles.region} ${styles.target}`} data-invitation-region="decision" aria-labelledby={`${helpId}-heading`}>
    <h2 id={`${helpId}-heading`}>Deine Einladung</h2>
    {mutation.unresolved ? <><p role="status">{mutation.unresolved.phase === 'sending' ? 'Deine Entscheidung wird verarbeitet…' : 'Der Ausgang deiner Entscheidung ist unklar. Prüfe dieselbe Entscheidung erneut.'}</p><Button type="button" disabled={mutation.unresolved.phase === 'sending'} onClick={() => void decide('ACCEPT')}>Dieselbe Entscheidung erneut prüfen</Button></>
      : read.loading && !outcome ? <p role="status">Einladung wird geprüft…</p>
        : state === 'ACCEPTED' ? <p role="status">Du hast die Einladung angenommen. Den aktuellen Stand siehst du in der Mission.</p>
          : state === 'DECLINED' ? <p role="status">Du hast die Einladung abgelehnt.</p>
            : state === 'UNAVAILABLE' ? <p>Diese Einladung ist nicht mehr verfügbar.</p>
              : invitation ? <>
                <p>{invitation.sender.name || 'Mitglied'} lädt dich zu „{invitation.mission.title}“ im Space {invitation.mission.space.name} ein.</p>
                <p id={helpId}>{missionInvitationConsent}</p>
                <details><summary>Teilnahme und Privatsphäre</summary><p>{missionPrivacy}</p></details>
                {!canAccept && <p role="status">{missionInvitationFull}</p>}
                <label className={styles.peer}><input type="checkbox" checked={consent} disabled={!canAccept} aria-describedby={helpId} onChange={event => setConsent(event.target.checked)} />Ich möchte freiwillig an dieser Mission teilnehmen.</label>
                <div className={styles.controls}><Button type="button" disabled={!consent || !canAccept} onClick={() => void decide('ACCEPT')}>Einladung annehmen</Button><Button type="button" variant="outline" onClick={() => void decide('DECLINE')}>Einladung ablehnen</Button></div>
              </> : null}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {read.error && !mutation.unresolved && <p role="alert">{read.error}</p>}
    {!mutation.unresolved && <Button type="button" variant="ghost" onClick={() => { setConsent(false); setOutcome(null); setFull(false); void read.load(); }}>Einladung aktualisieren</Button>}
  </section>;
}
