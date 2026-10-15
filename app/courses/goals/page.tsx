import type { Metadata } from 'next';
import CourseGoalsClient from './CourseGoalsClient';

export const metadata: Metadata = {
  title: 'Mein Lernziel | ForgeCommunity',
  description: 'Setze dir ein privates, freiwilliges Lernziel für abgeschlossene Kursinhalte.',
};

export default function CourseGoalsPage() {
  return <CourseGoalsClient />;
}
