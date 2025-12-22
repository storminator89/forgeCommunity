export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { getServerSession } from 'next-auth'
import { authOptions } from '../auth/[...nextauth]/options'

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

    // Define search functions for each type to allow parallel execution
    const searchCourses = async () => {
      if (type !== 'all' && type !== 'course') return [];
      const courses = await prisma.course.findMany({
        where: {
          OR: [
            { title: { contains: searchString, mode: 'insensitive' } },
            { description: { contains: searchString, mode: 'insensitive' } },
          ],
        },
        include: {
          instructor: { select: { name: true, image: true } },
          _count: { select: { enrollments: true } },
        },
        skip: type === 'course' ? skip : 0,
        take: type === 'course' ? limit : 5,
        orderBy: { createdAt: 'desc' },
      });
      return courses.map(course => ({
        id: course.id,
        title: course.title,
        description: course.description,
        type: 'course' as const,
        instructor: course.instructor.name,
        instructorImage: course.instructor.image,
        price: course.price,
        currency: course.currency,
        stats: { enrollments: course._count.enrollments, maxStudents: course.maxStudents },
        image: course.imageUrl,
        dates: { start: course.startDate, end: course.endDate },
        createdAt: course.createdAt,
      }));
    };

    const searchMembers = async () => {
      if (type !== 'all' && type !== 'member') return [];
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
          _count: { select: { followers: true, following: true, posts: true, courses: true, projects: true } },
          skills: { include: { skill: true } },
          badges: { include: { badge: true } },
        },
        skip: type === 'member' ? skip : 0,
        take: type === 'member' ? limit : 5,
        orderBy: { createdAt: 'desc' },
      });
      return members.map(member => ({
        id: member.id,
        title: member.name || 'Unbekannt',
        description: member.bio || member.title || '',
        type: 'member' as const,
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
        skills: member.skills.map(s => ({ name: s.skill.name, level: s.level, endorsements: s.endorsements })),
        badges: member.badges.map(b => ({ name: b.badge.name, awardedAt: b.awardedAt })),
        lastActive: member.lastLogin,
        createdAt: member.createdAt,
      }));
    };

    const searchPosts = async () => {
      if (type !== 'all' && type !== 'post') return [];
      const posts = await prisma.post.findMany({
        where: {
          OR: [
            { title: { contains: searchString, mode: 'insensitive' } },
            { content: { contains: searchString, mode: 'insensitive' } },
          ],
        },
        include: {
          author: { select: { name: true, image: true } },
          tags: true,
          _count: { select: { comments: true, likePosts: true } },
        },
        skip: type === 'post' ? skip : 0,
        take: type === 'post' ? limit : 5,
        orderBy: { createdAt: 'desc' },
      });
      return posts.map(post => ({
        id: post.id,
        title: post.title,
        description: post.content,
        type: 'post' as const,
        author: post.author.name,
        authorImage: post.author.image,
        stats: { comments: post._count.comments, likes: post._count.likePosts },
        tags: post.tags.map(tag => tag.name),
        createdAt: post.createdAt,
      }));
    };

    const searchEvents = async () => {
      if (type !== 'all' && type !== 'event') return [];
      const events = await prisma.event.findMany({
        where: {
          OR: [
            { title: { contains: searchString, mode: 'insensitive' } },
            { description: { contains: searchString, mode: 'insensitive' } },
          ],
        },
        include: {
          _count: { select: { attendees: true } },
        },
        skip: type === 'event' ? skip : 0,
        take: type === 'event' ? limit : 5,
        orderBy: { createdAt: 'desc' },
      });
      return events.map(event => ({
        id: event.id,
        title: event.title,
        description: event.description,
        type: 'event' as const,
        category: event.category,
        location: event.location,
        date: event.date,
        stats: { attendees: event._count.attendees, maxAttendees: event.maxAttendees },
        time: { start: event.startTime, end: event.endTime, timezone: event.timezone },
        createdAt: event.createdAt,
      }));
    };

    const searchResources = async () => {
      if (type !== 'all' && type !== 'resource') return [];
      const resources = await prisma.resource.findMany({
        where: {
          OR: [
            { title: { contains: searchString, mode: 'insensitive' } },
            { category: { contains: searchString, mode: 'insensitive' } },
          ],
        },
        include: {
          author: { select: { name: true, image: true } },
        },
        skip: type === 'resource' ? skip : 0,
        take: type === 'resource' ? limit : 5,
        orderBy: { createdAt: 'desc' },
      });
      return resources.map(resource => ({
        id: resource.id,
        title: resource.title,
        description: resource.url,
        type: 'resource' as const,
        category: resource.category,
        author: resource.author.name,
        authorImage: resource.author.image,
        url: resource.url,
        resourceType: resource.type,
        createdAt: resource.createdAt,
      }));
    };

    // Execute queries in parallel
    const [courses, members, posts, events, resources] = await Promise.all([
      searchCourses(),
      searchMembers(),
      searchPosts(),
      searchEvents(),
      searchResources(),
    ]);

    results = [...courses, ...members, ...posts, ...events, ...resources];

    // Optional: Sort combined results by date descending if in 'all' mode
    if (type === 'all') {
      results.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
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
        case 'resource':
          total = await prisma.resource.count({
            where: {
              OR: [
                { title: { contains: searchString, mode: 'insensitive' } },
                { category: { contains: searchString, mode: 'insensitive' } },
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