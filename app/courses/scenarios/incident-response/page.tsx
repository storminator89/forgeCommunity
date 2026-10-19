import type { Metadata } from 'next';
import { ScenarioClient } from '../community-collaboration/CommunityCollaborationClient';

export const metadata: Metadata = {
  title: 'Schadsoftware eindämmen | ForgeCommunity',
  description: 'Eine freiwillige Fallmission zu Eingrenzung, Meldung und sicherem Weiterarbeiten.',
};

export default function IncidentResponsePage() {
  return <ScenarioClient missionId="incident-response" />;
}
