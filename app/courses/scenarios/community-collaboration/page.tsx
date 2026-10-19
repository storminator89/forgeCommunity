import type { Metadata } from 'next';
import CommunityCollaborationClient from './CommunityCollaborationClient';

export const metadata: Metadata = {
  title: 'Sicher zusammenarbeiten | ForgeCommunity',
  description: 'Eine freiwillige Fallmission mit Entscheidungen und ihren Folgen.',
};

export default function CommunityCollaborationPage() {
  return <CommunityCollaborationClient />;
}
