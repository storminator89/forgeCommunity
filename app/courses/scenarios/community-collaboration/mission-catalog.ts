import { choiceNodes, mainStations, transfer, transferSlots } from './community-collaboration-content';
import { incidentResponseMission } from './incident-response-content';
import type { MissionDefinition, MissionId } from './mission-definition';

// Author-controlled static allowlist. Paths carry topic identity only, never
// decisions, account identifiers, answers, completion or resume information.
const communityCollaborationMission = {
  id: 'community-collaboration', version: 1, key: 'community-collaboration@1',
  href: '/courses/scenarios/community-collaboration',
  title: 'Sicher zusammenarbeiten', cardTitle: 'Teamarbeit', category: 'Zusammenarbeit',
  summary: 'Informationen teilen. Hilfe prüfen. Zugriff begrenzen.', startLabel: 'Mission starten',
  introLead: 'Vier kurze Situationen. Deine Entscheidungen verändern die Simulation.',
  introDiagram: ['Information', 'Person', 'Zugriff'],
  takeaway: 'Ein hilfreicher Check: Welche Information, für wen, mit welchem Zugriff?',
  simulationNote: 'Nur Simulation. Es wird nichts gepostet, versendet oder freigegeben.',
  visual: 'collaboration', choiceNodes, mainStations, transfer, transferSlots,
  transferReferenceTitle: 'Passender Freigabeplan',
  transferExampleTitle: 'Beispiel für einen passenden Freigabeplan',
  transferReference: ['Aufgabe und Uhrzeit', 'Benannte helfende Person', 'Lesen'],
  transferFitLabel: 'Passt zum Auftrag', equalRiskNodes: ['SHARE', 'VERIFY'],
} as const satisfies MissionDefinition;

const missions: Readonly<Record<MissionId, MissionDefinition>> = Object.freeze({
  'community-collaboration': communityCollaborationMission,
  'incident-response': incidentResponseMission,
});

export const availableMissions: readonly MissionDefinition[] = Object.freeze([
  missions['community-collaboration'], missions['incident-response'],
]);

export function getMission(id: MissionId): MissionDefinition {
  return missions[id];
}
