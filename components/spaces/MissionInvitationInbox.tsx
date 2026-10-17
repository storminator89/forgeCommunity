'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { missionUrl } from './mission-api';
import { invitationProblem, invitationRecord, invitationRevision, useInvitationMutation, useInvitationRead, useInvitationScope } from './mission-invitation-ui';
import { missionInvitationPreferencePrivacy, type MissionInvitationList, type MissionInvitationPreference, type PendingMissionInvitation } from '@/types/space-mission-invitations';
import styles from './mission-invitations.module.css';

function preference(value: unknown): value is MissionInvitationPreference { return invitationRecord(value) && typeof value.enabled === 'boolean' && invitationRevision(value.revision); }
export function isPendingInvitation(value: unknown): value is PendingMissionInvitation {
  return invitationRecord(value) && typeof value.id === 'string' && invitationRevision(value.revision) && value.revision > 0
    && typeof value.createdAt === 'string' && typeof value.expiresAt === 'string' && typeof value.canAccept === 'boolean'
    && (value.unavailableReason === null || value.unavailableReason === 'FULL') && invitationRecord(value.sender)
    && typeof value.sender.id === 'string' && (value.sender.name === null || typeof value.sender.name === 'string')
    && invitationRecord(value.mission) && typeof value.mission.id === 'string' && typeof value.mission.title === 'string'
    && invitationRecord(value.mission.space) && typeof value.mission.space.id === 'string' && typeof value.mission.space.name === 'string';
}
function list(value: unknown): value is MissionInvitationList { return invitationRecord(value) && Array.isArray(value.items) && value.items.every(isPendingInvitation) && (value.nextCursor === null || typeof value.nextCursor === 'string'); }

export function MissionInvitationInbox({ viewerId, role }: { viewerId: string; role?: string }) {
  useInvitationScope(viewerId, 'account-surface');
  const [open, setOpen] = useState(false);
  const id = useId();
  if (role !== 'USER') return null;
  return <section className={styles.region} data-invitation-region="inbox" aria-label="Meine Missionseinladungen">
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>Meine Einladungen</Button>
    {open && <div id={id}><Inbox key={viewerId} viewerId={viewerId} /></div>}
  </section>;
}
function Inbox({ viewerId }: { viewerId: string }) {
  const scope = useInvitationScope(viewerId, 'own-inbox');
  const pref = useInvitationRead(scope.identity, scope.isCurrent, '/api/space-missions/invitation-preference', preference);
  const inbox = useInvitationRead(scope.identity, scope.isCurrent, '/api/space-missions/invitations', list);
  const mutation = useInvitationMutation(scope.identity, scope.isCurrent, 'preference');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const helpId = useId();
  // A changed preference with an unknown result keeps its last known consent.
  const enabled = mutation.unresolved ? !(JSON.parse(mutation.unresolved.body) as { enabled: boolean }).enabled : pref.value?.enabled;
  async function toggle() {
    if (!scope.isCurrent() || (!mutation.unresolved && (!pref.value || (!enabled && !consent)))) return;
    setError(''); setNotice('');
    try {
      const result = await mutation.execute('/api/space-missions/invitation-preference', 'PUT', { enabled: !enabled, expectedRevision: pref.value?.revision }, preference);
      if (!scope.isCurrent() || !result) return;
      setConsent(false); setNotice(result.enabled ? 'Du erhältst jetzt Missionseinladungen.' : 'Missionseinladungen sind ausgeschaltet.');
      void pref.load(); void inbox.load();
    } catch (caught) { if (scope.isCurrent()) setError(invitationProblem(caught)); }
  }
  const rows = inbox.value;
  return <>
    <div className={styles.region} data-invitation-region="preference" aria-labelledby={`${helpId}-heading`}>
      <h2 id={`${helpId}-heading`}>Einladungen erhalten</h2>
      <p id={helpId} className={styles.quiet}>{missionInvitationPreferencePrivacy}</p>
      {pref.loading && !mutation.unresolved && <p role="status">Deine Einstellung wird geprüft…</p>}
      {pref.error && <p role="alert">{pref.error}</p>}
      {enabled !== undefined && <>
        <p>{enabled ? 'Einladungen sind eingeschaltet.' : 'Einladungen sind ausgeschaltet.'}</p>
        {!enabled && !mutation.unresolved && <label className={styles.peer}><input type="checkbox" checked={consent} aria-describedby={helpId} onChange={event => setConsent(event.target.checked)} />Ich möchte Missionseinladungen erhalten.</label>}
        <div className={styles.controls}><Button type="button" variant="outline" disabled={mutation.unresolved?.phase === 'sending' || (!mutation.unresolved && !enabled && !consent)} onClick={() => void toggle()}>{mutation.unresolved?.phase === 'sending' ? 'Einstellung wird verarbeitet…' : mutation.unresolved ? 'Dieselbe Einstellung erneut prüfen' : enabled ? 'Einladungen ausschalten' : 'Einladungen einschalten'}</Button>
          <Button type="button" variant="ghost" onClick={() => { void pref.load(); void inbox.load(); }}>Einladungsstand aktualisieren</Button></div>
      </>}
      {pref.error && enabled === undefined && <Button type="button" variant="outline" onClick={() => void pref.load()}>Einstellung erneut laden</Button>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {mutation.unresolved?.phase === 'unknown' && <p role="status">Der Ausgang der Einstellungsänderung ist unklar. Prüfe dieselbe Änderung erneut, bevor du eine andere wählst.</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
    <h2>Offene Einladungen</h2>
    {inbox.loading ? <p role="status">Einladungen werden geprüft…</p> : inbox.error ? <p role="alert">{inbox.error}</p> : rows?.items.length ? <ul className={styles.list}>{rows.items.map(item => <li key={item.id}>
      <h3><Link className={styles.link} prefetch={false} href={`${missionUrl(item.mission.space.id, item.mission.id)}?invitation=${encodeURIComponent(item.id)}#mission-invitation`}>{item.mission.title}</Link></h3>
      <p className={styles.quiet}>{item.sender.name || 'Mitglied'} lädt dich im Space {item.mission.space.name} ein.</p>
      {!item.canAccept && <p>Alle fünf Plätze sind belegt. Du kannst die Einladung weiterhin ablehnen.</p>}
    </li>)}</ul> : <p className={styles.quiet}>Keine offenen Einladungen.</p>}
  </>;
}
