export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/options'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      )
    }

    // URL-Parameter abrufen
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('query') || ''
    const type = searchParams.get('type') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    // Basis-Suchbedingungen
    const searchString = query.toLowerCase()

    // Suchergebnisse basierend auf dem Typ
    let results: any[] = []

    // Kurse durchsuchen
    if (type === 'all' || type === 'course') {
      const courses = await prisma.course.findMany({
        where: {
          OR: [
            { title: { contains: searchString, mode: 'insensitive' } },
            { description: { contains: searchString, mode: 'insensitive' } },
          ],
        },
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
        skip: type === 'course' ? skip : 0,
        take: type === 'course' ? limit : 5,
      })

      results.push(...courses.map(course => ({
        id: course.id,
        title: course.title,
        description: course.description,
        type: 'course',
        instructor: course.instructor.name,
        instructorImage: course.instructor.image,
        price: course.price,
        currency: course.currency,
        stats: {
          enrollments: course._count.enrollments,
          maxStudents: course.maxStudents,
        },
        image: course.imageUrl,
        dates: {
          start: course.startDate,
          end: course.endDate,
        },
        createdAt: course.createdAt,
      })))
    }

    // Mitglieder durchsuchen
    if (type === 'all' || type === 'member') {
      const members = await prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: searchString, mode: 'insensitive' } },
            { email: { contains: searchString, mode: 'insensitive' } },
            { bio: { contains: searchString, mode: 'insensitive' } },
            { title: { contains: searchString, mode: 'insensitive' } },
          ],
        },
        include: {
          _count: {
            select: {
              followers: true,
              following: true,
              posts: true,
              courses: true,
              projects: true,
            },
          },
          skills: {
            include: {
              skill: true,
            },
          },
          badges: {
            include: {
              badge: true,
            },
          },
        },
        skip: type === 'member' ? skip : 0,
        take: type === 'member' ? limit : 5,
      })

      results.push(...members.map(member => ({
        id: member.id,
        title: member.name,
        description: member.bio || member.title,
        type: 'member',
        image: member.image,
        role: member.role,
        stats: {
          followers: member._count.followers,
          following: member._count.following,
          posts: member._count.posts,
          courses: member._count.courses,
          projects: member._count.projects,
          endorsements: member.endorsements,
        },
        skills: member.skills.map(s => ({
          name: s.skill.name,
          level: s.level,
          endorsements: s.endorsements,
        })),
        badges: member.badges.map(b => ({
          name: b.badge.name,
          awardedAt: b.awardedAt,
        })),
        lastActive: member.lastLogin,
        createdAt: member.createdAt,
      })))
    }

    // Beiträge durchsuchen
    if (type === 'all' || type === 'post') {
      const posts = await prisma.post.findMany({
        where: {
          OR: [
            { title: { contains: searchString, mode: 'insensitive' } },
            { content: { contains: searchString, mode: 'insensitive' } },
          ],
        },
        include: {
          author: {
            select: {
              name: true,
              image: true,
            },
          },
          tags: true,
          _count: {
            select: {
              comments: true,
              likePosts: true,
            },
          },
        },
        skip: type === 'post' ? skip : 0,
        take: type === 'post' ? limit : 5,
      })

      results.push(...posts.map(post => ({
        id: post.id,
        title: post.title,
        description: post.content,
        type: 'post',
        author: post.author.name,
        authorImage: post.author.image,
        stats: {
          comments: post._count.comments,
          likes: post._count.likePosts,
        },
        tags: post.tags.map(tag => tag.name),
        createdAt: post.createdAt,
      })))
    }

    // Events durchsuchen
    if (type === 'all' || type === 'event') {
      const events = await prisma.event.findMany({
        where: {
          OR: [
            { title: { contains: searchString, mode: 'insensitive' } },
            { description: { contains: searchString, mode: 'insensitive' } },
          ],
        },
        include: {
          attendees: {
            include: {
              user: {
                select: {
                  name: true,
                  image: true,
                },
              },
            },
          },
          _count: {
            select: {
              attendees: true,
            },
          },
        },
        skip: type === 'event' ? skip : 0,
        take: type === 'event' ? limit : 5,
      })

      results.push(...events.map(event => ({
        id: event.id,
        title: event.title,
        description: event.description,
        type: 'event',
        category: event.category,
        location: event.location,
        date: event.date,
        stats: {
          attendees: event._count.attendees,
          maxAttendees: event.maxAttendees,
        },
        time: {
          start: event.startTime,
          end: event.endTime,
          timezone: event.timezone,
        },
        createdAt: event.createdAt,
      })))
    }

    // Gesamtzahl der Ergebnisse für Pagination
    let total = 0
    if (type !== 'all') {
      switch (type) {
        case 'course':
          total = await prisma.course.count({
            where: {
              OR: [
                { title: { contains: searchString, mode: 'insensitive' } },
                { description: { contains: searchString, mode: 'insensitive' } },
              ],
            },
          })
          break
        case 'member':
          total = await prisma.user.count({
            where: {
              OR: [
                { name: { contains: searchString, mode: 'insensitive' } },
                { email: { contains: searchString, mode: 'insensitive' } },
                { bio: { contains: searchString, mode: 'insensitive' } },
                { title: { contains: searchString, mode: 'insensitive' } },
              ],
            },
          })
          break
        case 'post':
          total = await prisma.post.count({
            where: {
              OR: [
                { title: { contains: searchString, mode: 'insensitive' } },
                { content: { contains: searchString, mode: 'insensitive' } },
              ],
            },
          })
          break
        case 'event':
          total = await prisma.event.count({
            where: {
              OR: [
                { title: { contains: searchString, mode: 'insensitive' } },
                { description: { contains: searchString, mode: 'insensitive' } },
              ],
            },
          })
          break
      }
    }

    return NextResponse.json({
      results,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      }
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Fehler bei der Suche' },
      { status: 500 }
    )
  }
}