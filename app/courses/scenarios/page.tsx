import type { Metadata } from 'next';
import { ScenarioClient } from './community-collaboration/CommunityCollaborationClient';

export const metadata: Metadata = {
  title: 'Fall wählen | ForgeCommunity',
  description: 'Freiwillige Fallmissionen zum sicheren Entscheiden.',
};

export default function ScenariosPage() {
  return <ScenarioClient />;
}
