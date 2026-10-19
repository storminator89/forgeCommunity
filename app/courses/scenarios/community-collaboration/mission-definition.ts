import type { ChoiceNode, ChoiceNodeId, MainNodeId, NodeId, RepairNodeId, TransferSlotId } from './community-collaboration-content';

// Stable internal station/slot protocol shared by exactly two authored missions.
// SHARE/VERIFY/ACCESS mean first/second/third here, not cross-mission answers.
// Every runtime, answer commit and comparison is fenced by mission key + run.
export type { ChoiceNodeId, MainNodeId, NodeId, RepairNodeId, TransferSlotId };
export type MissionId = 'community-collaboration' | 'incident-response';
export type MissionKey = `${MissionId}@${number}`;
export type TransferPlan = Record<TransferSlotId, string | null>;
export type CompleteTransferPlan = Record<TransferSlotId, string>;
export type TransferSlot = Readonly<{
  id: TransferSlotId;
  label: string;
  correctValue: string;
  options: readonly Readonly<{ id: string; label: string; consequence?: string }>[];
  correction: string;
}>;
export type MissionDefinition = Readonly<{
  id: MissionId;
  version: number;
  key: MissionKey;
  href: '/courses/scenarios/community-collaboration' | '/courses/scenarios/incident-response';
  title: string;
  cardTitle: string;
  category: string;
  summary: string;
  startLabel: string;
  introLead: string;
  introDiagram: readonly [string, string, string];
  takeaway: string;
  simulationNote: string;
  visual: 'collaboration' | 'containment';
  choiceVisuals?: Readonly<Record<ChoiceNodeId, Readonly<{ before: string; outcomes: Readonly<Record<string, string>> }>>>;
  choiceNodes: Readonly<Record<ChoiceNodeId, ChoiceNode>>;
  mainStations: readonly Readonly<{ id: MainNodeId; label: string; recap: string }>[];
  transfer: Readonly<{ title: string; situation: string; prompt: string; feedback: string }>;
  transferSlots: readonly TransferSlot[];
  transferReferenceTitle: string;
  transferExampleTitle: string;
  transferReference: readonly [string, string, string];
  transferFitLabel: string;
  equalRiskNodes: readonly Exclude<MainNodeId, 'TRANSFER'>[];
  sources?: readonly Readonly<{ title: string; href: string }>[];
}>;
