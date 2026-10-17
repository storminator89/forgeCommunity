import type { Page, Request } from '@playwright/test'

type Family = 'session' | 'authoring' | 'course' | 'contents' | 'progress' | 'practice'
type Read = { family: Family; status: number; finishedAt: number; authenticated?: boolean; learner?: boolean; publication?: boolean; canTrack?: boolean; complete?: boolean; hasCertificate?: boolean; canIssueCertificate?: boolean }

// Observe the application's own reads. No extra fetches, credentials or DTOs are
// emitted: only route families, completion times and safe readiness flags.
export function observeReaderRequests(page: Page, courseIds: string[], expectedUserId: string) {
  const courses = new Set(courseIds)
  let epoch = 0
  let sequence = 0
  const pending = new Map<Request, { epoch: number; generation: number; courseId: string; family: Family }>()
  const completed = new Map<string, Read>()
  const latestIssued = new Map<string, number>()
  const classify = (request: Request) => {
    if (request.method() !== 'GET') return null
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/session') return { courseId: '', family: 'session' as const }
    const match = path.match(/^\/api\/courses\/([^/]+)(?:\/(authoring|contents|progress|practice\/learner))?$/)
    if (!match || !courses.has(decodeURIComponent(match[1]))) return null
    const family = match[2] === 'practice/learner' ? 'practice' : match[2] || 'course'
    return { courseId: decodeURIComponent(match[1]), family: family as Family }
  }
  page.on('request', request => {
    if (request.isNavigationRequest() && request.resourceType() === 'document' && request.frame() === page.mainFrame()) {
      epoch++; completed.clear(); pending.clear(); latestIssued.clear()
    }
    const read = classify(request)
    if (read) {
      sequence++; latestIssued.set(`${read.courseId}:${read.family}`, sequence)
      pending.set(request, { ...read, epoch, generation: sequence })
    }
  })
  page.on('requestfinished', async request => {
    const read = pending.get(request)
    if (!read) return
    try {
      const response = await request.response()
      if (!response || read.epoch !== epoch) return
      const result: Read = { family: read.family, status: response.status(), finishedAt: Date.now() }
      if (response.status() === 200 && ['session', 'course', 'progress'].includes(read.family)) {
        const body = await response.json()
        if (read.family === 'session') result.authenticated = body?.user?.id === expectedUserId
        if (read.family === 'course') { result.learner = body?.canEdit === false; result.publication = Boolean(body?.activePublicationId) }
        if (read.family === 'progress') {
          result.publication = Boolean(body?.publicationId)
          result.canTrack = body?.canTrack === true
          result.complete = body?.complete === true
          result.hasCertificate = body?.hasCertificate === true
          result.canIssueCertificate = body?.canIssueCertificate !== false
        }
      }
      if (read.epoch === epoch && latestIssued.get(`${read.courseId}:${read.family}`) === read.generation) completed.set(`${read.courseId}:${read.family}`, result)
    } catch {
      if (read.epoch === epoch && latestIssued.get(`${read.courseId}:${read.family}`) === read.generation) completed.set(`${read.courseId}:${read.family}`, { family: read.family, status: 0, finishedAt: Date.now() })
    } finally { pending.delete(request) }
  })
  page.on('requestfailed', request => {
    const read = pending.get(request)
    if (read?.epoch === epoch && latestIssued.get(`${read.courseId}:${read.family}`) === read.generation) completed.set(`${read.courseId}:${read.family}`, { family: read.family, status: 0, finishedAt: Date.now() })
    pending.delete(request)
  })
  return () => {
    const courseId = decodeURIComponent(new URL(page.url()).pathname.match(/^\/courses\/([^/]+)\/contents$/)?.[1] || '')
    const families: Family[] = ['session', 'authoring', 'course', 'contents', 'progress', 'practice']
    const reads = families.map(family => completed.get(`${family === 'session' ? '' : courseId}:${family}`) ?? { family, status: null })
    const byFamily = Object.fromEntries(reads.map(read => [read.family, read])) as Partial<Record<Family, Read>>
    const active = [...pending.values()].filter(read => read.epoch === epoch && (!read.courseId || read.courseId === courseId)).map(read => read.family)
    const progress = byFamily.progress
    return { epoch, sequence, active, reads,
      ready: courses.has(courseId) && active.length === 0 && byFamily.session?.status === 200 && byFamily.session.authenticated === true &&
        [403, 404].includes(byFamily.authoring?.status ?? 0) && byFamily.course?.status === 200 && byFamily.course.learner === true && byFamily.course.publication === true &&
        byFamily.contents?.status === 200 && progress?.status === 200 && progress.canTrack === true && progress.publication === true && byFamily.practice?.status === 200,
      certificateEnabled: Boolean(progress?.hasCertificate || (progress?.canTrack && progress.complete && progress.canIssueCertificate)),
    }
  }
}

export type ReaderReadiness = ReturnType<typeof observeReaderRequests>
