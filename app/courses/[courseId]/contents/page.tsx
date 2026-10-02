'use client'

import { use } from 'react'
import { CourseContentsEditor } from './CourseContentsEditor'

export default function CourseContentsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  return <CourseContentsEditor key={courseId} courseId={courseId} />
}
