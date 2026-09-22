import { GET as getArticle } from '@/app/api/articles/[id]/route'
import { GET as getPost } from '@/app/api/posts/[postId]/route'
import { POST as likeNestedComment } from '@/app/api/posts/[postId]/comments/[commentId]/like/route'
import { GET as getChatMembers, POST as addChatMember } from '@/app/api/chat/members/route'
import { GET as getChatMessages } from '@/app/api/chat/messages/route'
import { GET as getAdminUsers } from '@/app/api/admin/users/route'
import { PUT as updateProfile } from '@/app/api/user/profile/route'
import { POST as issueCertificate } from '@/app/api/courses/[courseId]/certificate/route'
import { POST as addCourseContent } from '@/app/api/courses/[courseId]/contents/route'
import { PUT as moveCourseContent } from '@/app/api/courses/[courseId]/contents/[contentId]/move/route'
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
    article: { findUnique: jest.fn() },
    post: { findUnique: jest.fn(), findMany: jest.fn() },
    comment: { findUnique: jest.fn() },
    likeComment: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    chatChannel: { findUnique: jest.fn(), findFirst: jest.fn() },
    chatMember: { findMany: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    course: { findUnique: jest.fn() },
    courseContent: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    enrollment: { findUnique: jest.fn() },
    certificate: { create: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }))

jest.mock('jspdf', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('jspdf-autotable', () => ({}))
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: jest.fn() } }))
jest.mock('uuid', () => ({ v4: jest.fn(() => 'certificate-id') }))

const mockedPrisma = prisma as unknown as {
  article: { findUnique: jest.Mock }
  post: { findUnique: jest.Mock; findMany: jest.Mock }
  comment: { findUnique: jest.Mock }
  likeComment: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock }
  chatChannel: { findUnique: jest.Mock; findFirst: jest.Mock }
  chatMember: { findMany: jest.Mock; create: jest.Mock }
  user: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
  course: { findUnique: jest.Mock }
  courseContent: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock }
  enrollment: { findUnique: jest.Mock }
  certificate: { create: jest.Mock; findFirst: jest.Mock }
  $transaction: jest.Mock
}

function jsonRequest(url: string, init: RequestInit = {}): any {
  const body = typeof init.body === 'string' ? init.body : undefined
  return {
    url,
    json: async () => (body ? JSON.parse(body) : {}),
    formData: async () => new FormData(),
  }
}

describe('API authorization regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
    mockedPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', title: 'Course', contents: [] })
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com', name: 'User' })
    mockedPrisma.enrollment.findUnique.mockResolvedValue({ completedAt: null })

    const response = await issueCertificate(
      jsonRequest('http://localhost/api/courses/course-1/certificate', { method: 'POST' }),
      { params: Promise.resolve({ courseId: 'course-1' }) },
    )

    expect(response.status).toBe(403)
    expect(mockedPrisma.certificate.create).not.toHaveBeenCalled()
  })

  it('rejects a course content parent from another course', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'instructor-1', role: 'INSTRUCTOR' } })
    mockedPrisma.course.findUnique.mockResolvedValue({ instructorId: 'instructor-1' })
    mockedPrisma.courseContent.findUnique.mockResolvedValue({ id: 'parent-1', courseId: 'other-course' })

    const response = await addCourseContent(
      jsonRequest('http://localhost/api/courses/course-1/contents', {
        method: 'POST',
        body: JSON.stringify({ title: 'Child', content: 'content', parentId: 'parent-1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ courseId: 'course-1' }) },
    )

    expect(response.status).toBe(400)
    expect(mockedPrisma.courseContent.create).not.toHaveBeenCalled()
  })

  it('does not let a non-instructor move course content', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-1', role: 'USER' } })
    mockedPrisma.courseContent.findUnique.mockResolvedValue({
      id: 'content-1',
      courseId: 'course-1',
      parentId: null,
      order: 1,
      course: { instructorId: 'instructor-1' },
    })

    const response = await moveCourseContent(
      jsonRequest('http://localhost/api/courses/course-1/contents/content-1/move', {
        method: 'PUT',
        body: JSON.stringify({ targetId: 'content-2', position: 'after' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ courseId: 'course-1', contentId: 'content-1' }) },
    )

    expect(response.status).toBe(403)
  })

  it('moves course content atomically and returns the grouped course tree', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'instructor-1', role: 'INSTRUCTOR' } })
    mockedPrisma.courseContent.findUnique
      .mockResolvedValueOnce({
        id: 'content-1',
        courseId: 'course-1',
        parentId: null,
        order: 2,
        course: { instructorId: 'instructor-1' },
      })
      .mockResolvedValueOnce({
        id: 'content-2',
        courseId: 'course-1',
        parentId: null,
        order: 1,
      })

    const tx = {
      courseContent: {
        findUnique: jest.fn(),
        findMany: jest.fn()
          .mockResolvedValueOnce([
            { id: 'content-2', parentId: null, order: 1 },
            { id: 'content-1', parentId: null, order: 2 },
          ])
          .mockResolvedValueOnce([
            { id: 'content-1', parentId: null, order: 1 },
            { id: 'content-2', parentId: null, order: 2 },
          ]),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    mockedPrisma.$transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx))

    const response = await moveCourseContent(
      jsonRequest('http://localhost/api/courses/course-1/contents/content-1/move', {
        method: 'PUT',
        body: JSON.stringify({ targetId: 'content-2', position: 'before' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ courseId: 'course-1', contentId: 'content-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.map((content: { id: string }) => content.id)).toEqual(['content-1', 'content-2'])
    expect(tx.courseContent.update).toHaveBeenCalled()
  })
})
