'use client'

import { use } from 'react'
import { useSession } from 'next-auth/react'
import { PracticeLearnerWorkspace } from './PracticeLearnerWorkspace'

export default function CourseLearnerPracticePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const { data, status } = useSession()
  const accountId = status === 'authenticated' ? data?.user?.id ?? null : null
  // Switching accounts remounts the private question and feedback state.
  return <PracticeLearnerWorkspace key={JSON.stringify([courseId, accountId])} courseId={courseId} sessionStatus={status} />
}
