'use client';

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, FileText, GitBranch, Info, Lock, RotateCcw, Shield, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  choiceNodes, isRepair, mainStations, parentStation, transfer, transferSlots,
  type NodeId,
} from './community-collaboration-content';
import { completePlan, initialMissionState, missionReducer, recapStatus, type Answer, type AnswerMap, type MissionState } from './community-collaboration-state';
import styles from './CommunityCollaboration.module.css';

function StationTrail({ state }: { state: MissionState }) {
  const current = parentStation(state.nodeId);
  const completed = mainStations.filter(station => state.answers[station.id]).length;
  return <div className={styles.trail}>
    <div className={styles.trailSummary}>
      <p>Dieser Durchlauf</p><span>{completed} von 4 Hauptentscheidungen angewendet</span>
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
    {isRepair(state.nodeId) && state.stage !== 'recap' && <p className={styles.branch}><GitBranch aria-hidden="true" />Eine zusätzliche Vertiefung zu {current === 'SHARE' ? 'Informationen' : 'Hilfe'}</p>}
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
          <span>{answer.plan[slot.id] === slot.correctValue ? 'Passt zum Auftrag' : 'Korrektur nötig'}</span>
        </div>
      </div>)}
    </div>
    <div className={styles.referencePlan}>
      <p>{answer.correct ? 'Passender Freigabeplan' : 'Beispiel für einen passenden Freigabeplan'}</p>
      <p>Aufgabe und Uhrzeit <ArrowRight aria-hidden="true" /> Benannte helfende Person <ArrowRight aria-hidden="true" /> Lesen</p>
    </div>
  </figure>;
}

function SceneVisual({ nodeId, answer }: { nodeId: NodeId; answer?: Answer }) {
  if (nodeId === 'SHARE' || nodeId === 'SHARE_REPAIR') return <ShareVisual answer={answer} repair={nodeId === 'SHARE_REPAIR'} />;
  if (nodeId === 'VERIFY' || nodeId === 'VERIFY_REPAIR') return <VerifyVisual answer={answer} repair={nodeId === 'VERIFY_REPAIR'} />;
  if (nodeId === 'ACCESS') return <AccessVisual answer={answer} />;
  return answer ? <TransferVisual answer={answer} /> : null;
}

function Feedback({ state, headingRef }: { state: MissionState; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const answer = state.answers[state.nodeId];
  if (!answer) return null;
  const title = answer.correct ? 'Passend gewählt' : 'Schau auf die Folge';
  const feedback = answer.kind === 'choice'
    ? choiceNodes[answer.nodeId].feedback[answer.correct ? 'correct' : 'incorrect']
    : answer.correct ? transfer.feedback : null;
  const selectedChoice = answer.kind === 'choice' ? choiceNodes[answer.nodeId].options.find(option => option.id === answer.choiceId)?.label : null;
  return <section className={styles.feedback} data-correct={answer.correct} aria-labelledby="case-feedback-title">
    <div className={styles.feedbackTitle}>{answer.correct ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}<h3 ref={headingRef} id="case-feedback-title" tabIndex={-1}>{title}</h3></div>
    {selectedChoice && <p className={styles.appliedChoice}><strong>Deine angewendete Entscheidung:</strong> {selectedChoice}</p>}
    {feedback && <p>{feedback}</p>}
    {answer.kind === 'transfer' && !answer.correct && <ul>{transferSlots.filter(slot => answer.plan[slot.id] !== slot.correctValue).map(slot => <li key={slot.id}><strong>{slot.label}:</strong> {slot.correction}</li>)}</ul>}
    <p className={styles.feedbackNotice}>{!answer.correct && isRepair(state.nodeId) ? 'Beispiel angesehen. Danach geht es mit dem nächsten Fall weiter.' : 'Die Entscheidung ist angewendet. Weiter führt zum nächsten Schritt.'}</p>
  </section>;
}

function answerSummary(answer?: Answer): string {
  if (!answer) return '';
  if (answer.kind === 'choice') return choiceNodes[answer.nodeId].options.find(option => option.id === answer.choiceId)?.label ?? '';
  return transferSlots.map(slot => `${slot.label}: ${slot.options.find(option => option.id === answer.plan[slot.id])?.label ?? ''}`).join(' · ');
}

function Recap({ answers }: { answers: AnswerMap }) {
  return <>
    <p className={styles.eyebrow}>Rückblick auf diesen Durchlauf</p>
    <ol className={styles.recapList}>
      {mainStations.map(station => {
        const status = recapStatus(station.id, answers);
        const repair = station.id === 'SHARE' ? answers.SHARE_REPAIR : station.id === 'VERIFY' ? answers.VERIFY_REPAIR : undefined;
        return <li key={station.id}>
          <span className={styles.recapIcon} aria-hidden="true">{status === 'Passend gewählt' ? <Check /> : status === 'Mit Anleitung geübt' ? <GitBranch /> : <Info />}</span>
          <div><h3>{station.recap}</h3><p className={styles.recapStatus}>{status}</p>
            <p className={styles.recapDecision}><strong>Gewählt:</strong> {answerSummary(answers[station.id])}</p>
            {repair && <p className={styles.recapDecision}><strong>Vertiefung:</strong> {answerSummary(repair)}</p>}
          </div>
        </li>;
      })}
    </ol>
    <p className={styles.takeaway}>Ein hilfreicher Check: Welche Information, für wen, mit welchem Zugriff?</p>
    <p className={styles.persistenceNote}>Dieser Durchlauf wird nicht gespeichert.</p>
  </>;
}

export function CommunityCollaborationMission() {
  const [state, dispatch] = useReducer(missionReducer, undefined, initialMissionState);
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
    const reset = () => { focusIntro.current = true; restartingDialog.current = true; setRestartOpen(false); dispatch({ type: 'restart' }); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    window.addEventListener('popstate', reset);
    window.addEventListener('pagehide', reset);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('popstate', reset);
      window.removeEventListener('pagehide', reset);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  useLayoutEffect(() => {
    if (state.stage === 'question') questionHeading.current?.focus();
    if (state.stage === 'feedback') feedbackHeading.current?.focus();
    if (state.stage === 'recap') recapHeading.current?.focus();
    if (state.stage === 'intro' && focusIntro.current) {
      focusIntro.current = false;
      introHeading.current?.focus();
    }
  }, [state.stage, state.nodeId]);

  const restart = () => { focusIntro.current = true; restartingDialog.current = true; setRestartOpen(false); dispatch({ type: 'restart' }); };
  const answer = state.stage === 'feedback' ? state.answers[state.nodeId] : undefined;
  const node = state.nodeId === 'TRANSFER' ? transfer : choiceNodes[state.nodeId];
  const canApply = state.nodeId === 'TRANSFER' ? Boolean(completePlan(state.transferPlan)) : Boolean(state.selection);
  const selectedTransferSlots = transferSlots.filter(slot => state.transferPlan[slot.id] !== null).length;
  const mainIndex = mainStations.findIndex(station => station.id === parentStation(state.nodeId));
  const apply = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); dispatch({ type: 'apply', nodeId: state.nodeId }); };
  const feedbackAnnouncement = answer ? (answer.correct ? 'Entscheidung angewendet. Passend gewählt.' : 'Entscheidung angewendet. Eine Erklärung und ein Beispiel sind verfügbar.') : '';

  return <div className={styles.mission}>
    <div className={styles.utilities}>
      <Link href="/courses" prefetch={false}><ArrowLeft aria-hidden="true" />Zu den Kursen</Link>
      <span>Freiwillige Fallmission</span>
      {state.stage !== 'intro' && state.stage !== 'recap' && <AlertDialog open={restartOpen} onOpenChange={open => { if (open) restartingDialog.current = false; setRestartOpen(open); }}>
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
        <h2 ref={introHeading} id="mission-intro-title" tabIndex={-1}>Sicher zusammenarbeiten</h2>
        <p className={styles.introLead}>Vier kurze Situationen. Deine Entscheidungen verändern die Simulation.</p>
        <p className={styles.persistenceNote}>Fiktive Beispiele. Dein Durchlauf wird nicht gespeichert.</p>
        <Button type="button" size="lg" className={styles.primaryAction} onClick={() => dispatch({ type: 'start' })}>Mission starten<ArrowRight aria-hidden="true" /></Button>
        <p className={styles.introDetail}>Vier Hauptentscheidungen, bei Bedarf eine Vertiefung. Freiwillig und ohne Kurswertung.</p>
      </div>
      <div className={styles.introDiagram} aria-hidden="true">
        <div><FileText /><span>Information</span></div><span className={styles.diagramLine} />
        <div><Users /><span>Person</span></div><span className={styles.diagramLine} />
        <div><Lock /><span>Zugriff</span></div>
      </div>
    </section> : state.stage === 'recap' ? <section className={styles.recap} aria-labelledby="mission-recap-title">
      <h2 ref={recapHeading} id="mission-recap-title" tabIndex={-1}>Deine Entscheidungen im Überblick</h2>
      <Recap answers={state.answers} />
      <div className={styles.actions}><Button type="button" className={styles.primaryAction} onClick={restart}><RotateCcw aria-hidden="true" />Nochmal ausprobieren</Button><Button asChild variant="outline"><Link href="/courses" prefetch={false}>Zu den Kursen</Link></Button></div>
    </section> : <>
      <StationTrail state={state} />
      <section className={styles.scene} aria-labelledby="mission-question-title">
        <div className={styles.sceneHeading}>
          <p className={styles.eyebrow}>{isRepair(state.nodeId) ? 'Vertiefung' : `Hauptentscheidung ${mainIndex + 1}`}</p>
          <h2 ref={questionHeading} id="mission-question-title" tabIndex={-1}>{node.title}</h2>
          <p className={styles.situation}>{node.situation}</p>
        </div>
        {state.stage === 'question' ? <>
          <form key={state.nodeId} onSubmit={apply} className={styles.decisionForm}>
            {state.nodeId === 'TRANSFER' ? <>
              <h3 className={styles.prompt}>{transfer.prompt}</h3>
              <div className={styles.transferSlots}>
                {transferSlots.map(slot => <fieldset key={slot.id} className={styles.slot}>
                  <legend>{slot.label}</legend>
                  {slot.options.map(option => <label className={styles.choice} data-selected={state.transferPlan[slot.id] === option.id} key={option.id}>
                    <input type="radio" name={`transfer-${slot.id}`} value={option.id} checked={state.transferPlan[slot.id] === option.id}
                      onChange={() => dispatch({ type: 'select-transfer', slotId: slot.id, value: option.id })} />
                    <span>{option.label}</span>
                  </label>)}
                </fieldset>)}
              </div>
            </> : <fieldset className={styles.choices}>
              <legend>{choiceNodes[state.nodeId].prompt}</legend>
              {choiceNodes[state.nodeId].options.map(option => <label className={styles.choice} data-selected={state.selection === option.id} key={option.id}>
                <input type="radio" name={`choice-${state.nodeId}`} value={option.id} checked={state.selection === option.id}
                  onChange={() => { if (state.nodeId !== 'TRANSFER') dispatch({ type: 'select-choice', nodeId: state.nodeId, choiceId: option.id }); }} />
                <span>{option.label}</span>
              </label>)}
            </fieldset>}
            <p className={styles.selectionStatus} id="case-selection-status">{state.nodeId === 'TRANSFER' ? `${selectedTransferSlots} von 3 Feldern ausgewählt. Noch nicht geprüft.` : canApply ? 'Ausgewählt. Noch nicht angewendet.' : 'Wähle eine Entscheidung.'}</p>
            <Button type="submit" className={styles.primaryAction} disabled={!canApply} aria-describedby="case-selection-status">{state.nodeId === 'TRANSFER' ? 'Plan prüfen' : 'Entscheidung anwenden'}<ArrowRight aria-hidden="true" /></Button>
          </form>
          <SceneVisual nodeId={state.nodeId} />
        </> : <>
          <Feedback state={state} headingRef={feedbackHeading} />
          <SceneVisual nodeId={state.nodeId} answer={answer} />
          <div className={styles.actions}><Button type="button" className={styles.primaryAction} onClick={() => dispatch({ type: 'continue', nodeId: state.nodeId })}>{state.nodeId === 'TRANSFER' ? 'Zum Überblick' : 'Weiter'}<ArrowRight aria-hidden="true" /></Button></div>
        </>}
        <p className={styles.simulationNote}>Nur Simulation. Es wird nichts gepostet, versendet oder freigegeben.</p>
      </section>
    </>}
  </div>;
}
