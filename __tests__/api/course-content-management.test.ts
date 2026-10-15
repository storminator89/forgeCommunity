import { GET as getLiveContents, POST as createLiveContent } from '@/app/api/courses/[courseId]/contents/route'
import { PUT as updateLiveContent, DELETE as deleteLiveContent } from '@/app/api/courses/[courseId]/contents/[contentId]/route'
import { PUT as reorderLiveContent } from '@/app/api/courses/[courseId]/contents/[contentId]/reorder/route'
import { PUT as moveLiveContent } from '@/app/api/courses/[courseId]/contents/[contentId]/move/route'
import { GET as getAuthoring, PATCH as saveDraft } from '@/app/api/courses/[courseId]/authoring/route'
import { groupCourseContents } from '@/lib/server/group-course-contents'
import { publicationDigest, type CoursePayload, type DraftNode } from '@/lib/server/course-authoring'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth/next'

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }))
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/server/rewards', () => ({ reconcileCourseRewards: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))
jest.mock('@/lib/server/request-body', () => ({ requestWithBodyLimit: async (request: Request) => request, RequestBodyLimitError: class extends Error {} }))
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  course: { findUnique: jest.fn() }, user: { findUnique: jest.fn() }, enrollment: { findUnique: jest.fn() },
  courseDraft: { findUnique: jest.fn(), update: jest.fn() }, coursePublication: { findUnique: jest.fn() },
  h5PContent: { findUnique: jest.fn() },
  courseContent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  courseContentProgress: { findMany: jest.fn() },
  $transaction: jest.fn(),
} }))

type LiveNode = DraftNode & { courseId: string; archivedAt?: Date | null }
const db = prisma as unknown as {
  course: { findUnique: jest.Mock }; user: { findUnique: jest.Mock }; enrollment: { findUnique: jest.Mock };
  courseDraft: { findUnique: jest.Mock; update: jest.Mock }; coursePublication: { findUnique: jest.Mock };
  h5PContent: { findUnique: jest.Mock };
  courseContent: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
  courseContentProgress: { findMany: jest.Mock };
  $transaction: jest.Mock;
}
const params = { params: Promise.resolve({ courseId: 'course-1' }) }
function contentParams(contentId: string) { return { params: Promise.resolve({ courseId: 'course-1', contentId }) } }
function request(body?: unknown) {
  return { url: 'http://localhost/api/courses/course-1/authoring', nextUrl: new URL('http://localhost/api/courses/course-1/authoring'),
    headers: { get: () => null }, json: async () => body } as never
}
function node(id: string, parentId: string | null = null, order = 1, extra: Partial<DraftNode> = {}): DraftNode {
  return { id, parentId, order, title: id, type: 'TEXT', content: '<p>Content</p>', ...extra }
}
function payload(contents: DraftNode[] = []): CoursePayload {
  return { schemaVersion: 1, title: 'Draft course', description: 'Description', startDate: null, endDate: null, imageUrl: null, contents }
}
let staged: { revision: number; payload: string; digest: string }
let live: LiveNode[]
let course: { id: string; instructorId: string; activePublicationId: string | null }
function setDraft(contents: DraftNode[]) {
  const value = payload(contents)
  staged = { revision: 0, payload: JSON.stringify(value), digest: publicationDigest(value) }
}
function draftContents() { return (JSON.parse(staged.payload) as CoursePayload).contents }
async function patch(operation: unknown, expectedRevision = staged.revision) {
  return saveDraft(request({ expectedRevision, operation }), params)
}
function insert(id: string, parentId: string | null = null, afterId: string | null = null, extra: Partial<DraftNode> = {}) {
  return { kind: 'insertNode', node: { id, title: id, type: 'TEXT', content: '<p>Content</p>', ...extra }, parentId, afterId }
}
function expectNoLiveWrites() {
  expect(db.courseContent.create).not.toHaveBeenCalled()
  expect(db.courseContent.update).not.toHaveBeenCalled()
  expect(db.courseContent.deleteMany).not.toHaveBeenCalled()
}
function publishLive() {
  db.coursePublication.findUnique.mockResolvedValue({ courseId: course.id, payload: JSON.stringify(payload(
    live.filter(item => !item.archivedAt).map(({ id, parentId, order, title, type, content }) =>
      ({ id, parentId, order, title, type, content, prerequisiteIds: [] })),
  )) })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'course-content-regression-test-secret'
  live = []
  course = { id: 'course-1', instructorId: 'teacher', activePublicationId: null }
  setDraft([])
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'teacher', role: 'INSTRUCTOR' } } as never)
  db.course.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === course.id ? { ...course } : null)
  db.user.findUnique.mockResolvedValue({ role: 'INSTRUCTOR' })
  db.enrollment.findUnique.mockResolvedValue(null)
  db.courseDraft.findUnique.mockImplementation(async () => ({ ...staged }))
  db.courseDraft.update.mockImplementation(async ({ data }: { data: { revision: { increment: number }; payload: string; digest: string } }) => {
    staged = { revision: staged.revision + data.revision.increment, payload: data.payload, digest: data.digest }
    return { ...staged }
  })
  db.coursePublication.findUnique.mockResolvedValue(null)
  db.courseContentProgress.findMany.mockResolvedValue([])
  db.h5PContent.findUnique.mockResolvedValue(null)
  db.courseContent.findMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] }; courseId?: string; archivedAt?: null } }) =>
    live.filter(item => (!where.id || where.id.in.includes(item.id)) && (!where.courseId || where.courseId === item.courseId) &&
      (where.archivedAt === undefined || item.archivedAt === null || item.archivedAt === undefined)).map(item => ({ ...item })))
  db.courseContent.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const found = live.find(item => item.id === where.id)
    return found ? { ...found, course: { instructorId: course.instructorId } } : null
  })
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db))
})

test('private draft and unpublished live course are invisible to anonymous users and learners', async () => {
  expect((await getAuthoring(request(), params)).status).toBe(200)
  jest.mocked(getServerSession).mockResolvedValue(null)
  expect((await getAuthoring(request(), params)).status).toBe(401)
  expect((await getLiveContents(request(), params)).status).toBe(401)
  expect((await patch(insert('private-1'))).status).toBe(401)
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'student', role: 'USER' } } as never)
  db.user.findUnique.mockResolvedValue({ role: 'USER' })
  expect((await getAuthoring(request(), params)).status).toBe(403)
  expect((await getLiveContents(request(), params)).status).toBe(404)
  db.enrollment.findUnique.mockResolvedValue({ id: 'enrollment' })
  expect((await getLiveContents(request(), params)).status).toBe(404)
  expect((await patch(insert('private-1'))).status).toBe(403)
  expect(staged.revision).toBe(0)
  expectNoLiveWrites()
})

test('enrolled learners read only active live contents and cannot read the private draft', async () => {
  course.activePublicationId = 'publication-1'
  live = [{ ...node('live-node'), courseId: 'course-1' }, { ...node('archived-node'), courseId: 'course-1', archivedAt: new Date() }]
  publishLive()
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'student', role: 'USER' } } as never)
  db.user.findUnique.mockResolvedValue({ role: 'USER' })
  expect((await getLiveContents(request(), params)).status).toBe(403)
  db.enrollment.findUnique.mockResolvedValue({ id: 'enrollment' })
  const response = await getLiveContents(request(), params)
  expect(response.status).toBe(200)
  expect((await response.json()).map((item: DraftNode) => item.id)).toEqual(['live-node'])
  expect((await getAuthoring(request(), params)).status).toBe(403)
})

test('typed insertion validates IDs and node types before saving', async () => {
  for (const operation of [insert('x'), insert('valid-id', null, null, { type: ['TEXT'] as never }),
    insert('valid-id', 'missing-parent'), insert('valid-id', null, 'missing-after')]) {
    expect([400, 404]).toContain((await patch(operation)).status)
  }
  expect(staged.revision).toBe(0)
  expectNoLiveWrites()
})

test('draft insertion orders siblings while leaving published rows untouched', async () => {
  setDraft([node('first-id'), node('second-id', null, 2)])
  live = [{ ...node('live-node'), courseId: 'course-1' }]
  const response = await patch(insert('inserted-id', null, 'first-id'))
  expect(response.status).toBe(200)
  expect((await response.json()).draft.revision).toBe(1)
  expect(draftContents().map(item => [item.id, item.order])).toEqual([
    ['first-id', 1], ['second-id', 3], ['inserted-id', 2],
  ])
  expect(live.map(item => item.id)).toEqual(['live-node'])
  expectNoLiveWrites()
})

test('stale draft revision refuses to overwrite a newer author save', async () => {
  expect((await patch(insert('first-id'))).status).toBe(200)
  expect((await patch(insert('second-id'), 0)).status).toBe(412)
  expect(staged.revision).toBe(1)
  expect(draftContents().map(item => item.id)).toEqual(['first-id'])
  expectNoLiveWrites()
})

test('quiz stays a typed private draft until publication, without writing TEXT storage', async () => {
  const response = await patch(insert('quiz-node', null, null, { type: 'QUIZ', content: '{"questions":[]}' }))
  expect(response.status).toBe(200)
  expect(draftContents()[0]).toMatchObject({ type: 'QUIZ', content: '{"questions":[]}' })
  expectNoLiveWrites()
  expect((await getLiveContents(request(), params)).status).toBe(200)
  expect(await (await getLiveContents(request(), params)).json()).toEqual([])
  expect((await patch({ kind: 'updateNode', id: 'quiz-node', patch: { content: '{"questions":[]}' } })).status).toBe(200)
})

test('draft updates preserve unspecified fields and reject descendant moves', async () => {
  setDraft([node('root-node'), node('child-node', 'root-node')])
  expect((await patch({ kind: 'updateNode', id: 'root-node', patch: { title: 'Renamed' } })).status).toBe(200)
  expect(draftContents()[0]).toMatchObject({ title: 'Renamed', content: '<p>Content</p>', parentId: null })
  expect((await patch({ kind: 'moveNode', id: 'root-node', parentId: 'child-node', afterId: null })).status).toBe(400)
  expect((await patch({ kind: 'moveNode', id: 'root-node', parentId: 'foreign-node', afterId: null })).status).toBe(404)
  expect(draftContents()[0].parentId).toBeNull()
  expectNoLiveWrites()
})

test('moving across parents preserves descendants and normalizes both sibling sets', async () => {
  setDraft([node('root-node'), node('target-node', null, 2), node('moved-node', 'root-node', 1),
    node('old-sibling', 'root-node', 2), node('grandchild', 'moved-node'), node('target-child', 'target-node')])
  expect((await patch({ kind: 'moveNode', id: 'moved-node', parentId: 'target-node', afterId: 'target-child' })).status).toBe(200)
  expect(draftContents().find(item => item.id === 'moved-node')).toMatchObject({ parentId: 'target-node', order: 2 })
  expect(draftContents().find(item => item.id === 'old-sibling')?.order).toBe(1)
  expect(draftContents().find(item => item.id === 'grandchild')?.parentId).toBe('moved-node')
  expectNoLiveWrites()
})

test('moving a root sibling changes the authoritative draft order', async () => {
  setDraft([node('first-id'), node('second-id', null, 2), node('child-id', 'second-id')])
  expect((await patch({ kind: 'moveNode', id: 'second-id', parentId: null, afterId: null })).status).toBe(200)
  expect(draftContents().filter(item => item.parentId === null).sort((a, b) => a.order - b.order)
    .map(item => item.id)).toEqual(['second-id', 'first-id'])
  expect(draftContents().find(item => item.id === 'child-id')?.parentId).toBe('second-id')
})

test('deleting a nested draft branch leaves live learning evidence and normalizes siblings', async () => {
  setDraft([node('root-node'), node('child-node', 'root-node'), node('grandchild', 'child-node'), node('other-node', null, 2)])
  live = [{ ...node('root-node'), courseId: 'course-1' }]
  expect((await patch({ kind: 'deleteNode', id: 'root-node' })).status).toBe(200)
  expect(draftContents()).toEqual([expect.objectContaining({ id: 'other-node', order: 1 })])
  expect(live).toHaveLength(1)
  expectNoLiveWrites()
})

test('corrupt cyclic saved hierarchy cannot be changed into a partial new draft', async () => {
  setDraft([node('first-id', 'second-id'), node('second-id', 'first-id')])
  expect((await patch(insert('third-id'))).status).toBe(400)
  expect(staged.revision).toBe(0)
  expect(draftContents()).toHaveLength(2)
})

test('tree grouping keeps orphan and cyclic legacy records visible without recursion', () => {
  const grouped = groupCourseContents([node('last-id', null, 9), node('second-id', 'first-id'), node('first-id', 'second-id'),
    node('child-id', 'first-id'), node('orphan-id', 'gone-id', 3)])
  expect(grouped.map(item => item.id)).toEqual(['first-id', 'second-id', 'orphan-id', 'last-id'])
  expect(grouped[0].subContents[0].id).toBe('child-id')
  expect(() => JSON.stringify(grouped)).not.toThrow()
})

test('legacy nullable published content is presented as rich text without rewriting storage', async () => {
  course.activePublicationId = 'publication-1'
  live = [{ ...node('legacy-node', null, 1, { type: null }), courseId: 'course-1' }]
  publishLive()
  const response = await getLiveContents(request(), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([expect.objectContaining({ type: 'TEXT' })])
  expect(live[0].type).toBeNull()
  expectNoLiveWrites()
})

test('cross-course content IDs cannot enter a draft even for an administrator', async () => {
  live = [{ ...node('foreign-node'), courseId: 'course-2' }]
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } } as never)
  db.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
  expect((await patch(insert('foreign-node'))).status).toBe(409)
  expect(staged.revision).toBe(0)
  expectNoLiveWrites()
})

test('serialization conflicts retry and exhausted retries preserve the draft', async () => {
  const conflict = new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' })
  db.$transaction.mockRejectedValueOnce(conflict)
  expect((await patch(insert('new-node'))).status).toBe(200)
  expect(db.$transaction).toHaveBeenCalledTimes(2)
  expect(staged.revision).toBe(1)
  db.$transaction.mockClear().mockRejectedValue(conflict)
  expect((await patch(insert('other-node'))).status).toBe(409)
  expect(db.$transaction).toHaveBeenCalledTimes(4)
  expect(draftContents().map(item => item.id)).toEqual(['new-node'])
})

test('media sources preserve safe URL queries and reject script URLs in drafts', async () => {
  setDraft([node('audio-node', null, 1, { type: 'AUDIO', content: '' }), node('h5p-node', null, 2, { type: 'H5P', content: '' })])
  const audio = 'https://soundcloud.com/artist/track?token=a&expires=123'
  expect((await patch({ kind: 'updateNode', id: 'audio-node', patch: { content: audio } })).status).toBe(200)
  expect(draftContents()[0].content).toBe(audio)
  const embed = '<iframe src="https://example.org/h5p/embed/12?token=a&expires=123" onload="alert(1)"></iframe>'
  expect((await patch({ kind: 'updateNode', id: 'h5p-node', patch: { content: embed } })).status).toBe(200)
  expect(draftContents()[1].content).toBe('https://example.org/h5p/embed/12?token=a&expires=123')
  expect((await patch({ kind: 'updateNode', id: 'audio-node', patch: { content: 'javascript:alert(1)' } })).status).toBe(400)
  expect((await patch({ kind: 'updateNode', id: 'h5p-node', patch: { content: '<iframe src="javascript:alert(1)"></iframe>' } })).status).toBe(400)
  expectNoLiveWrites()
})

test('local H5P attachment requires an imported package owned by the editor', async () => {
  setDraft([node('h5p-node', null, 1, { type: 'H5P', content: '' })])
  expect((await patch({ kind: 'updateNode', id: 'h5p-node', patch: { content: '/h5p/embed/missing' } })).status).toBe(400)
  db.h5PContent.findUnique.mockResolvedValue({ userId: 'someone-else' })
  expect((await patch({ kind: 'updateNode', id: 'h5p-node', patch: { content: 'http://localhost/h5p/embed/foreign' } })).status).toBe(403)
  expect(staged.revision).toBe(0)
  db.h5PContent.findUnique.mockResolvedValue({ userId: 'teacher' })
  expect((await patch({ kind: 'updateNode', id: 'h5p-node', patch: { content: 'owned' } })).status).toBe(200)
  expect(draftContents()[0].content).toBe('/h5p/embed/owned')
  expectNoLiveWrites()
})

test('legacy direct live-content endpoints reject writes, including valid instructor requests', async () => {
  live = [{ ...node('live-node'), courseId: 'course-1' }]
  for (const response of [
    await createLiveContent(request({ title: 'New' }), params),
    await updateLiveContent(request({ title: 'Renamed' }), contentParams('live-node')),
    await deleteLiveContent(request(), contentParams('live-node')),
    await reorderLiveContent(request({ mainContentId: null, direction: 'up' }), contentParams('live-node')),
    await moveLiveContent(request({ targetId: 'other-node', position: 'after' }), contentParams('live-node')),
  ]) expect(response.status).toBe(409)
  expect(live[0].title).toBe('live-node')
  expectNoLiveWrites()
})
