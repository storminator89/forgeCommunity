import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/options'

const prisma = new PrismaClient()

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      )
    }

    const searchParams = new URL(request.url).searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    // Hole verschiedene Aktivitätstypen
    const [posts, comments, projects, courses] = await Promise.all([
      // Letzte Posts
      prisma.post.findMany({
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
              comments: true,
              likePosts: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),

      // Letzte Kommentare
      prisma.comment.findMany({
        where: { authorId: params.id },
        include: {
          post: true,
          author: {
            select: {
              name: true,
              image: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
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
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
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
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
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
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return NextResponse.json({
      activities,
      pagination: {
        page,
        limit,
        hasMore: activities.length === limit,
      },
    })
  } catch (error) {
    console.error('Error fetching activity:', error)
    return NextResponse.json(
      { error: 'Fehler beim Laden der Aktivitäten' },
      { status: 500 }
    )
  }
}