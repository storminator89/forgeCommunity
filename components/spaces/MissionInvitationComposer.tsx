'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { missionApiUrl } from './mission-api';
import { spaceJson } from './space-api';
import { invitationProblem, invitationRecord, invitationRevision, useInvitationMutation, useInvitationScope } from './mission-invitation-ui';
import { missionInvitationAcknowledgment, type MissionInvitationAcknowledgment, type MissionInvitationCandidates, type SendMissionInvitation } from '@/types/space-mission-invitations';
import styles from './mission-invitations.module.css';

function candidates(value: unknown): value is MissionInvitationCandidates {
  return invitationRecord(value) && invitationRevision(value.senderEpoch) && invitationRevision(value.senderAccessEpoch)
    && Array.isArray(value.items) && value.items.length <= 10 && value.items.every(item => invitationRecord(item) && invitationRecord(item.user)
      && typeof item.user.id === 'string' && (item.user.name === null || typeof item.user.name === 'string') && invitationRecord(item.selection)
      && typeof item.selection.validUntil === 'string' && typeof item.selection.nonce === 'string' && typeof item.selection.token === 'string');
}
function acknowledgment(value: unknown): value is MissionInvitationAcknowledgment { return invitationRecord(value) && value.processed === true && typeof value.requestId === 'string'; }

type Props = { viewerId: string; spaceId: string; missionId: string; participantEpoch: number; eligible: boolean };
export function MissionInvitationComposer(props: Props) {
  return <Composer key={JSON.stringify([props.viewerId, props.spaceId, props.missionId, props.participantEpoch, props.eligible])} {...props} />;
}
function Composer({ viewerId, spaceId, missionId, participantEpoch, eligible }: Props) {
  const scope = useInvitationScope(viewerId, JSON.stringify(['send', spaceId, missionId, participantEpoch, eligible]));
  const mutation = useInvitationMutation(scope.identity, scope.isCurrent, 'send');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<MissionInvitationCandidates | null>(null);
  const [selected, setSelected] = useState('');
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const searchGeneration = useRef(0);
  const fieldId = useId(); const helpId = useId();
  const base = missionApiUrl(spaceId, missionId);
  const locked = Boolean(mutation.unresolved);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (!scope.isCurrent() || !eligible || locked || query.trim().length < 2 || query.trim().length > 80) return;
    const generation = ++searchGeneration.current;
    setResult(null); setSelected(''); setSearching(true); setError(''); setNotice('');
    try {
      const value = await spaceJson<unknown>(`${base}/invitation-candidates?q=${encodeURIComponent(query.trim())}`);
      if (!candidates(value)) throw new Error('Unbekannte Antwort');
      if (scope.isCurrent() && generation === searchGeneration.current) setResult({ ...value, items: value.items.filter(item => item.user.id !== viewerId) });
    } catch { if (scope.isCurrent() && generation === searchGeneration.current) setError('Suche genauer nach dem Namen. Es werden nur aktuelle Mitglieder dieses privaten Spaces angezeigt.'); }
    finally { if (scope.isCurrent() && generation === searchGeneration.current) setSearching(false); }
  }
  async function send() {
    if (!scope.isCurrent() || !eligible) return;
    const item = result?.items.find(candidate => candidate.user.id === selected);
    if (!mutation.unresolved && (!item || !result)) return;
    setNotice(''); setError('');
    // An unresolved body is reused verbatim by the mutation lease, never rebuilt.
    const body: SendMissionInvitation = item && result ? {
      recipientId: item.user.id, senderEpoch: result.senderEpoch, senderAccessEpoch: result.senderAccessEpoch,
      requestId: crypto.randomUUID(), selection: item.selection,
    } : {} as SendMissionInvitation;
    try {
      const expectedRequest = mutation.unresolved ? (JSON.parse(mutation.unresolved.body) as SendMissionInvitation).requestId : body.requestId;
      const reply = await mutation.execute(`${base}/invitations`, 'POST', body, (value): value is MissionInvitationAcknowledgment => acknowledgment(value) && value.requestId === expectedRequest);
      if (!scope.isCurrent() || !reply) return;
      setNotice(missionInvitationAcknowledgment); setResult(null); setSelected(''); setQuery('');
    } catch (caught) { if (scope.isCurrent()) { setError(invitationProblem(caught)); setResult(null); setSelected(''); setQuery(''); } }
  }
  if (!eligible) return null;
  return <section className={styles.region} aria-labelledby={`${fieldId}-heading`} data-invitation-region="composer">
    <h2 id={`${fieldId}-heading`}>Jemanden einladen</h2>
    <p id={helpId} className={styles.quiet}>Wähle eine andere Person aus diesem privaten Space. Eine Einladung reserviert keinen Platz. Ob sie Einladungen erhält, bleibt privat.</p>
    <form onSubmit={event => void search(event)}>
      <div className={styles.controls}><div className={styles.field}><label htmlFor={fieldId}>Nach Namen suchen</label>
        <input className={styles.input} id={fieldId} value={query} minLength={2} maxLength={80} aria-describedby={helpId} disabled={locked} autoComplete="off" onChange={event => { ++searchGeneration.current; setQuery(event.target.value); setResult(null); setSelected(''); setSearching(false); }} />
      </div><Button type="submit" variant="outline" disabled={locked || searching || query.trim().length < 2}>{searching ? 'Namen werden geprüft…' : 'Person suchen'}</Button></div>
    </form>
    {result && <fieldset><legend>Eine Person auswählen</legend>{result.items.length ? result.items.map(item => <label className={styles.peer} key={item.user.id}><input type="radio" name={fieldId} checked={selected === item.user.id} disabled={locked} onChange={() => { if (scope.isCurrent()) setSelected(item.user.id); }} /><span>{item.user.name || 'Mitglied'}</span></label>) : <p>Keine passende Person gefunden. Verfeinere den Namen.</p>}</fieldset>}
    {(selected || mutation.unresolved) && <Button type="button" disabled={mutation.unresolved?.phase === 'sending'} onClick={() => void send()}>{mutation.unresolved?.phase === 'sending' ? 'Anfrage wird verarbeitet…' : mutation.unresolved ? 'Dieselbe Einladungsanfrage erneut prüfen' : 'Einladung an ausgewählte Person anfragen'}</Button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {mutation.unresolved?.phase === 'unknown' && !error && <p role="status">Die Antwort ist unklar. Du kannst dieselbe Anfrage erneut prüfen.</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
