import { GET as getArticle } from '@/app/api/articles/[id]/route'
import { GET as getArticles } from '@/app/api/articles/route'
import { GET as getResources } from '@/app/api/resources/route'
import { GET as getPost } from '@/app/api/posts/[postId]/route'
import { POST as likeNestedComment } from '@/app/api/posts/[postId]/comments/[commentId]/like/route'
import { GET as getChatMembers, POST as addChatMember } from '@/app/api/chat/members/route'
import { GET as getChatMessages } from '@/app/api/chat/messages/route'
import { GET as getAdminUsers } from '@/app/api/admin/users/route'
import { GET as getMembers } from '@/app/api/members/route'
import { PUT as updateProfile } from '@/app/api/user/profile/route'
import { POST as issueCertificate } from '@/app/api/courses/[courseId]/certificate/route'
import { PATCH as saveCourseDraft } from '@/app/api/courses/[courseId]/authoring/route'
import { publicationDigest, type CoursePayload } from '@/lib/server/course-authoring'
import prisma from '@/lib/prisma'
import { getServerSession as getNextAuthSession } from 'next-auth'
import { getServerSession } from 'next-auth/next'

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      })
    }
  }
  return { NextResponse: MockNextResponse }
})

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    article: { findUnique: jest.fn(), findMany: jest.fn() },
    resource: { findMany: jest.fn(), count: jest.fn() },
    post: { findUnique: jest.fn(), findMany: jest.fn() },
    comment: { findUnique: jest.fn() },
    likeComment: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    chatChannel: { findUnique: jest.fn(), findFirst: jest.fn() },
    chatMember: { findMany: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    course: { findUnique: jest.fn() },
    courseDraft: { findUnique: jest.fn(), update: jest.fn() },
    courseContent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    courseContentProgress: { findMany: jest.fn() },
    enrollment: { findUnique: jest.fn() },
    certificate: { create: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/server/rewards', () => ({ reconcileCourseRewards: jest.fn(), reconcileLearnerCourseReward: jest.fn() }))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))

jest.mock('jspdf', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('jspdf-autotable', () => ({}))
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: jest.fn() } }))
jest.mock('uuid', () => ({ v4: jest.fn(() => 'certificate-id') }))

const mockedPrisma = prisma as unknown as {
  article: { findUnique: jest.Mock; findMany: jest.Mock }
  resource: { findMany: jest.Mock; count: jest.Mock }
  post: { findUnique: jest.Mock; findMany: jest.Mock }
  comment: { findUnique: jest.Mock }
  likeComment: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock }
  chatChannel: { findUnique: jest.Mock; findFirst: jest.Mock }
  chatMember: { findMany: jest.Mock; create: jest.Mock }
  user: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
  course: { findUnique: jest.Mock }
  courseDraft: { findUnique: jest.Mock; update: jest.Mock }
  courseContent: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock }
  courseContentProgress: { findMany: jest.Mock }
  enrollment: { findUnique: jest.Mock }
  certificate: { create: jest.Mock; findFirst: jest.Mock }
  $transaction: jest.Mock
}

function jsonRequest(url: string, init: RequestInit = {}): any {
  const body = typeof init.body === 'string' ? init.body : undefined
  return {
    url,
    nextUrl: new URL(url),
    headers: { get: () => null },
    body: null,
    json: async () => (body ? JSON.parse(body) : {}),
    formData: async () => new FormData(),
  }
}

describe('API authorization regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockedPrisma) => unknown) => callback(mockedPrisma))
  })

  it('does not expose an unpublished article to anonymous readers', async () => {
    mockedPrisma.article.findUnique.mockResolvedValue({
      id: 'draft-1',
      authorId: 'author-1',
      isPublished: false,
    })
    ;(getServerSession as jest.Mock).mockResolvedValue(null)

    const response = await getArticle(jsonRequest('http://localhost/api/articles/draft-1'), {
      params: Promise.resolve({ id: 'draft-1' }),
    })

    expect(response.status).toBe(404)
  })

  it('does not select author email addresses in public article listings', async () => {
    mockedPrisma.article.findMany.mockResolvedValue([])

    const response = await getArticles()

    expect(response.status).toBe(200)
    expect(mockedPrisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        author: { select: { id: true, name: true } },
      }),
    }))
  })

  it('does not select author email addresses in public resource listings', async () => {
    mockedPrisma.resource.findMany.mockResolvedValue([])
    mockedPrisma.resource.count.mockResolvedValue(0)

    const response = await getResources(new Request('http://localhost/api/resources'))

    expect(response.status).toBe(200)
    expect(mockedPrisma.resource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        author: { select: { id: true, name: true } },
      }),
    }))
  })

  it('does not expose an unpublished post to anonymous readers', async () => {
    mockedPrisma.post.findUnique.mockResolvedValue({
      id: 'draft-post-1',
      authorId: 'author-1',
      published: false,
    })
    ;(getServerSession as jest.Mock).mockResolvedValue(null)

    const response = await getPost(jsonRequest('http://localhost/api/posts/draft-post-1'), {
      params: Promise.resolve({ postId: 'draft-post-1' }),
    })

    expect(response.status).toBe(404)
  })

  it('requires the nested post ID to match a comment before toggling its like', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', role: 'USER' } })
    mockedPrisma.comment.findUnique.mockResolvedValue({
      id: 'comment-1',
      postId: 'actual-post',
      post: { published: true, authorId: 'author-1' },
    })

    const response = await likeNestedComment(
      jsonRequest('http://localhost/api/posts/wrong-post/comments/comment-1/like', { method: 'POST' }),
      { params: Promise.resolve({ postId: 'wrong-post', commentId: 'comment-1' }) },
    )

    expect(response.status).toBe(404)
    expect(mockedPrisma.likeComment.findUnique).not.toHaveBeenCalled()
  })

  it('does not let a regular member add users to chat channels', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })

    const response = await addChatMember(
      jsonRequest('http://localhost/api/chat/members', {
        method: 'POST',
        body: JSON.stringify({ userId: 'victim-1', channelId: 'private-1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(response.status).toBe(403)
    expect(mockedPrisma.chatChannel.findUnique).not.toHaveBeenCalled()
  })

  it('does not reveal private channel membership to non-members', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })
    mockedPrisma.chatChannel.findFirst.mockResolvedValue(null)

    const response = await getChatMembers(
      jsonRequest('http://localhost/api/chat/members?channelId=private-1'),
    )

    expect(response.status).toBe(403)
    expect(mockedPrisma.chatMember.findMany).not.toHaveBeenCalled()
  })

  it('rejects malformed chat message cursors instead of querying with Invalid Date', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })

    const response = await getChatMessages(
      jsonRequest('http://localhost/api/chat/messages?channelId=channel-1&after=not-a-date'),
    )

    expect(response.status).toBe(400)
    expect(mockedPrisma.chatChannel.findFirst).not.toHaveBeenCalled()
  })

  it('requires an administrator for the admin user list', async () => {
    ;(getNextAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', role: 'USER' } })

    const response = await getAdminUsers(jsonRequest('http://localhost/api/admin/users'))

    expect(response.status).toBe(403)
    expect(mockedPrisma.user.findMany).not.toHaveBeenCalled()
  })

  it('returns only the public member profile fields', async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{
      id: 'member-1',
      name: 'Member',
      image: null,
      title: 'Developer',
      role: 'USER',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      _count: { followers: 3 },
      skills: [{ skill: { name: 'TypeScript' } }],
      email: 'private@example.com',
      password: 'password-hash',
      contact: { phone: 'private' },
      bio: 'private bio',
    }])

    const response = await getMembers()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([{
      id: 'member-1',
      name: 'Member',
      image: null,
      title: 'Developer',
      role: 'USER',
      createdAt: '2025-01-01T00:00:00.000Z',
      followers: 3,
      skills: ['TypeScript'],
    }])
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ email: true, password: true, contact: true, bio: true }),
    }))
  })

  it('returns only the safe profile projection after an update', async () => {
    ;(getNextAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', email: 'old@example.com' } })
    mockedPrisma.user.findFirst.mockResolvedValue(null)
    mockedPrisma.user.update.mockResolvedValue({
      id: 'user-1',
      name: 'Updated',
      email: 'updated@example.com',
      image: null,
      userSettings: { language: 'en', emailNotifications: true, pushNotifications: true },
      password: 'should-not-be-returned',
      resetPasswordToken: 'should-not-be-returned',
    })

    const response = await updateProfile(
      jsonRequest('http://localhost/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated', email: 'UPDATED@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.password).toBeUndefined()
    expect(body.resetPasswordToken).toBeUndefined()
    expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'Updated',
        email: 'updated@example.com',
        emailVerified: null,
        verificationToken: null,
        resetPasswordToken: null,
      }),
    }))
  })

  it('does not issue a certificate before completion', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1' } })
    mockedPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', title: 'Course', activePublicationId: 'publication-1' })
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com', name: 'User' })
    mockedPrisma.enrollment.findUnique.mockResolvedValue({ id: 'enrollment-1', completedAt: null })
    mockedPrisma.courseContent.findMany.mockResolvedValue([])
    mockedPrisma.courseContentProgress.findMany.mockResolvedValue([])

    const response = await issueCertificate(
      jsonRequest('http://localhost/api/courses/course-1/certificate', { method: 'POST' }),
      { params: Promise.resolve({ courseId: 'course-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockedPrisma.certificate.create).not.toHaveBeenCalled()
  })

  function draft(contents: CoursePayload['contents']): CoursePayload {
    return { schemaVersion: 1, title: 'Private draft', description: 'Description', startDate: null,
      endDate: null, imageUrl: null, contents }
  }

  function arrangeAuthoring(contents: CoursePayload['contents']) {
    let current = draft(contents)
    let revision = 0
    mockedPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', instructorId: 'instructor-1', activePublicationId: null })
    mockedPrisma.user.findUnique.mockResolvedValue({ role: 'INSTRUCTOR' })
    mockedPrisma.courseDraft.findUnique.mockImplementation(async () => ({ revision, payload: JSON.stringify(current), digest: publicationDigest(current) }))
    mockedPrisma.courseDraft.update.mockImplementation(async ({ data }: { data: { payload: string; revision: { increment: number } } }) => {
      current = JSON.parse(data.payload) as CoursePayload
      revision += data.revision.increment
      return { revision, payload: JSON.stringify(current), digest: publicationDigest(current) }
    })
    mockedPrisma.courseContent.findMany.mockResolvedValue([])
    return { current: () => current, revision: () => revision }
  }

  function saveOperation(operation: unknown) {
    return saveCourseDraft(jsonRequest('http://localhost/api/courses/course-1/authoring', {
      method: 'PATCH', body: JSON.stringify({ expectedRevision: 0, operation }),
    }), { params: Promise.resolve({ courseId: 'course-1' }) })
  }

  it('does not accept an existing content ID from another course into a private draft', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'instructor-1', role: 'INSTRUCTOR' } })
    const state = arrangeAuthoring([])
    mockedPrisma.courseContent.findMany.mockResolvedValue([{ id: 'foreign-id', courseId: 'another-course' }])
    const response = await saveOperation({ kind: 'insertNode', node: {
      id: 'foreign-id', title: 'Child', type: 'TEXT', content: 'content',
    }, parentId: null, afterId: null })
    expect(response.status).toBe(409)
    expect(state.revision()).toBe(0)
    expect(mockedPrisma.courseDraft.update).not.toHaveBeenCalled()
    expect(mockedPrisma.courseContent.create).not.toHaveBeenCalled()
  })

  it('does not let a non-instructor change a private course draft', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })
    arrangeAuthoring([{ id: 'content-1', parentId: null, order: 1, title: 'Content', type: 'TEXT', content: 'Body' }])
    mockedPrisma.user.findUnique.mockResolvedValue({ role: 'USER' })
    const response = await saveOperation({ kind: 'moveNode', id: 'content-1', parentId: null, afterId: null })
    expect(response.status).toBe(403)
    expect(mockedPrisma.courseDraft.update).not.toHaveBeenCalled()
  })

  it('moves private content atomically without changing live course rows', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'instructor-1', role: 'INSTRUCTOR' } })
    const state = arrangeAuthoring([
      { id: 'content-1', parentId: null, order: 2, title: 'Second', type: 'TEXT', content: 'Body' },
      { id: 'content-2', parentId: null, order: 1, title: 'First', type: 'TEXT', content: 'Body' },
    ])
    const response = await saveOperation({ kind: 'moveNode', id: 'content-1', parentId: null, afterId: null })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.draft.revision).toBe(1)
    expect(state.current().contents.sort((a, b) => a.order - b.order).map(content => content.id))
      .toEqual(['content-1', 'content-2'])
    expect(mockedPrisma.courseDraft.update).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.courseContent.create).not.toHaveBeenCalled()
  })

  it('rejects moving a parent below its descendant without saving', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'instructor-1', role: 'INSTRUCTOR' } })
    const state = arrangeAuthoring([
      { id: 'parent-id', parentId: null, order: 1, title: 'Parent', type: 'TEXT', content: 'Body' },
      { id: 'child-id', parentId: 'parent-id', order: 1, title: 'Child', type: 'TEXT', content: 'Body' },
    ])
    const response = await saveOperation({ kind: 'moveNode', id: 'parent-id', parentId: 'child-id', afterId: null })
    expect(response.status).toBe(400)
    expect(state.revision()).toBe(0)
    expect(mockedPrisma.courseDraft.update).not.toHaveBeenCalled()
  })
})
