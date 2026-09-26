import { PaginationError, readPagination } from '@/lib/server/pagination';
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/options'

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      )
    }

    const canViewDrafts = session.user.role === 'ADMIN' || session.user.id === params.id

    const searchParams = new URL(request.url).searchParams
    const { page, limit, skip } = readPagination(searchParams, 10);

    // Hole verschiedene Aktivitätstypen
    const [posts, comments, projects, courses] = await Promise.all([
      // Letzte Posts
      prisma.post.findMany({
        where: {
          authorId: params.id,
          ...(canViewDrafts ? {} : { published: true }),
        },
        include: {
          author: {
            select: {
              name: true,
              image: true,
            },
          },
          _count: {
            select: {
              comments: true,
              likePosts: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: skip + limit + 1,
      }),

      // Letzte Kommentare
      prisma.comment.findMany({
        where: {
          authorId: params.id,
          ...(canViewDrafts ? {} : { post: { published: true } }),
        },
        include: {
          post: true,
          author: {
            select: {
              name: true,
              image: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: skip + limit + 1,
      }),

      // Letzte Projekte
      prisma.project.findMany({
        where: { authorId: params.id },
        include: {
          author: {
            select: {
              name: true,
              image: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: skip + limit + 1,
      }),

      // Letzte Kurse
      prisma.course.findMany({
        where: { instructorId: params.id },
        include: {
          instructor: {
            select: {
              name: true,
              image: true,
            },
          },
          _count: {
            select: {
              enrollments: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: skip + limit + 1,
      }),
    ])

    // Kombiniere und sortiere alle Aktivitäten
    const activities = [
      ...posts.map(post => ({
        type: 'post',
        id: post.id,
        title: post.title,
        content: post.content,
        author: post.author,
        stats: {
          comments: post._count.comments,
          likes: post._count.likePosts,
        },
        createdAt: post.createdAt,
      })),
      ...comments.map(comment => ({
        type: 'comment',
        id: comment.id,
        content: comment.content,
        postTitle: comment.post.title,
        postId: comment.post.id,
        author: comment.author,
        createdAt: comment.createdAt,
      })),
      ...projects.map(project => ({
        type: 'project',
        id: project.id,
        title: project.title,
        description: project.description,
        author: project.author,
        stats: {
          likes: project._count.likes,
          comments: project._count.comments,
        },
        createdAt: project.createdAt,
      })),
      ...courses.map(course => ({
        type: 'course',
        id: course.id,
        title: course.title,
        description: course.description,
        instructor: course.instructor,
        stats: {
          enrollments: course._count.enrollments,
        },
        createdAt: course.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.type.localeCompare(b.type) || a.id.localeCompare(b.id))

    return NextResponse.json({
      activities: activities.slice(skip, skip + limit),
      pagination: {
        page,
        limit,
        hasMore: activities.length > skip + limit,
      },
    })
  } catch (error) {
    if (error instanceof PaginationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Error fetching activity:', error)
    return NextResponse.json(
      { error: 'Fehler beim Laden der Aktivitäten' },
      { status: 500 }
    )
  }
}
