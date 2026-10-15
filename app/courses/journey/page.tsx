import type { Metadata } from 'next';
import JourneyClient from './JourneyClient';

export const metadata: Metadata = {
  title: 'Mein Lernweg | ForgeCommunity',
  description: 'Dein aktueller Kursfortschritt und der nächste mögliche Lernschritt.',
};

export default function JourneyPage() {
  return <JourneyClient />;
}
