import { isRepair } from './community-collaboration-content';
import { getMission } from './mission-catalog';
import type {
  ChoiceNodeId, CompleteTransferPlan, MissionId, MissionKey, NodeId, TransferPlan, TransferSlotId,
} from './mission-definition';

export type ChoiceAnswer = { kind: 'choice'; nodeId: ChoiceNodeId; choiceId: string; correct: boolean };
export type TransferAnswer = { kind: 'transfer'; nodeId: 'TRANSFER'; plan: CompleteTransferPlan; correct: boolean };
export type Answer = ChoiceAnswer | TransferAnswer;
export type AnswerMap = Partial<Record<NodeId, Answer>>;
export type MissionState = {
  missionKey: MissionKey;
  runId: number;
  stage: 'intro' | 'question' | 'feedback' | 'recap';
  nodeId: NodeId;
  selection: string | null;
  transferPlan: TransferPlan;
  answers: AnswerMap;
  repairBudgetUsed: boolean;
};
export type MissionAction = { missionKey: MissionKey; runId: number } & (
  | { type: 'start' }
  | { type: 'restart' }
  | { type: 'select-choice'; nodeId: ChoiceNodeId; choiceId: string }
  | { type: 'select-transfer'; slotId: TransferSlotId; value: string }
  | { type: 'apply'; nodeId: NodeId }
  | { type: 'continue'; nodeId: NodeId }
);

function emptyPlan(): TransferPlan {
  return { content: null, recipient: null, access: null };
}

function nextNode(state: MissionState, answer: Answer): NodeId | 'RECAP' {
  switch (answer.nodeId) {
    case 'SHARE': return !answer.correct && !state.repairBudgetUsed ? 'SHARE_REPAIR' : 'VERIFY';
    case 'SHARE_REPAIR': return 'VERIFY';
    case 'VERIFY': return !answer.correct && !state.repairBudgetUsed ? 'VERIFY_REPAIR' : 'ACCESS';
    case 'VERIFY_REPAIR': return 'ACCESS';
    case 'ACCESS': return 'TRANSFER';
    case 'TRANSFER': return 'RECAP';
  }
}

export function recapStatus(nodeId: NodeId, answers: AnswerMap): 'Passend gewählt' | 'Mit Anleitung geübt' | 'Beispiel angesehen' {
  if (answers[nodeId]?.correct) return 'Passend gewählt';
  const repairId = nodeId === 'SHARE' ? 'SHARE_REPAIR' : nodeId === 'VERIFY' ? 'VERIFY_REPAIR' : null;
  return repairId && answers[repairId]?.correct ? 'Mit Anleitung geübt' : 'Beispiel angesehen';
}

// Only an allowlisted ID can create a runtime. No user/URL-provided definition
// or mutable module-global active mission can alter this closure.
export function createMissionRuntime(missionId: MissionId) {
  const mission = getMission(missionId);
  const { choiceNodes, transferSlots } = mission;
  function initialMissionState(): MissionState {
    return {
      missionKey: mission.key, runId: 0,
      stage: 'intro', nodeId: 'SHARE', selection: null, transferPlan: emptyPlan(),
      answers: {}, repairBudgetUsed: false,
    };
  }
  function completePlan(plan: TransferPlan): CompleteTransferPlan | null {
    const { content, recipient, access } = plan;
    if (!content || !recipient || !access ||
      !transferSlots.every(slot => slot.options.some(option => option.id === plan[slot.id]))) return null;
    return { content, recipient, access };
  }
  function missionReducer(state: MissionState, action: MissionAction): MissionState {
    // Definition identity and run generation reject stale cross-mission and
    // post-restart handlers before even start/restart can change state.
    if (state.missionKey !== mission.key || action.missionKey !== mission.key || action.runId !== state.runId) return state;
    if (action.type === 'restart') return { ...initialMissionState(), runId: state.runId + 1 };
    if (action.type === 'start') return state.stage === 'intro' ? { ...state, stage: 'question' } : state;
    if (action.type === 'select-choice') {
      if (state.stage !== 'question' || state.nodeId === 'TRANSFER' || state.nodeId !== action.nodeId ||
        !choiceNodes[state.nodeId].options.some(option => option.id === action.choiceId)) return state;
      return { ...state, selection: action.choiceId };
    }
    if (action.type === 'select-transfer') {
      if (state.stage !== 'question' || state.nodeId !== 'TRANSFER' ||
        !transferSlots.some(slot => slot.id === action.slotId && slot.options.some(option => option.id === action.value))) return state;
      return { ...state, transferPlan: { ...state.transferPlan, [action.slotId]: action.value } };
    }
    if (action.type === 'apply') {
      // Synchronous commit boundary: no repeated, stale or unchosen commit.
      if (state.stage !== 'question' || state.nodeId !== action.nodeId) return state;
      let answer: Answer;
      if (state.nodeId === 'TRANSFER') {
        const plan = completePlan(state.transferPlan);
        if (!plan) return state;
        answer = {
          kind: 'transfer', nodeId: 'TRANSFER', plan,
          correct: transferSlots.every(slot => plan[slot.id] === slot.correctValue),
        };
      } else {
        const choice = choiceNodes[state.nodeId].options.find(option => option.id === state.selection);
        if (!choice) return state;
        answer = { kind: 'choice', nodeId: state.nodeId, choiceId: choice.id, correct: choice.correct };
      }
      return { ...state, stage: 'feedback', answers: { ...state.answers, [state.nodeId]: answer } };
    }
    if (action.type === 'continue') {
      if (state.stage !== 'feedback' || state.nodeId !== action.nodeId) return state;
      const answer = state.answers[state.nodeId];
      if (!answer || answer.nodeId !== state.nodeId) return state;
      const target = nextNode(state, answer);
      if (target === 'RECAP') return { ...state, stage: 'recap', selection: null, transferPlan: emptyPlan() };
      return {
        ...state, stage: 'question', nodeId: target, selection: null, transferPlan: emptyPlan(),
        // Entering either repair consumes the sole repair budget.
        repairBudgetUsed: state.repairBudgetUsed || isRepair(target),
      };
    }
    return state;
  }
  return { mission, initialMissionState, completePlan, missionReducer };
}

// Existing entry points remain explicitly bound to the original authored case.
const collaborationRuntime = createMissionRuntime('community-collaboration');
export const initialMissionState = collaborationRuntime.initialMissionState;
export const completePlan = collaborationRuntime.completePlan;
export const missionReducer = collaborationRuntime.missionReducer;
