import type { Metadata } from 'next';
import PathwaysClient from '../PathwaysClient';

export const metadata: Metadata = {
  title: 'Mein Lernpfad | ForgeCommunity',
  description: 'Dein privater Fortschritt in einem freiwilligen Lernpfad.',
};

export default async function PathwayPage({ params }: { params: Promise<{ pathwayId: string }> }) {
  const { pathwayId } = await params;
  return <PathwaysClient pathwayId={pathwayId} />;
}
