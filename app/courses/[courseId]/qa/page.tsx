'use client'

import { use } from 'react'
import { useSession } from 'next-auth/react'
import { CourseQaWorkspace } from './CourseQaWorkspace'

export default function CourseQaPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params)
  const { data, status } = useSession()
  const accountId = status === 'authenticated' ? data?.user?.id ?? null : null
  return <CourseQaWorkspace key={JSON.stringify([courseId, accountId, data?.user?.role ?? null, status])} courseId={courseId} sessionStatus={status} />
}
