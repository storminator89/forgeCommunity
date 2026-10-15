'use client'

import { use } from 'react'
import { useSession } from 'next-auth/react'
import { GradingClient } from './GradingClient'

export default function GradingPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const { data, status } = useSession()
  // A different login must remount the private grading list before it renders.
  return <GradingClient key={JSON.stringify([courseId, status === 'authenticated' ? data?.user?.id : null])} courseId={courseId} sessionStatus={status} />
}
