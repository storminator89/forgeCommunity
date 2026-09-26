import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'
import { RequestBodyLimitError, requestWithBodyLimit } from '@/lib/server/request-body'
import { GET as getResources } from '@/app/api/resources/route'
import prisma from '@/lib/prisma'
import { POST as createProjectComment } from '@/app/api/projects/[projectId]/comments/route'
import { getServerSession } from 'next-auth/next'

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}))
jest.mock('@/lib/server/request-body', () => ({
  RequestBodyLimitError: class RequestBodyLimitError extends Error {},
  requestWithBodyLimit: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    resource: { findMany: jest.fn(), count: jest.fn() },
    project: { findUnique: jest.fn() },
    projectComment: { create: jest.fn() },
  },
}))
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))

describe('JSON and resource input boundaries', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each(['null', '[]', '"text"', '{'])('rejects a non-object or malformed JSON body: %s', async (raw) => {
    ;(requestWithBodyLimit as jest.Mock).mockResolvedValue({ json: () => JSON.parse(raw) })
    await expect(readJsonObject({} as Request)).rejects.toMatchObject({ name: 'InvalidJsonBodyError' })
  })

  it('passes the byte cap to the stream reader and distinguishes oversized bodies', async () => {
    ;(requestWithBodyLimit as jest.Mock).mockRejectedValue(new RequestBodyLimitError())
    let error: unknown
    try { await readJsonObject({} as Request, 1024) } catch (caught) { error = caught }
    expect(requestWithBodyLimit).toHaveBeenCalledWith(expect.anything(), 1024)
    expect(requestErrorResponse(error)?.status).toBe(413)
  })

  it.each(['0', '-1', '2abc', '999999999999999999999', '101'])('rejects invalid or excessive resource limits: %s', async (limit) => {
    const response = await getResources(new Request(`http://localhost/api/resources?limit=${limit}`))
    expect(response.status).toBe(400)
    expect(prisma.resource.findMany).not.toHaveBeenCalled()
  })

  it('sanitizes project comments before persistence', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'author-1' } })
    ;(requestWithBodyLimit as jest.Mock).mockResolvedValue({ json: () => ({ content: '<img src=x onerror=alert(1)> Hello ' }) })
    ;(prisma.project.findUnique as jest.Mock).mockResolvedValue({ id: 'project-1' })
    ;(prisma.projectComment.create as jest.Mock).mockResolvedValue({ id: 'comment-1' })

    const response = await createProjectComment({} as never, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(201)
    expect(prisma.projectComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: 'Hello' }),
    }))
  })
})
