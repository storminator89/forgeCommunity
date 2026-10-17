'use client'

import { use, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { CourseQaLessonContextPair } from '@/lib/course-qa-context-contract'
import { CourseQaWorkspace } from './CourseQaWorkspace'

type SearchParams = { [key: string]: string | string[] | undefined }
const emptySearchParams = Promise.resolve<SearchParams>({})
const idPattern = /^[A-Za-z0-9_-]{1,100}$/

// Keep course authority across a lesson-scope remount, but never across accounts.
function AccountWorkspace({ courseId, sessionStatus, search }: { courseId: string; sessionStatus: string; search: SearchParams }) {
  const [courseDenial, setCourseDenial] = useState<string | null>(null)
  const active = useRef(true)
  useLayoutEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const onCourseAccessDenied = useCallback((message: string) => { if (active.current) setCourseDenial(message) }, [])
  const publicationId = search.publicationId
  const contentId = search.contentId
  const hasPair = publicationId !== undefined || contentId !== undefined
  const validPair = typeof publicationId === 'string' && idPattern.test(publicationId) && typeof contentId === 'string' && idPattern.test(contentId)
  const lessonContext = useMemo<CourseQaLessonContextPair | null>(() => validPair ? { publicationId, contentId } : null, [validPair, publicationId, contentId])
  const invalidLessonScope = hasPair && !validPair
  return <CourseQaWorkspace key={JSON.stringify([courseId, lessonContext, invalidLessonScope])} courseId={courseId} sessionStatus={sessionStatus}
    lessonContext={lessonContext} invalidLessonScope={invalidLessonScope} openComposer={search.ask === '1'}
    courseDenial={courseDenial} onCourseAccessDenied={onCourseAccessDenied} onRetryCourseAccess={() => setCourseDenial(null)} />
}

export default function CourseQaPage({ params, searchParams = emptySearchParams }: { params: Promise<{ courseId: string }>; searchParams?: Promise<SearchParams> }) {
  const { courseId } = use(params)
  const search = use(searchParams)
  const { data, status } = useSession()
  const accountId = status === 'authenticated' ? data?.user?.id ?? null : null
  return <AccountWorkspace key={JSON.stringify([courseId, accountId, data?.user?.role ?? null, status])} courseId={courseId} sessionStatus={status} search={search} />
}
