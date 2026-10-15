import {
  authorTree, getPublicationReview, patchAuthorState, publishAuthorDraft,
  siblingIds, type AuthorPayload, type AuthorState,
} from '@/app/courses/[courseId]/contents/authoring-api'

const payload: AuthorPayload = {
  schemaVersion: 1, title: 'Werkstatt', description: 'Praxis', startDate: null, endDate: null, imageUrl: null,
  contents: [
    { id: 'a', parentId: null, title: 'A', type: 'TEXT', content: '<p>A</p>', order: 1 },
    { id: 'b', parentId: null, title: 'B', type: null, content: '', order: 2 },
    { id: 'c', parentId: 'a', title: 'C', type: 'QUIZ', content: '{"questions":[]}', order: 1 },
  ],
}
const state: AuthorState = { draft: { revision: 4, digest: 'draft-digest', payload }, activePublication: { id: 'published-1', sequence: 1, digest: 'live-digest' } }
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response

beforeEach(() => { global.fetch = jest.fn().mockResolvedValue(ok(state)) })

test('the private DTO becomes a nested editor tree without changing flat bytes or nullable legacy type', () => {
  const tree = authorTree(payload, 'course')
  expect(tree.map(node => node.id)).toEqual(['a', 'b'])
  expect(tree[0].subContents?.map(node => node.id)).toEqual(['c'])
  expect(tree[1].type).toBe('TEXT')
  expect(payload.contents[1].type).toBeNull()
  expect(tree[0].subContents?.[0].content).toBe('{"questions":[]}')
  expect(siblingIds(payload, null)).toEqual(['a', 'b'])
  expect(siblingIds(payload, null, 'a')).toEqual(['b'])
})

test('each author mutation sends exactly one typed CAS operation, never a live-content write', async () => {
  await patchAuthorState('course', 4, { kind: 'insertNode', node: { id: 'new', title: 'Neu', type: 'TEXT', content: '' }, parentId: 'a', afterId: 'c' })
  expect(fetch).toHaveBeenCalledWith('/api/courses/course/authoring', expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ expectedRevision: 4, operation: { kind: 'insertNode', node: { id: 'new', title: 'Neu', type: 'TEXT', content: '' }, parentId: 'a', afterId: 'c' } }),
  }))
})

test('review and publication bind both the saved revision and active publication', async () => {
  await getPublicationReview('course', state.draft, state.activePublication)
  expect(fetch).toHaveBeenCalledWith('/api/courses/course/authoring/review?expectedRevision=4&expectedActivePublicationId=published-1', expect.objectContaining({ cache: 'no-store' }))
  await publishAuthorDraft('course', state.draft, state.activePublication, 'request-1')
  expect(fetch).toHaveBeenCalledWith('/api/courses/course/authoring/publish', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ expectedRevision: 4, expectedActivePublicationId: 'published-1', requestId: 'request-1' }),
  }))
})

test('a stale revision reports 412 instead of silently overwriting another editor', async () => {
  ;(fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 412, json: async () => ({ error: 'stale' }) })
  await expect(patchAuthorState('course', 4, { kind: 'updateNode', id: 'a', patch: { title: 'Lokal' } })).rejects.toMatchObject({ status: 412 })
})
