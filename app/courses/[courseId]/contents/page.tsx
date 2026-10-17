'use client'

import { use } from 'react'
import { useSession } from '@/lib/sites-auth/react'
import { CourseWorkspaceRoute } from './CourseWorkspaceRoute'

export default function CourseContentsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const { data, status } = useSession()
  const accountId = status === 'authenticated' ? data?.user?.id ?? null : null
  // Private drafts and learner progress are account-specific. A changed login
  // always remounts and re-authorizes before any previous account data renders.
  const canAuthorPractice = data?.user?.role === 'INSTRUCTOR' || data?.user?.role === 'ADMIN'
  return <CourseWorkspaceRoute key={JSON.stringify([courseId, accountId])} courseId={courseId} status={status} canAuthorPractice={canAuthorPractice} />
}
