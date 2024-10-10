import { Metadata } from 'next'
import CourseClient from './CourseClient'

export const metadata: Metadata = {
  title: 'Kurse | ForgeCommunity',
  description: 'Entdecke und nimm teil an unseren vielfältigen Online-Kursen.',
}

export default function CoursesPage() {
  return <CourseClient />
}