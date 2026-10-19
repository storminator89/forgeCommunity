import {
  choiceNodes, isRepair, transferSlots,
  type ChoiceNodeId, type CompleteTransferPlan, type NodeId, type TransferPlan, type TransferSlotId,
} from './community-collaboration-content';

export type ChoiceAnswer = { kind: 'choice'; nodeId: ChoiceNodeId; choiceId: string; correct: boolean };
export type TransferAnswer = { kind: 'transfer'; nodeId: 'TRANSFER'; plan: CompleteTransferPlan; correct: boolean };
export type Answer = ChoiceAnswer | TransferAnswer;
export type AnswerMap = Partial<Record<NodeId, Answer>>;
export type MissionState = {
  stage: 'intro' | 'question' | 'feedback' | 'recap';
  nodeId: NodeId;
  selection: string | null;
  transferPlan: TransferPlan;
  answers: AnswerMap;
  repairBudgetUsed: boolean;
};
export type MissionAction =
  | { type: 'start' }
  | { type: 'restart' }
  | { type: 'select-choice'; nodeId: ChoiceNodeId; choiceId: string }
  | { type: 'select-transfer'; slotId: TransferSlotId; value: string }
  | { type: 'apply'; nodeId: NodeId }
  | { type: 'continue'; nodeId: NodeId };

function emptyPlan(): TransferPlan {
  return { content: null, recipient: null, access: null };
}

export function initialMissionState(): MissionState {
  return {
    stage: 'intro', nodeId: 'SHARE', selection: null, transferPlan: emptyPlan(),
    answers: {}, repairBudgetUsed: false,
  };
}

export function completePlan(plan: TransferPlan): CompleteTransferPlan | null {
  const { content, recipient, access } = plan;
  if (!content || !recipient || !access) return null;
  return { content, recipient, access };
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

function selectTransfer(plan: TransferPlan, slotId: TransferSlotId, value: string): TransferPlan {
  if (slotId === 'content' && (value === 'task_time' || value === 'full_note')) return { ...plan, content: value };
  if (slotId === 'recipient' && (value === 'named_helper' || value === 'anyone_link')) return { ...plan, recipient: value };
  if (slotId === 'access' && (value === 'read' || value === 'edit_share')) return { ...plan, access: value };
  return plan;
}

export function missionReducer(state: MissionState, action: MissionAction): MissionState {
  if (action.type === 'restart') return initialMissionState();
  if (action.type === 'start') return state.stage === 'intro' ? { ...state, stage: 'question' } : state;
  if (action.type === 'select-choice') {
    if (state.stage !== 'question' || state.nodeId === 'TRANSFER' || state.nodeId !== action.nodeId ||
      !choiceNodes[state.nodeId].options.some(option => option.id === action.choiceId)) return state;
    return { ...state, selection: action.choiceId };
  }
  if (action.type === 'select-transfer') {
    if (state.stage !== 'question' || state.nodeId !== 'TRANSFER') return state;
    return { ...state, transferPlan: selectTransfer(state.transferPlan, action.slotId, action.value) };
  }
  if (action.type === 'apply') {
    // The reducer is the synchronous commit boundary. Repeated submit events,
    // stale controls, and unchosen drafts cannot apply an answer twice.
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
      // Entering a repair consumes the only repair, even before it is answered.
      repairBudgetUsed: state.repairBudgetUsed || isRepair(target),
    };
  }
  return state;
}

export function recapStatus(nodeId: NodeId, answers: AnswerMap): 'Passend gewählt' | 'Mit Anleitung geübt' | 'Beispiel angesehen' {
  if (answers[nodeId]?.correct) return 'Passend gewählt';
  const repairId = nodeId === 'SHARE' ? 'SHARE_REPAIR' : nodeId === 'VERIFY' ? 'VERIFY_REPAIR' : null;
  return repairId && answers[repairId]?.correct ? 'Mit Anleitung geübt' : 'Beispiel angesehen';
}
