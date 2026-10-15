import { GET } from '@/app/api/search/route'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth'

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findMany: jest.fn(), count: jest.fn() },
    course: { findMany: jest.fn(), count: jest.fn() },
    event: { findMany: jest.fn(), count: jest.fn() },
    post: { findMany: jest.fn(), count: jest.fn() },
    resource: { findMany: jest.fn(), count: jest.fn() },
    article: { findMany: jest.fn(), count: jest.fn() },
    project: { findMany: jest.fn(), count: jest.fn() },
    skill: { findMany: jest.fn(), count: jest.fn() },
  },
}))

const articleFindMany = prisma.article.findMany as jest.Mock
const articleCount = prisma.article.count as jest.Mock
const projectFindMany = prisma.project.findMany as jest.Mock
const projectCount = prisma.project.count as jest.Mock

function request(query: string, type = 'all', page = 1, limit = 10) {
  return { nextUrl: new URL(`http://localhost/api/search?query=${encodeURIComponent(query)}&type=${type}&page=${page}&limit=${limit}`) } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'viewer', role: 'USER' } } as never)
  for (const model of [prisma.user, prisma.course, prisma.event, prisma.post, prisma.resource, prisma.article, prisma.project, prisma.skill]) {
    (model.findMany as jest.Mock).mockResolvedValue([]);
    (model.count as jest.Mock).mockResolvedValue(0);
  }
})

it('excludes draft articles from typed matches and counts, with safe preview and pagination', async () => {
  const records = [
    { id: 'draft', title: 'Private guide', content: '<p>Private draft text</p>', isPublished: false, category: 'Internal', author: { name: 'Ada' }, tags: [], createdAt: new Date('2026-02-01') },
    { id: 'public', title: 'Public guide', content: '<p>Safe <strong>article</strong></p><img src=x onerror="alert(1)">', isPublished: true, category: 'Guides', author: { name: 'Ada' }, tags: [{ name: 'Help' }], createdAt: new Date('2026-01-01') },
  ]
  articleFindMany.mockImplementation(async ({ where }: { where: { isPublished: boolean } }) => records.filter(record => record.isPublished === where.isPublished))
  articleCount.mockImplementation(async ({ where }: { where: { isPublished: boolean } }) => records.filter(record => record.isPublished === where.isPublished).length)

  const response = await GET(request('guide', 'article', 1, 10))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.results).toHaveLength(1)
  expect(body.results[0]).toMatchObject({ id: 'public', type: 'article', title: 'Public guide', category: 'Guides', tags: ['Help'] })
  expect(body.results[0].description).toBe('Safe article')
  expect(JSON.stringify(body)).not.toContain('Private draft text')
  expect(articleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isPublished: true }), skip: 0, take: 10 }))
  expect(articleCount).toHaveBeenCalledWith({ where: articleFindMany.mock.calls[0][0].where })
  expect(articleFindMany.mock.calls[0][0].select.author.select).toEqual({ name: true })
  expect(body.pagination).toEqual({ total: 1, page: 1, limit: 10, pages: 1 })
  expect(projectFindMany).not.toHaveBeenCalled()
})

it('returns only public project fields and a sanitized project preview with a typed count', async () => {
  projectFindMany.mockResolvedValue([{
    id: 'project-1', title: 'Community project', description: '<p>Public <em>project</em></p><script>alert(1)</script>',
    category: 'Design', author: { name: 'Ben' }, tags: [{ name: 'Team' }], createdAt: new Date('2026-03-01'),
  }])
  projectCount.mockResolvedValue(12)

  const response = await GET(request('project', 'project', 2, 10))
  const body = await response.json()

  expect(body.results).toHaveLength(1)
  expect(body.results[0]).toMatchObject({ id: 'project-1', type: 'project', category: 'Design', tags: ['Team'] })
  expect(body.results[0].description).toBe('Public project')
  expect(body.pagination).toEqual({ total: 12, page: 2, limit: 10, pages: 2 })
  expect(projectFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }))
  expect(projectFindMany.mock.calls[0][0].select).not.toHaveProperty('link')
  expect(projectFindMany.mock.calls[0][0].select).not.toHaveProperty('likes')
  expect(articleFindMany).not.toHaveBeenCalled()
})

it('keeps All bounded to five hits per new type and never includes drafts', async () => {
  articleFindMany.mockImplementation(async ({ where, take }: { where: { isPublished: boolean }; take: number }) =>
    Array.from({ length: 8 }, (_, index) => ({
      id: `article-${index}`, title: `Article ${index}`, content: 'Public', category: 'Guides', isPublished: index !== 0,
      author: { name: 'Ada' }, tags: [], createdAt: new Date(`2026-01-${String(index + 1).padStart(2, '0')}`),
    })).filter(article => article.isPublished === where.isPublished).slice(0, take))
  projectFindMany.mockImplementation(async ({ take }: { take: number }) => Array.from({ length: take }, (_, index) => ({
    id: `project-${index}`, title: `Project ${index}`, description: 'Public', category: null,
    author: { name: 'Ben' }, tags: [], createdAt: new Date('2026-02-01'),
  })))

  const body = await (await GET(request('public'))).json()
  expect(body.results).toHaveLength(10)
  expect(body.results.filter((result: { type: string }) => result.type === 'article')).toHaveLength(5)
  expect(body.results.filter((result: { type: string }) => result.type === 'project')).toHaveLength(5)
  expect(JSON.stringify(body)).not.toContain('article-0')
  expect(articleFindMany.mock.calls[0][0]).toMatchObject({ where: { isPublished: true }, skip: 0, take: 5 })
  expect(projectFindMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 5 })
  expect(body.pagination).toEqual({ total: 0, page: 1, limit: 10, pages: 0 })
  expect(articleCount).not.toHaveBeenCalled()
  expect(projectCount).not.toHaveBeenCalled()
})

it('does not query content for unauthenticated requests or short queries', async () => {
  jest.mocked(getServerSession).mockResolvedValueOnce(null)
  expect((await GET(request('guide', 'article'))).status).toBe(401)
  expect((await (await GET(request('x', 'project'))).json()).results).toEqual([])
  expect(articleFindMany).not.toHaveBeenCalled()
  expect(projectFindMany).not.toHaveBeenCalled()
})
