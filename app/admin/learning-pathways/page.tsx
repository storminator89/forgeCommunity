import type { Metadata } from 'next';
import LearningPathwaysAdmin from './LearningPathwaysAdmin';

export const metadata: Metadata = {
  title: 'Lernpfade verwalten | ForgeCommunity',
  description: 'Private Lernpfade aus freigegebenen Kursen erstellen.',
};

export default function LearningPathwaysAdminPage() {
  return <LearningPathwaysAdmin />;
}
