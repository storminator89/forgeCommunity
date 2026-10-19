import {
  choiceNodes, mainStations, transferSlots,
  type CompleteTransferPlan, type MainNodeId, type NodeId, type TransferPlan, type TransferSlotId,
} from './community-collaboration-content';
import type { Answer, AnswerMap } from './community-collaboration-state';

type MainChoiceNodeId = Exclude<MainNodeId, 'TRANSFER'>;
export type ComparisonAnswer =
  | Readonly<{ kind: 'choice'; nodeId: MainChoiceNodeId; choiceId: string; correct: boolean }>
  | Readonly<{ kind: 'transfer'; nodeId: 'TRANSFER'; plan: Readonly<CompleteTransferPlan>; correct: boolean }>;
export type ComparisonSnapshot = Readonly<{
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
type ComparisonAction = { sessionId: number; nodeId: MainNodeId; generation: number } & (
  | { type: 'select-choice'; choiceId: string }
  | { type: 'select-transfer'; slotId: TransferSlotId; value: string }
  | { type: 'apply' }
  | { type: 'another-alternative' }
);

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

export function createComparisonSnapshot(answers: AnswerMap, nodeId: MainNodeId, sessionId: number): ComparisonSnapshot | null {
  if (!Number.isSafeInteger(sessionId) || sessionId < 1 || !mainStations.some(station => station.id === nodeId)) return null;
  const sourceKey = closedRunKey(answers);
  const answer = answers[nodeId];
  if (!sourceKey || !validAnswer(answer, nodeId) || answer.nodeId === 'SHARE_REPAIR' || answer.nodeId === 'VERIFY_REPAIR') return null;
  const original = nodeId === 'TRANSFER'
    ? answer.kind === 'transfer' ? cloneAnswer(answer) : null
    : answer.kind === 'choice' ? cloneAnswer({ kind: 'choice', nodeId, choiceId: answer.choiceId, correct: answer.correct }) : null;
  return original ? Object.freeze({ sessionId, nodeId, original, sourceKey }) : null;
}

export function comparisonMatchesAnswers(snapshot: ComparisonSnapshot, answers: AnswerMap): boolean {
  const answer = answers[snapshot.nodeId];
  return closedRunKey(answers) === snapshot.sourceKey && validAnswer(answer, snapshot.nodeId) &&
    answerKey(answer) === answerKey(snapshot.original);
}

export function initialComparisonState(snapshot: ComparisonSnapshot): ComparisonState {
  return {
    snapshot, phase: 'draft', generation: 0, selection: null, alternative: null,
    // This is a fresh, uncommitted copy. It never aliases the run's transfer plan.
    plan: snapshot.original.kind === 'transfer'
      ? { ...snapshot.original.plan }
      : { content: null, recipient: null, access: null },
  };
}

function draftAnswer(state: ComparisonState): ComparisonAnswer | null {
  if (state.phase !== 'draft') return null;
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

export function comparisonCanApply(state: ComparisonState): boolean {
  return Boolean(draftAnswer(state));
}

export function comparisonReducer(state: ComparisonState, action: ComparisonAction): ComparisonState {
  const { snapshot } = state;
  if (action.sessionId !== snapshot.sessionId || action.nodeId !== snapshot.nodeId || action.generation !== state.generation ||
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
  if (slotId === 'content' && (value === 'task_time' || value === 'full_note')) return { ...state, plan: { ...state.plan, content: value } };
  if (slotId === 'recipient' && (value === 'named_helper' || value === 'anyone_link')) return { ...state, plan: { ...state.plan, recipient: value } };
  if (slotId === 'access' && (value === 'read' || value === 'edit_share')) return { ...state, plan: { ...state.plan, access: value } };
  return state;
}

export function hasEqualAuthoredRisk(original: ComparisonAnswer, alternative: ComparisonAnswer): boolean {
  return original.kind === 'choice' && alternative.kind === 'choice' && original.nodeId === alternative.nodeId &&
    (original.nodeId === 'SHARE' || original.nodeId === 'VERIFY') && !original.correct && !alternative.correct;
}
