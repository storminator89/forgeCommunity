import { getMission } from './mission-catalog';
import type { CompleteTransferPlan, MainNodeId, MissionId, MissionKey, NodeId, TransferPlan, TransferSlotId } from './mission-definition';
import type { Answer, AnswerMap } from './community-collaboration-state';

type MainChoiceNodeId = Exclude<MainNodeId, 'TRANSFER'>;
export type ComparisonAnswer =
  | Readonly<{ kind: 'choice'; nodeId: MainChoiceNodeId; choiceId: string; correct: boolean }>
  | Readonly<{ kind: 'transfer'; nodeId: 'TRANSFER'; plan: Readonly<CompleteTransferPlan>; correct: boolean }>;
export type ComparisonSnapshot = Readonly<{
  missionKey: MissionKey;
  runId: number;
  sessionId: number;
  nodeId: MainNodeId;
  original: ComparisonAnswer;
  sourceKey: string;
}>;
export type ComparisonState = {
  snapshot: ComparisonSnapshot;
  phase: 'draft' | 'result';
  generation: number;
  selection: string | null;
  plan: TransferPlan;
  alternative: ComparisonAnswer | null;
};
type ComparisonAction = { missionKey: MissionKey; runId: number; sessionId: number; nodeId: MainNodeId; generation: number } & (
  | { type: 'select-choice'; choiceId: string }
  | { type: 'select-transfer'; slotId: TransferSlotId; value: string }
  | { type: 'apply' }
  | { type: 'another-alternative' }
);

export function createComparisonRuntime(missionId: MissionId) {
  const mission = getMission(missionId);
  const { choiceNodes, mainStations, transferSlots } = mission;

  function validPlan(plan: TransferPlan): plan is CompleteTransferPlan {
    return transferSlots.every(slot => slot.options.some(option => option.id === plan[slot.id]));
  }

  function validAnswer(answer: Answer | undefined, nodeId: NodeId): answer is Answer {
    if (!answer || answer.nodeId !== nodeId) return false;
    if (nodeId === 'TRANSFER') {
      return answer.kind === 'transfer' && validPlan(answer.plan) &&
        answer.correct === transferSlots.every(slot => answer.plan[slot.id] === slot.correctValue);
    }
    if (answer.kind !== 'choice') return false;
    const option = choiceNodes[nodeId].options.find(choice => choice.id === answer.choiceId);
    return Boolean(option && option.correct === answer.correct);
  }

  function answerKey(answer: Answer): string {
    return answer.kind === 'choice'
      ? `${answer.nodeId}:${answer.choiceId}:${answer.correct}`
      : `${answer.nodeId}:${answer.plan.content}:${answer.plan.recipient}:${answer.plan.access}:${answer.correct}`;
  }

  function closedRunKey(answers: AnswerMap): string | null {
    // Only the four closed, actually answered main moments can open a comparison.
    // Repairs remain part of the original history, never selectable sandbox nodes.
    const ids: NodeId[] = [...mainStations.map(station => station.id), 'SHARE_REPAIR', 'VERIFY_REPAIR'];
    const keys: string[] = [];
    for (const nodeId of ids) {
      const answer = answers[nodeId];
      if (!answer && (nodeId === 'SHARE_REPAIR' || nodeId === 'VERIFY_REPAIR')) continue;
      if (!validAnswer(answer, nodeId)) return null;
      keys.push(answerKey(answer));
    }
    return keys.join('|');
  }

  function cloneAnswer(answer: ComparisonAnswer): ComparisonAnswer {
    return answer.kind === 'transfer'
      ? Object.freeze({ ...answer, plan: Object.freeze({ ...answer.plan }) })
      : Object.freeze({ ...answer });
  }

  function createComparisonSnapshot(answers: AnswerMap, nodeId: MainNodeId, sessionId: number, runId = 0): ComparisonSnapshot | null {
    if (!Number.isSafeInteger(runId) || runId < 0 || !Number.isSafeInteger(sessionId) || sessionId < 1 || !mainStations.some(station => station.id === nodeId)) return null;
    const sourceKey = closedRunKey(answers);
    const answer = answers[nodeId];
    if (!sourceKey || !validAnswer(answer, nodeId) || answer.nodeId === 'SHARE_REPAIR' || answer.nodeId === 'VERIFY_REPAIR') return null;
    const original = nodeId === 'TRANSFER'
      ? answer.kind === 'transfer' ? cloneAnswer(answer) : null
      : answer.kind === 'choice' ? cloneAnswer({ kind: 'choice', nodeId, choiceId: answer.choiceId, correct: answer.correct }) : null;
    return original ? Object.freeze({ missionKey: mission.key, runId, sessionId, nodeId, original, sourceKey }) : null;
  }

  function comparisonMatchesAnswers(snapshot: ComparisonSnapshot, answers: AnswerMap, runId = 0): boolean {
    const answer = answers[snapshot.nodeId];
    return snapshot.missionKey === mission.key && snapshot.runId === runId && closedRunKey(answers) === snapshot.sourceKey && validAnswer(answer, snapshot.nodeId) &&
      answerKey(answer) === answerKey(snapshot.original);
  }

  function initialComparisonState(snapshot: ComparisonSnapshot): ComparisonState {
    return {
      snapshot, phase: 'draft', generation: 0, selection: null, alternative: null,
      // This is a fresh, uncommitted copy. It never aliases the run's transfer plan.
      plan: snapshot.original.kind === 'transfer'
        ? { ...snapshot.original.plan }
        : { content: null, recipient: null, access: null },
    };
  }

  function draftAnswer(state: ComparisonState): ComparisonAnswer | null {
    if (state.snapshot.missionKey !== mission.key || state.phase !== 'draft') return null;
    const { original, nodeId } = state.snapshot;
    if (nodeId === 'TRANSFER') {
      if (original.kind !== 'transfer' || !validPlan(state.plan) ||
        transferSlots.every(slot => state.plan[slot.id] === original.plan[slot.id])) return null;
      return cloneAnswer({ kind: 'transfer', nodeId, plan: { ...state.plan },
        correct: transferSlots.every(slot => state.plan[slot.id] === slot.correctValue) });
    }
    if (original.kind !== 'choice' || state.selection === original.choiceId) return null;
    const choice = choiceNodes[nodeId].options.find(option => option.id === state.selection);
    return choice ? cloneAnswer({ kind: 'choice', nodeId, choiceId: choice.id, correct: choice.correct }) : null;
  }

  function comparisonCanApply(state: ComparisonState): boolean {
    return Boolean(draftAnswer(state));
  }

  function comparisonReducer(state: ComparisonState, action: ComparisonAction): ComparisonState {
    const { snapshot } = state;
    if (snapshot.missionKey !== mission.key || action.missionKey !== mission.key || action.runId !== snapshot.runId ||
      action.sessionId !== snapshot.sessionId || action.nodeId !== snapshot.nodeId || action.generation !== state.generation ||
      !mainStations.some(station => station.id === snapshot.nodeId) || !validAnswer(snapshot.original, snapshot.nodeId)) return state;
    if (action.type === 'another-alternative') return state.phase === 'result'
      ? { ...initialComparisonState(snapshot), generation: state.generation + 1 } : state;
    // A local synchronous boundary rejects stale controls, duplicate submits,
    // incomplete/same plans and any action after this alternative was committed.
    if (state.phase !== 'draft') return state;
    if (action.type === 'apply') {
      const alternative = draftAnswer(state);
      return alternative ? { ...state, phase: 'result', alternative } : state;
    }
    if (action.type === 'select-choice') {
      if (snapshot.nodeId === 'TRANSFER' || snapshot.original.kind !== 'choice' ||
        action.choiceId === snapshot.original.choiceId ||
        !choiceNodes[snapshot.nodeId].options.some(option => option.id === action.choiceId)) return state;
      return { ...state, selection: action.choiceId };
    }
    if (snapshot.nodeId !== 'TRANSFER') return state;
    const { slotId, value } = action;
    if (transferSlots.some(slot => slot.id === slotId && slot.options.some(option => option.id === value))) {
      return { ...state, plan: { ...state.plan, [slotId]: value } };
    }
    return state;
  }

  function hasEqualAuthoredRisk(original: ComparisonAnswer, alternative: ComparisonAnswer): boolean {
    return original.kind === 'choice' && alternative.kind === 'choice' && original.nodeId === alternative.nodeId &&
      mission.equalRiskNodes.includes(original.nodeId) && !original.correct && !alternative.correct;
  }

  return { createComparisonSnapshot, comparisonMatchesAnswers, initialComparisonState, comparisonCanApply, comparisonReducer, hasEqualAuthoredRisk };
}

// Original-case entry points, never a mutable active mission.
const collaborationComparison = createComparisonRuntime('community-collaboration');
export const { createComparisonSnapshot, comparisonMatchesAnswers, initialComparisonState, comparisonCanApply, comparisonReducer, hasEqualAuthoredRisk } = collaborationComparison;
