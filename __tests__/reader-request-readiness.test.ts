import type { Page, Request } from '@playwright/test'
import { observeReaderRequests } from '../e2e/reader-request-readiness'

class ReaderPage {
  address = 'http://127.0.0.1:3013/courses/course-one/contents'
  handlers = new Map<string, Array<(request: Request) => unknown>>()
  on(name: string, handler: (request: Request) => unknown) { this.handlers.set(name, [...(this.handlers.get(name) || []), handler]) }
  mainFrame() { return this }
  url() { return this.address }
  async emit(name: string, request: Request) { for (const handler of this.handlers.get(name) || []) await handler(request) }
}

function request(page: ReaderPage, path: string, status = 200, body: unknown = {}, navigation = false): Request {
  return { method: () => 'GET', url: () => `http://127.0.0.1:3013${path}`, isNavigationRequest: () => navigation,
    resourceType: () => navigation ? 'document' : 'fetch', frame: () => page,
    response: async () => ({ status: () => status, json: async () => body }),
  } as unknown as Request
}

async function finish(page: ReaderPage, path: string, status = 200, body: unknown = {}) {
  const read = request(page, path, status, body)
  await page.emit('request', read); await page.emit('requestfinished', read)
}

async function completeReads(page: ReaderPage, userId = 'learner-id') {
  await finish(page, '/api/auth/session', 200, { user: { id: userId } })
  await finish(page, '/api/courses/course-one/authoring', 403)
  await finish(page, '/api/courses/course-one', 200, { canEdit: false, activePublicationId: 'opaque-publication' })
  await finish(page, '/api/courses/course-one/contents', 200, [])
  await finish(page, '/api/courses/course-one/progress', 200, { publicationId: 'opaque-publication', canTrack: true, complete: false, hasCertificate: false })
  await finish(page, '/api/courses/course-one/practice/learner', 200, { status: 'off' })
}

it('requires the current authenticated learner and actual successful completed Reader reads', async () => {
  const page = new ReaderPage()
  const snapshot = observeReaderRequests(page as unknown as Page, ['course-one'], 'learner-id')
  await completeReads(page, 'someone-else')
  expect(snapshot().ready).toBe(false)
  await finish(page, '/api/auth/session', 200, {})
  expect(snapshot().ready).toBe(false)
  await finish(page, '/api/auth/session', 200, { user: { id: 'learner-id' } })
  expect(snapshot()).toMatchObject({ ready: true, active: [], certificateEnabled: false })
  expect(JSON.stringify(snapshot())).not.toMatch(/learner-id|opaque-publication|course-one/)
})

it('does not treat pending, failed, or foreign-course reads as readiness', async () => {
  const page = new ReaderPage()
  const snapshot = observeReaderRequests(page as unknown as Page, ['course-one'], 'learner-id')
  await completeReads(page)
  const pending = request(page, '/api/courses/course-one/practice/learner')
  await page.emit('request', pending)
  expect(snapshot()).toMatchObject({ ready: false, active: ['practice'] })
  await page.emit('requestfailed', pending)
  expect(snapshot().ready).toBe(false)
  await finish(page, '/api/courses/course-other/practice/learner')
  expect(snapshot().ready).toBe(false)
  await finish(page, '/api/courses/course-one/practice/learner')
  expect(snapshot().ready).toBe(true)
  await finish(page, '/api/courses/course-one/progress', 500)
  expect(snapshot().ready).toBe(false)
})

it('retains readiness for explicit same-document lesson selection but resets on document navigation', async () => {
  const page = new ReaderPage()
  const snapshot = observeReaderRequests(page as unknown as Page, ['course-one'], 'learner-id')
  await completeReads(page)
  page.address += '?content=selected-lesson'
  expect(snapshot().ready).toBe(true)
  await page.emit('request', request(page, '/courses/course-one/contents', 200, {}, true))
  expect(snapshot()).toMatchObject({ ready: false, epoch: 1 })
  await completeReads(page)
  await finish(page, '/api/courses/course-one/progress', 200, { publicationId: 'opaque-publication', canTrack: true, complete: true, hasCertificate: false })
  expect(snapshot()).toMatchObject({ ready: true, certificateEnabled: true })
})

it.each(['older-first', 'newer-first'] as const)('retains the latest issued status and progress flags with %s completion', async order => {
  for (const [oldStatus, newStatus] of [[200, 500], [500, 200], [200, 200]]) {
    const page = new ReaderPage()
    const snapshot = observeReaderRequests(page as unknown as Page, ['course-one'], 'learner-id')
    await completeReads(page)
    const older = request(page, '/api/courses/course-one/progress', oldStatus, { publicationId: 'old-opaque', canTrack: true, complete: false })
    const newer = request(page, '/api/courses/course-one/progress', newStatus, { publicationId: 'new-opaque', canTrack: true, complete: true })
    await page.emit('request', older); await page.emit('request', newer)
    const first = order === 'older-first' ? older : newer
    const last = order === 'older-first' ? newer : older
    await page.emit('requestfinished', first)
    expect(snapshot().ready).toBe(false) // Every still-pending relevant read counts.
    await page.emit('requestfinished', last)
    expect(snapshot().ready).toBe(newStatus === 200)
    expect(snapshot().certificateEnabled).toBe(newStatus === 200)
  }
})
