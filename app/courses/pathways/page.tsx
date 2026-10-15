import type { Metadata } from 'next';
import PathwaysClient from './PathwaysClient';

export const metadata: Metadata = {
  title: 'Lernpfade | ForgeCommunity',
  description: 'Entdecke freiwillige, private Lernpfade aus Kursen der Community.',
};

export default function PathwaysPage() {
  return <PathwaysClient />;
}
