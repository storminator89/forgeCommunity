'use client';

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent, RefObject } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, FileText, GitBranch, Info, Lock, RotateCcw, Shield, Users, Laptop, Phone, Unplug, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SparkEntry } from '@/components/spark-entry';
import type { SparkReaction } from '@/components/SparkCharacter';
import { useSparkLearningReaction, type SparkLearningEvent } from '@/hooks/useSparkLearningReaction';
import { useFriendlyMotion } from '@/components/community/FriendlyMotion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { isRepair, parentStation } from './community-collaboration-content';
import type { ChoiceNodeId, MainNodeId, MissionId, NodeId } from './mission-definition';
import { createMissionRuntime, recapStatus, type Answer, type AnswerMap, type MissionState } from './community-collaboration-state';
import { createComparisonRuntime, type ComparisonAnswer, type ComparisonSnapshot } from './community-collaboration-comparison';
import styles from './CommunityCollaboration.module.css';

// Defined once per allowlisted mission, never inside a render. Each component
// has immutable content and validators in its own closure, with no active-global
// mission and no per-topic duplicate engine.
function createDecisionMission(missionId: MissionId) {
  const { mission, completePlan, initialMissionState, missionReducer } = createMissionRuntime(missionId);
  const { choiceNodes, mainStations, transfer, transferSlots } = mission;
  const { comparisonCanApply, comparisonMatchesAnswers, comparisonReducer, createComparisonSnapshot,
    hasEqualAuthoredRisk, initialComparisonState } = createComparisonRuntime(missionId);

  function StationTrail({ state }: { state: MissionState }) {
    const current = parentStation(state.nodeId);
    const completed = mainStations.filter(station => state.answers[station.id]).length;
    return <div className={styles.trail}>
      <div className={styles.trailSummary}>
        <p>Dieser Durchlauf</p><span><span aria-hidden="true">{completed}/4</span><span className={styles.srOnly}>{completed} von 4 Hauptentscheidungen angewendet</span></span>
      </div>
      <progress className={styles.progress} value={completed} max={4} aria-label="Angewendete Hauptentscheidungen in diesem Durchlauf" />
      <ol className={styles.stations} aria-label="Hauptentscheidungen">
        {mainStations.map((station, index) => {
          const applied = Boolean(state.answers[station.id]);
          const active = current === station.id && state.stage !== 'recap';
          return <li key={station.id} aria-current={active ? 'step' : undefined} data-active={active} data-applied={applied}>
            <span className={styles.stationMark} aria-hidden="true">{applied ? <Check /> : index + 1}</span>
            <span>{station.label}<span className={styles.srOnly}>: {active ? 'Aktueller Schritt' : applied ? 'Angewendet' : 'Noch offen'}</span></span>
          </li>;
        })}
      </ol>
      {isRepair(state.nodeId) && state.stage !== 'recap' && <p className={styles.branch}><GitBranch aria-hidden="true" />Eine zusätzliche Vertiefung zu {mainStations.find(station => station.id === current)?.label}</p>}
    </div>;
  }

  function ShareVisual({ answer, repair }: { answer?: Answer; repair: boolean }) {
    const reference = repair && answer && !answer.correct;
    const safe = Boolean(answer?.correct || reference);
    const applied = Boolean(answer);
    return <figure className={styles.caseVisual}>
      <figcaption><FileText aria-hidden="true" /><span>{reference ? 'Beispiel ansehen' : applied ? 'Angewendete Fassung' : 'Anfragevorschau'}</span><small>Nur Simulation</small></figcaption>
      <div className={styles.document}>
        <div className={styles.documentRow}><FileText aria-hidden="true" /><span>{repair ? 'Neutrales Beispiel des Arbeitsschritts' : 'Aufgabenstelle'}</span></div>
        <div className={styles.documentRow}><span className={styles.lineMark} aria-hidden="true" /><span>Meine Frage</span></div>
        {['Private Nachricht', 'E-Mail-Adresse'].map(label => <div className={styles.documentRow} key={label} data-private="true" data-excluded={safe} data-risk={applied && !safe}>
          <Lock aria-hidden="true" /><span>{label}</span>
          {applied && <strong>{safe ? 'Nicht enthalten' : 'Unnötig enthalten'}</strong>}
        </div>)}
      </div>
    </figure>;
  }

  function VerifyVisual({ answer, repair }: { answer?: Answer; repair: boolean }) {
    const applied = Boolean(answer);
    return <figure className={styles.caseVisual}>
      <figcaption><Shield aria-hidden="true" /><span>{repair ? 'Identität prüfen' : 'Hilfsweg'}</span><small>Nur Simulation</small></figcaption>
      {repair ? <div className={styles.evidence}>
        {['Logo', 'Zeitdruck', 'Behauptung'].map(label => <span key={label}>{label}</span>)}
        {applied && <p><Info aria-hidden="true" />Keine Bestätigung der Identität</p>}
      </div> : <div className={styles.connection} data-risk={applied && !answer?.correct}>
        <span>Unerwartete Nachricht</span><span className={styles.connector} aria-hidden="true" />
        <span><Lock aria-hidden="true" />Zugangsdaten</span>
        {applied && <p>{answer?.correct ? 'Zugangsdaten bleiben bei dir' : 'Risiko: Zugang für andere möglich'}</p>}
      </div>}
      {applied && <div className={styles.knownRoute}>
        <p>{answer?.correct ? 'Unabhängiger Hilfsweg' : 'Beispiel: unabhängig prüfen'}</p>
        <div><span>{repair ? 'Bekannter Zugang' : 'Plattform selbst öffnen'}</span><ArrowRight aria-hidden="true" /><span>Hilfe prüfen</span></div>
      </div>}
    </figure>;
  }

  function AccessVisual({ answer }: { answer?: Answer }) {
    const applied = Boolean(answer);
    const selected = answer?.kind === 'choice' ? answer.choiceId : null;
    const scope = selected === 'access_folder' ? 'Ganzer Ordner' : selected === 'access_login' ? 'Eigener Login' : 'Entwurf';
    const access = selected === 'access_folder' ? 'Bearbeiten' : selected === 'access_login' ? 'Zugang zum Konto' : 'Kommentieren';
    return <figure className={styles.caseVisual}>
      <figcaption><Users aria-hidden="true" /><span>{applied ? 'Deine simulierte Freigabe' : 'Auftrag: Rückmeldung zum Entwurf'}</span><small>Nur Simulation</small></figcaption>
      {applied ? <>
        <div className={styles.planStrip} data-risk={!answer?.correct}>
          <div><FileText aria-hidden="true" /><span>{scope}</span></div><ArrowRight aria-hidden="true" />
          <div><Users aria-hidden="true" /><span>Benannte Person</span></div><ArrowRight aria-hidden="true" />
          <div><Lock aria-hidden="true" /><span>{access}</span></div>
        </div>
        {!answer?.correct && <p className={styles.visualNote}><Info aria-hidden="true" />Beispiel: Entwurf → benannte Person → Kommentieren</p>}
        <p className={styles.outside}><Lock aria-hidden="true" />Persönliche Notizen {answer?.correct ? 'bleiben außerhalb' : selected === 'access_folder' ? 'sind unnötig enthalten' : 'werden für den Auftrag nicht gebraucht'}</p>
      </> : <div className={styles.assignmentPreview}><span><FileText aria-hidden="true" />Entwurf</span><span><Users aria-hidden="true" />Benannte Person</span><span><Lock aria-hidden="true" />Persönliche Notizen im Ordner</span></div>}
    </figure>;
  }

  function TransferVisual({ answer }: { answer: Answer }) {
    if (answer.kind !== 'transfer') return null;
    return <figure className={styles.caseVisual}>
      <figcaption><GitBranch aria-hidden="true" /><span>Dein geprüfter Plan</span><small>Nur Simulation</small></figcaption>
      <div className={styles.planStrip}>
        {transferSlots.map((slot, index) => <div className={styles.planPart} key={slot.id}>
          {index > 0 && <ArrowRight className={styles.planArrow} aria-hidden="true" />}
          <div data-risk={answer.plan[slot.id] !== slot.correctValue}>
            <small>{slot.label}</small><strong>{slot.options.find(option => option.id === answer.plan[slot.id])?.label}</strong>
            <span>{answer.plan[slot.id] === slot.correctValue ? mission.transferFitLabel : 'Korrektur nötig'}</span>
          </div>
        </div>)}
      </div>
      <div className={styles.referencePlan}>
        <p>{answer.correct ? mission.transferReferenceTitle : mission.transferExampleTitle}</p>
        <p>{mission.transferReference[0]} <ArrowRight aria-hidden="true" /> {mission.transferReference[1]} <ArrowRight aria-hidden="true" /> {mission.transferReference[2]}</p>
      </div>
    </figure>;
  }

  function IncidentVisual({ nodeId, answer }: { nodeId: ChoiceNodeId; answer?: Answer }) {
    const visual = mission.choiceVisuals?.[nodeId];
    if (!visual) return null;
    const applied = answer?.kind === 'choice' ? visual.outcomes[answer.choiceId] : null;
    const containing = parentStation(nodeId) === 'SHARE';
    const Icon = containing ? Laptop : parentStation(nodeId) === 'VERIFY' ? Phone : Shield;
    return <figure className={styles.caseVisual}>
      <figcaption><Icon aria-hidden="true" /><span>{applied ? 'Deine simulierte Entscheidung' : 'In diesem Fall'}</span><small>Nur Simulation</small></figcaption>
      {containing && <div className={styles.deviceConnection} data-isolated={Boolean(answer?.correct)} aria-hidden="true">
        <span><Laptop />Laptop</span><span className={styles.networkLink} /><span><Network />Netz</span>
      </div>}
      <div className={styles.incidentVisual} data-risk={Boolean(answer && !answer.correct)}>
        <Icon aria-hidden="true" /><span>{applied ?? visual.before}</span>
      </div>
      {containing && <p className={styles.visualNote}>IT-Prüfung offen</p>}
    </figure>;
  }

  function SceneVisual({ nodeId, answer }: { nodeId: NodeId; answer?: Answer }) {
    if (mission.visual === 'containment' && nodeId !== 'TRANSFER') return <IncidentVisual nodeId={nodeId} answer={answer} />;
    if (nodeId === 'SHARE' || nodeId === 'SHARE_REPAIR') return <ShareVisual answer={answer} repair={nodeId === 'SHARE_REPAIR'} />;
    if (nodeId === 'VERIFY' || nodeId === 'VERIFY_REPAIR') return <VerifyVisual answer={answer} repair={nodeId === 'VERIFY_REPAIR'} />;
    if (nodeId === 'ACCESS') return <AccessVisual answer={answer} />;
    return answer ? <TransferVisual answer={answer} /> : null;
  }

  function AnswerConsequences({ answer }: { answer: Answer }) {
    if (answer.kind === 'choice') {
      const consequence = choiceNodes[answer.nodeId].options.find(option => option.id === answer.choiceId)?.consequence;
      return consequence ? <p className={styles.recapConsequence}>{consequence}</p> : null;
    }
    return <ul className={styles.recapConsequences}>{transferSlots.map(slot => {
      const option = slot.options.find(option => option.id === answer.plan[slot.id]);
      return option?.consequence ? <li key={slot.id}><strong>{slot.label}:</strong> {option.consequence}</li> : null;
    })}</ul>;
  }

  function AnswerFeedbackBody({ answer, showChoice = true, showConsequences = true }: { answer: Answer; showChoice?: boolean; showConsequences?: boolean }) {
    const feedback = answer.kind === 'choice'
      ? choiceNodes[answer.nodeId].feedback[answer.correct ? 'correct' : 'incorrect']
      : answer.correct ? transfer.feedback : null;
    const selectedChoice = answer.kind === 'choice' ? choiceNodes[answer.nodeId].options.find(option => option.id === answer.choiceId) : null;
    return <>
      {showChoice && selectedChoice && <p className={styles.appliedChoice}><strong>Deine angewendete Entscheidung:</strong> {selectedChoice.label}</p>}
      {showConsequences && selectedChoice?.consequence && <p className={styles.choiceConsequence}>{selectedChoice.consequence}</p>}
      {feedback && <p>{feedback}</p>}
      {showConsequences && answer.kind === 'transfer' && transferSlots.some(slot => slot.options.some(option => option.consequence)) && <ul>{transferSlots.map(slot => {
        const option = slot.options.find(option => option.id === answer.plan[slot.id]);
        return option?.consequence ? <li key={slot.id}><strong>{slot.label}:</strong> {option.consequence}</li> : null;
      })}</ul>}
      {answer.kind === 'transfer' && !answer.correct && <ul>{transferSlots.filter(slot => answer.plan[slot.id] !== slot.correctValue).map(slot => <li key={slot.id}><strong>{slot.label}:</strong> {slot.correction}</li>)}</ul>}
    </>;
  }

  function CompactAnswerFeedback({ answer }: { answer: Answer }) {
    const feedback = answer.kind === 'choice'
      ? choiceNodes[answer.nodeId].feedback[answer.correct ? 'correct' : 'incorrect']
      : answer.correct ? transfer.feedback : null;
    const selectedChoice = answer.kind === 'choice' ? choiceNodes[answer.nodeId].options.find(option => option.id === answer.choiceId) : null;
    const dimensions = answer.kind === 'transfer' ? transferSlots.map(slot => ({
      id: slot.id,
      label: slot.label,
      consequence: slot.options.find(option => option.id === answer.plan[slot.id])?.consequence,
      correction: answer.plan[slot.id] !== slot.correctValue ? slot.correction : null,
    })) : [];
    const hasConsequence = Boolean(selectedChoice?.consequence || dimensions.some(dimension => dimension.consequence));

    return <>
      {selectedChoice?.consequence && <p className={styles.choiceConsequence}>{selectedChoice.consequence}</p>}
      {dimensions.some(dimension => dimension.consequence || dimension.correction) && <ul>{dimensions.map(dimension =>
        dimension.consequence || dimension.correction ? <li key={dimension.id}>
          <strong>{dimension.label}:</strong> {dimension.consequence ?? dimension.correction}
          {dimension.consequence && dimension.correction && <span className={styles.feedbackCorrection}>{dimension.correction}</span>}
        </li> : null,
      )}</ul>}
      {feedback && (hasConsequence ? <details className={styles.feedbackReason}>
        <summary>Warum?</summary>
        <p>{feedback}</p>
      </details> : <p>{feedback}</p>)}
    </>;
  }

  function Feedback({ state, headingRef, reaction }: { state: MissionState; headingRef: RefObject<HTMLHeadingElement | null>; reaction: SparkReaction | null }) {
    const answer = state.answers[state.nodeId];
    if (!answer) return null;
    const title = answer.correct ? 'Passend gewählt' : 'Schau auf die Folge';
    return <section className={styles.feedback} data-correct={answer.correct} aria-labelledby="case-feedback-title">
      <div className={styles.feedbackTitle}>{answer.correct ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}<h3 ref={headingRef} id="case-feedback-title" tabIndex={-1}>{title}</h3><SparkEntry reaction={reaction} /></div>
      <CompactAnswerFeedback answer={answer} />
    </section>;
  }

  function answerSummary(answer?: Answer): string {
    if (!answer) return '';
    if (answer.kind === 'choice') return choiceNodes[answer.nodeId].options.find(option => option.id === answer.choiceId)?.label ?? '';
    return transferSlots.map(slot => `${slot.label}: ${slot.options.find(option => option.id === answer.plan[slot.id])?.label ?? ''}`).join(' · ');
  }

  function ComparisonAnswerView({ answer, title, headingId, status, repair }: {
    answer: ComparisonAnswer; title: string; headingId: string; status?: string; repair?: Answer;
  }) {
    return <section className={styles.comparisonAnswer} aria-labelledby={headingId}>
      <h4 id={headingId}>{title}</h4>
      {status && <p className={styles.recapStatus}>{status}</p>}
      <p className={styles.recapDecision}><strong>Gewählt:</strong> {answerSummary(answer)}</p>
      {repair && <p className={styles.recapDecision}><strong>Vertiefung:</strong> {answerSummary(repair)}</p>}
      <div className={styles.comparisonFeedback}><AnswerFeedbackBody answer={answer} showChoice={false} />{mission.visual === 'containment' && repair && <AnswerFeedbackBody answer={repair} showChoice={false} />}</div>
      <SceneVisual nodeId={answer.nodeId} answer={answer} />
    </section>;
  }

  function MomentComparison({ snapshot, status, repair, onReturn }: {
    snapshot: ComparisonSnapshot; status: string; repair?: Answer; onReturn: (sessionId: number) => void;
  }) {
    const [comparison, compare] = useReducer(comparisonReducer, snapshot, initialComparisonState);
    const heading = useRef<HTMLHeadingElement>(null);
    const resultHeading = useRef<HTMLHeadingElement>(null);
    const [announcement, setAnnouncement] = useState('');
    const componentId = useId();
    const prefix = `case-comparison-${componentId}-${snapshot.sessionId}`;
    const nodeId = snapshot.nodeId;
    const node = nodeId === 'TRANSFER' ? transfer : choiceNodes[nodeId];
    const actionContext = { missionKey: mission.key, runId: snapshot.runId, sessionId: snapshot.sessionId, nodeId, generation: comparison.generation };
    const canApply = comparisonCanApply(comparison);
    const selectedSlots = transferSlots.filter(slot => comparison.plan[slot.id] !== null).length;
    const equalRisk = Boolean(comparison.alternative && hasEqualAuthoredRisk(snapshot.original, comparison.alternative));
    const comparisonAnnouncement = comparison.phase === 'result'
      ? `Alternative im Vergleich angewendet.${equalRisk ? ' Gleiches Risiko.' : ''} Dein Durchlauf bleibt unverändert.`
      : 'Vergleichsentwurf bereit. Eine andere Entscheidung wird erst nach dem Anwenden verglichen.';

    useEffect(() => { setAnnouncement(comparisonAnnouncement); }, [comparisonAnnouncement]);

    useLayoutEffect(() => {
      // This component only mounts after an explicit recap action, never on load.
      if (comparison.phase === 'result') resultHeading.current?.focus();
      else heading.current?.focus();
    }, [comparison.phase]);

    const applyComparison = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      compare({ ...actionContext, type: 'apply' });
    };
    const draftNotice = nodeId === 'TRANSFER'
      ? `${selectedSlots} von 3 Feldern ausgewählt. ${canApply ? 'Anderer Plan. Noch nicht geprüft.' : 'Ändere mindestens ein Feld gegenüber deinem Durchlauf.'}`
      : canApply ? 'Andere Entscheidung ausgewählt. Noch nicht angewendet.' : 'Wähle eine andere Entscheidung als in deinem Durchlauf.';

    return <section className={styles.comparison} aria-labelledby={`${prefix}-title`}>
      <p className={styles.eyebrow}>{mainStations.find(station => station.id === nodeId)?.recap}</p>
      <h3 ref={heading} id={`${prefix}-title`} tabIndex={-1}>Vergleich zu deinem Durchlauf</h3>
      <p className={styles.comparisonNotice}>Ein Experiment ohne Wertung. Dein Durchlauf bleibt unverändert.</p>
      <div className={styles.situationBubble}><SparkEntry /><p className={styles.situation}>{node.situation}</p></div>
      <ComparisonAnswerView answer={snapshot.original} title="Im ursprünglichen Durchlauf" headingId={`${prefix}-original`} status={status} repair={repair} />

      {comparison.phase === 'draft' ? <form className={styles.decisionForm} onSubmit={applyComparison} aria-label="Alternative für den Vergleich">
        {nodeId === 'TRANSFER' ? <>
          <h4 className={styles.prompt}>{transfer.prompt}</h4>
          <p className={styles.comparisonNotice}>Dein ursprünglicher Plan ist als unverbindlicher Entwurf vorausgefüllt.</p>
          <div className={styles.transferSlots}>
            {transferSlots.map(slot => <fieldset className={styles.slot} key={slot.id}>
              <legend>{slot.label}</legend>
              {slot.options.map(option => <label className={styles.choice} data-selected={comparison.plan[slot.id] === option.id} htmlFor={`${prefix}-${slot.id}-${option.id}`} key={option.id}>
                <input id={`${prefix}-${slot.id}-${option.id}`} type="radio" name={`${prefix}-${slot.id}`} value={option.id}
                  checked={comparison.plan[slot.id] === option.id}
                  onChange={() => compare({ ...actionContext, type: 'select-transfer', slotId: slot.id, value: option.id })} />
                <span>{option.label}</span><Check className={styles.selectedCheck} aria-hidden="true" />
              </label>)}
            </fieldset>)}
          </div>
        </> : <fieldset className={styles.choices}>
          <legend>{choiceNodes[nodeId].prompt}</legend>
          {choiceNodes[nodeId].options.map(option => {
            const original = snapshot.original.kind === 'choice' && option.id === snapshot.original.choiceId;
            return <label className={styles.choice} data-selected={comparison.selection === option.id} data-original={original} htmlFor={`${prefix}-${option.id}`} key={option.id}>
              <input id={`${prefix}-${option.id}`} type="radio" name={`${prefix}-choice`} value={option.id} disabled={original}
                checked={comparison.selection === option.id}
                onChange={() => compare({ ...actionContext, type: 'select-choice', choiceId: option.id })} />
              <span>{option.label}{original && <small className={styles.originalChoice}>Im Durchlauf gewählt</small>}</span><Check className={styles.selectedCheck} aria-hidden="true" />
            </label>;
          })}
        </fieldset>}
        <p className={styles.selectionStatus} id={`${prefix}-selection`}>{draftNotice}</p>
        <Button type="submit" className={styles.primaryAction} disabled={!canApply} aria-describedby={`${prefix}-selection`}>
          {nodeId === 'TRANSFER' ? 'Alternativen Plan prüfen' : 'Alternative anwenden'}<ArrowRight aria-hidden="true" />
        </Button>
      </form> : comparison.alternative && <section className={styles.comparisonResult} aria-labelledby={`${prefix}-result`}>
        <h3 id={`${prefix}-result`} ref={resultHeading} tabIndex={-1}>Alternative im Vergleich</h3>
        <p className={styles.comparisonNotice}>Nur im Vergleich angewendet. Der ursprüngliche Rückblick bleibt gleich.</p>
        {equalRisk && <p className={styles.equalRisk}>Gleiches Risiko</p>}
        <ComparisonAnswerView answer={comparison.alternative} title="Im Vergleich ausprobiert" headingId={`${prefix}-alternative`} />
        <div className={styles.actions}><Button type="button" variant="outline" onClick={() => compare({ ...actionContext, type: 'another-alternative' })}>Andere Alternative</Button></div>
      </section>}
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      <div className={styles.actions}><Button type="button" variant="outline" className={styles.returnAction} onClick={() => onReturn(snapshot.sessionId)}><ArrowLeft aria-hidden="true" />Zurück zum Überblick</Button></div>
    </section>;
  }

  function Recap({ answers, runId }: { answers: AnswerMap; runId: number }) {
    // Sandbox selection lives only inside the recap. Original restart/history and
    // actor-keyed unmounts discard it without touching the mission reducer.
    const [selected, setSelected] = useState<ComparisonSnapshot | null>(null);
    const session = useRef(0);
    const actionRefs = useRef<Partial<Record<MainNodeId, HTMLButtonElement | null>>>({});
    const previous = useRef<ComparisonSnapshot | null>(null);
    const active = selected && comparisonMatchesAnswers(selected, answers, runId) ? selected : null;

    useEffect(() => {
      if (selected && !active) setSelected(current => current === selected ? null : current);
    }, [selected, active]);
    useLayoutEffect(() => {
      const prior = previous.current;
      previous.current = active;
      if (prior && !active) actionRefs.current[prior.nodeId]?.focus();
    }, [active]);

    const openComparison = (nodeId: MainNodeId) => {
      const snapshot = createComparisonSnapshot(answers, nodeId, ++session.current, runId);
      if (snapshot) setSelected(current => current === null ? snapshot : current);
    };
    const returnToOverview = (sessionId: number) => setSelected(current => current?.sessionId === sessionId ? null : current);

    if (active) {
      const repair = active.nodeId === 'SHARE' ? answers.SHARE_REPAIR : active.nodeId === 'VERIFY' ? answers.VERIFY_REPAIR : undefined;
      return <MomentComparison key={active.sessionId} snapshot={active} status={recapStatus(active.nodeId, answers)} repair={repair} onReturn={returnToOverview} />;
    }
    return <>
      <p className={styles.eyebrow}>Rückblick auf diesen Durchlauf</p>
      <ol className={styles.recapList}>
        {mainStations.map(station => {
          const status = recapStatus(station.id, answers);
          const original = answers[station.id];
          const repair = station.id === 'SHARE' ? answers.SHARE_REPAIR : station.id === 'VERIFY' ? answers.VERIFY_REPAIR : undefined;
          return <li key={station.id}>
            <span className={styles.recapIcon} aria-hidden="true">{status === 'Passend gewählt' ? <Check /> : status === 'Mit Anleitung geübt' ? <GitBranch /> : <Info />}</span>
            <div><h3>{station.recap}</h3><p className={styles.recapStatus}>{status}</p>
              <p className={styles.recapDecision}><strong>Gewählt:</strong> {answerSummary(original)}</p>
              {repair && <p className={styles.recapDecision}><strong>Vertiefung:</strong> {answerSummary(repair)}</p>}
              {mission.visual === 'containment' && original && <>
                <AnswerConsequences answer={original} />
                <details className={styles.recapDetails}>
                  <summary>Folge ansehen</summary>
                  <div className={styles.comparisonFeedback}><AnswerFeedbackBody answer={original} showChoice={false} showConsequences={false} />
                    {repair && <><p><strong>Vertiefung</strong></p><AnswerFeedbackBody answer={repair} showChoice={false} /></>}
                  </div>
                </details>
              </>}
              {original && <Button type="button" variant="outline" className={styles.recapAction}
                ref={element => { actionRefs.current[station.id] = element; }} onClick={() => openComparison(station.id)}
                aria-label={`${original.correct ? 'Andere Entscheidung vergleichen' : 'Diesen Moment reparieren'}: ${station.recap}`}>
                {original.correct ? 'Andere Entscheidung vergleichen' : 'Diesen Moment reparieren'}<ArrowRight aria-hidden="true" />
              </Button>}
            </div>
          </li>;
        })}
      </ol>
      <p className={styles.takeaway}>{mission.takeaway}</p>
      <p className={styles.persistenceNote}>Dieser Durchlauf wird nicht gespeichert.</p>
    </>;
  }

  function DecisionMission() {
    const [state, dispatch] = useReducer(missionReducer, undefined, initialMissionState);
    const { reaction, createEvent, showReaction, clearReaction } = useSparkLearningReaction();
    const previousState = useRef(state);
    const applyIntent = useRef<{ runId: number; nodeId: NodeId; event: SparkLearningEvent } | null>(null);
    const applyPointer = useRef<{ runId: number; nodeId: NodeId; timeStamp: number; x: number; y: number } | null>(null);
    useLayoutEffect(() => {
      const previous = previousState.current;
      previousState.current = state;
      if (previous === state) return;
      const intent = applyIntent.current;
      applyIntent.current = null;
      const applied = state.answers[state.nodeId];
      // Only an accepted question -> feedback reducer transition supplies an
      // authored verdict. Selection, repair entry, recap and comparison do not.
      if (intent && previous.stage === 'question' && state.stage === 'feedback' &&
        previous.runId === state.runId && previous.nodeId === state.nodeId &&
        intent.runId === state.runId && intent.nodeId === state.nodeId &&
        applied && applied !== previous.answers[state.nodeId]) {
        showReaction(applied.correct ? 'positive' : 'retry', intent.event);
      } else clearReaction();
    }, [state, showReaction, clearReaction]);
    const actionContext = { missionKey: mission.key, runId: state.runId };
    const currentRun = useRef(state.runId);
    useLayoutEffect(() => { currentRun.current = state.runId; }, [state.runId]);
    const { enabled: friendlyMotionEnabled } = useFriendlyMotion();
    const [restartOpen, setRestartOpen] = useState(false);
    const questionHeading = useRef<HTMLHeadingElement>(null);
    const feedbackHeading = useRef<HTMLHeadingElement>(null);
    const introHeading = useRef<HTMLHeadingElement>(null);
    const recapHeading = useRef<HTMLHeadingElement>(null);
    const focusIntro = useRef(false);
    const restartingDialog = useRef(false);

    useEffect(() => {
      // A browser-history return or bfcache restore starts a new transient run.
      // No answer or scenario state is written into history or any storage.
      const reset = () => { clearReaction(); applyIntent.current = null; applyPointer.current = null; focusIntro.current = true; restartingDialog.current = true; setRestartOpen(false); dispatch({ missionKey: mission.key, runId: currentRun.current, type: 'restart' }); };
      const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
      window.addEventListener('popstate', reset);
      window.addEventListener('pagehide', reset);
      window.addEventListener('pageshow', onPageShow);
      return () => {
        window.removeEventListener('popstate', reset);
        window.removeEventListener('pagehide', reset);
        window.removeEventListener('pageshow', onPageShow);
      };
    }, [clearReaction]);

    useLayoutEffect(() => {
      if (state.stage === 'question') questionHeading.current?.focus();
      if (state.stage === 'feedback') feedbackHeading.current?.focus();
      if (state.stage === 'recap') recapHeading.current?.focus();
      if (state.stage === 'intro' && focusIntro.current) {
        focusIntro.current = false;
        introHeading.current?.focus();
      }
    }, [state.stage, state.nodeId]);

    const restart = () => { clearReaction(); applyIntent.current = null; applyPointer.current = null; focusIntro.current = true; restartingDialog.current = true; setRestartOpen(false); dispatch({ ...actionContext, type: 'restart' }); };
    const answer = state.stage === 'feedback' ? state.answers[state.nodeId] : undefined;
    const node = state.nodeId === 'TRANSFER' ? transfer : choiceNodes[state.nodeId];
    const canApply = state.nodeId === 'TRANSFER' ? Boolean(completePlan(state.transferPlan)) : Boolean(state.selection);
    const selectedTransferSlots = transferSlots.filter(slot => state.transferPlan[slot.id] !== null).length;
    const mainIndex = mainStations.findIndex(station => station.id === parentStation(state.nodeId));
    const isPointerClick = (event: MouseEvent<HTMLButtonElement>) => event.detail > 0 ||
      ('pointerType' in event.nativeEvent && typeof event.nativeEvent.pointerType === 'string' && event.nativeEvent.pointerType !== '');
    const rememberApplyPointer = (event: MouseEvent<HTMLButtonElement>) => {
      if (applyIntent.current) return;
      applyPointer.current = isPointerClick(event)
        ? { runId: state.runId, nodeId: state.nodeId, timeStamp: event.timeStamp, x: event.clientX, y: event.clientY }
        : null;
    };
    const preventRepeatedActivation = (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // A held activation key is one intent; a fresh press remains immediate.
      if (event.repeat) event.preventDefault();
      else applyPointer.current = null;
    };
    const continueMission = (event: MouseEvent<HTMLButtonElement>) => {
      const pointer = applyPointer.current;
      const elapsed = pointer ? event.timeStamp - pointer.timeStamp : -1;
      // Replaced DOM targets can reset the native click count. Also recognise
      // a brief, stationary mouse/pen/touch burst, but not a new keyboard/AT
      // activation or a deliberately moved pointer. Never disable the control.
      if (pointer && pointer.runId === state.runId && pointer.nodeId === state.nodeId && isPointerClick(event) &&
        (event.detail > 1 || (elapsed >= 0 && elapsed < 500 && Math.abs(event.clientX - pointer.x) <= 24 && Math.abs(event.clientY - pointer.y) <= 24))) {
        event.preventDefault();
        applyPointer.current = { ...pointer, timeStamp: event.timeStamp };
        return;
      }
      applyPointer.current = null;
      clearReaction();
      dispatch({ ...actionContext, type: 'continue', nodeId: state.nodeId });
    };
    const apply = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      clearReaction();
      // Keep the first queued intent: a duplicate handler cannot replace its
      // epoch after an off/on pair before the accepted state commits.
      if (state.stage === 'question' && canApply && !applyIntent.current) {
        applyIntent.current = { runId: state.runId, nodeId: state.nodeId, event: createEvent() };
      }
      dispatch({ ...actionContext, type: 'apply', nodeId: state.nodeId });
    };
    const feedbackAnnouncement = answer ? (answer.correct ? 'Entscheidung angewendet. Passend gewählt.' : 'Entscheidung angewendet. Eine Erklärung und ein Beispiel sind verfügbar.') : '';

    return <div className={styles.mission} data-friendly-motion={friendlyMotionEnabled}>
      <div className={styles.utilities}>
        <Link href="/courses/scenarios" prefetch={false}><ArrowLeft aria-hidden="true" />Fall wählen</Link>
        <span>Freiwillige Fallmission</span>
        {state.stage !== 'intro' && state.stage !== 'recap' && <AlertDialog open={restartOpen} onOpenChange={open => { if (open) { clearReaction(); restartingDialog.current = false; } setRestartOpen(open); }}>
          <AlertDialogTrigger asChild><Button type="button" variant="ghost" className={styles.restart}><RotateCcw aria-hidden="true" />Neu starten</Button></AlertDialogTrigger>
          <AlertDialogContent onCloseAutoFocus={event => {
            if (restartingDialog.current) {
              event.preventDefault();
              restartingDialog.current = false;
              introHeading.current?.focus();
            }
          }}>
            <AlertDialogHeader><AlertDialogTitle>Durchlauf neu starten?</AlertDialogTitle><AlertDialogDescription>Deine bisherigen Entscheidungen in dieser Simulation werden verworfen.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Weiter ausprobieren</AlertDialogCancel><AlertDialogAction onClick={restart}>Neu starten</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>}
      </div>
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{feedbackAnnouncement}</p>

      {state.stage === 'intro' ? <section className={styles.intro} aria-labelledby="mission-intro-title">
        <div className={styles.introText}>
          <p className={styles.eyebrow}>Entscheiden. Folgen sehen. Übertragen.</p>
          <h2 ref={introHeading} id="mission-intro-title" tabIndex={-1}>{mission.title}</h2>
          <p className={styles.introLead}>{mission.introLead}</p>
          <p className={styles.persistenceNote}>Fiktive Beispiele. Dein Durchlauf wird nicht gespeichert.</p>
          <Button type="button" size="lg" className={styles.primaryAction} onClick={() => dispatch({ ...actionContext, type: 'start' })}>{mission.startLabel}<ArrowRight aria-hidden="true" /></Button>
          <p className={styles.introDetail}>Vier Hauptentscheidungen, bei Bedarf eine Vertiefung. Freiwillig und ohne Kurswertung.</p>
        </div>
        <div className={styles.introDiagram} aria-hidden="true">
          <div>{mission.visual === 'collaboration' ? <FileText /> : <Unplug />}<span>{mission.introDiagram[0]}</span></div><span className={styles.diagramLine} />
          <div>{mission.visual === 'collaboration' ? <Users /> : <Phone />}<span>{mission.introDiagram[1]}</span></div><span className={styles.diagramLine} />
          <div>{mission.visual === 'collaboration' ? <Lock /> : <Shield />}<span>{mission.introDiagram[2]}</span></div>
        </div>
      </section> : state.stage === 'recap' ? <section className={styles.recap} aria-labelledby="mission-recap-title">
        <h2 ref={recapHeading} id="mission-recap-title" tabIndex={-1}>Deine Entscheidungen im Überblick</h2>
        <Recap answers={state.answers} runId={state.runId} />
        <div className={styles.actions}><Button type="button" className={styles.primaryAction} onClick={restart}><RotateCcw aria-hidden="true" />Gesamten Durchlauf neu starten</Button><Button asChild variant="outline"><Link href="/courses" prefetch={false}>Zu den Kursen</Link></Button></div>
      </section> : <>
        <StationTrail state={state} />
        <section className={styles.scene} aria-labelledby="mission-question-title">
          <div className={styles.sceneHeading}>
            <p className={styles.eyebrow}>{isRepair(state.nodeId) ? 'Vertiefung' : `Hauptentscheidung ${mainIndex + 1}`} · {node.title}</p>
            <h2 ref={questionHeading} id="mission-question-title" tabIndex={-1}>{node.prompt}</h2>
            <div className={styles.situationBubble}>{state.stage === 'question' && <SparkEntry />}<p className={styles.situation}>{node.situation}</p></div>
          </div>
          {state.stage === 'question' ? <>
            <form key={state.nodeId} onSubmit={apply} onKeyDownCapture={preventRepeatedActivation} className={styles.decisionForm}>
              <SceneVisual nodeId={state.nodeId} />
              {state.nodeId === 'TRANSFER' ? <>
                <h3 className={styles.srOnly}>{transfer.prompt}</h3>
                <div className={styles.transferSlots}>
                  {transferSlots.map(slot => <fieldset key={slot.id} className={styles.slot}>
                    <legend>{slot.label}</legend>
                    {slot.options.map(option => <label className={styles.choice} data-selected={state.transferPlan[slot.id] === option.id} key={option.id}>
                      <input type="radio" name={`transfer-${slot.id}`} value={option.id} checked={state.transferPlan[slot.id] === option.id}
                        onChange={() => dispatch({ ...actionContext, type: 'select-transfer', slotId: slot.id, value: option.id })} />
                      <span>{option.label}</span><Check className={styles.selectedCheck} aria-hidden="true" />
                    </label>)}
                  </fieldset>)}
                </div>
              </> : <fieldset className={styles.choices}>
                <legend className={styles.srOnly}>{choiceNodes[state.nodeId].prompt}</legend>
                {choiceNodes[state.nodeId].options.map(option => <label className={styles.choice} data-selected={state.selection === option.id} key={option.id}>
                  <input type="radio" name={`choice-${state.nodeId}`} value={option.id} checked={state.selection === option.id}
                    onChange={() => { if (state.nodeId !== 'TRANSFER') dispatch({ ...actionContext, type: 'select-choice', nodeId: state.nodeId, choiceId: option.id }); }} />
                  <span>{option.label}</span><Check className={styles.selectedCheck} aria-hidden="true" />
                </label>)}
              </fieldset>}
              <p className={styles.selectionStatus} id="case-selection-status">{state.nodeId === 'TRANSFER' ? `${selectedTransferSlots} von 3 Feldern ausgewählt. Noch nicht geprüft.` : canApply ? 'Ausgewählt. Noch nicht angewendet.' : 'Wähle eine Entscheidung.'}</p>
              <Button type="submit" className={styles.primaryAction} disabled={!canApply} onClick={rememberApplyPointer} aria-describedby="case-selection-status">{state.nodeId === 'TRANSFER' ? 'Plan prüfen' : 'Prüfen'}<ArrowRight aria-hidden="true" /></Button>
            </form>
          </> : <>
            <SceneVisual nodeId={state.nodeId} answer={answer} />
            <div className={styles.feedbackTray} data-correct={answer?.correct}>
              <Feedback state={state} headingRef={feedbackHeading} reaction={reaction} />
              <div className={styles.actions}><Button type="button" className={styles.primaryAction} onClick={continueMission} onKeyDownCapture={preventRepeatedActivation}>{state.nodeId === 'TRANSFER' ? 'Zum Überblick' : 'Weiter'}<ArrowRight aria-hidden="true" /></Button></div>
            </div>
          </>}
          <p className={styles.simulationNote}>{mission.simulationNote}</p>
        </section>
      </>}
      {mission.sources && <details className={styles.sources}>
        <summary>Quellen zum fiktiven Fall</summary>
        <ul>{mission.sources.map(source => <li key={source.href}><a href={source.href} target="_blank" rel="noreferrer noopener">{source.title}</a></li>)}</ul>
      </details>}
    </div>;
  }
  return DecisionMission;
}

export const CommunityCollaborationMission = createDecisionMission('community-collaboration');
export const IncidentResponseMission = createDecisionMission('incident-response');
