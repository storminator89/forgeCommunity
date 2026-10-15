'use client'

import { use } from 'react'
import { useSession } from 'next-auth/react'
import { CourseContentsEditor } from './CourseContentsEditor'

export default function CourseContentsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const { data, status } = useSession()
  const accountId = status === 'authenticated' ? data?.user?.id ?? null : null
  // Contents, editing drafts, and progress are viewer-specific. Remount before
  // another signed-in account can see the previous viewer's player state.
  return <CourseContentsEditor key={JSON.stringify([courseId, accountId])} courseId={courseId} />
}
