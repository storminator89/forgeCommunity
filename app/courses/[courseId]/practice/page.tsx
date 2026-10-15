'use client'

import { use, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { PracticeAuthorWorkspace } from './PracticeAuthorWorkspace'

export default function CoursePracticePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const router = useRouter()
  const { data, status } = useSession()
  useEffect(() => {
    if (status === 'unauthenticated') router.replace(`/login?callbackUrl=${encodeURIComponent(`/courses/${courseId}/practice`)}`)
  }, [courseId, router, status])
  const accountId = status === 'authenticated' ? data?.user?.id ?? null : null
  return <PracticeAuthorWorkspace key={JSON.stringify([courseId, accountId])} courseId={courseId} sessionStatus={status} />
}
