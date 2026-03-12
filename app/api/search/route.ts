export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import prisma from '@/lib/prisma';
import { sanitizeHtmlPreviewServer, sanitizeTextServer } from '@/lib/server/sanitize-html';

import { authOptions } from '../auth/[...nextauth]/options';

const VALID_TYPES = new Set(['all', 'course', 'event', 'member', 'post', 'resource']);
const ALL_RESULTS_LIMIT = 5;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const rawQuery = searchParams.get('query') ?? '';
    const rawType = searchParams.get('type') ?? 'all';
    const type = VALID_TYPES.has(rawType) ? rawType : 'all';
    const page = clamp(Number.parseInt(searchParams.get('page') ?? '1', 10) || 1, 1, 1000);
    const limit = clamp(Number.parseInt(searchParams.get('limit') ?? '10', 10) || 10, 1, 20);
    const query = sanitizeTextServer(rawQuery).slice(0, 120);

    if (query.length < 2) {
      return NextResponse.json({
        results: [],
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0,
        },
      });
    }

    const skip = (page - 1) * limit;

    const courseWhere = {
      OR: [
        { title: { contains: query, mode: 'insensitive' as const } },
        { description: { contains: query, mode: 'insensitive' as const } },
      ],
    };

    const memberWhere = {
      OR: [
        { name: { contains: query, mode: 'insensitive' as const } },
        { email: { contains: query, mode: 'insensitive' as const } },
        { bio: { contains: query, mode: 'insensitive' as const } },
        { title: { contains: query, mode: 'insensitive' as const } },
      ],
    };

    const postWhere = {
      OR: [
        { title: { contains: query, mode: 'insensitive' as const } },
        { content: { contains: query, mode: 'insensitive' as const } },
      ],
    };

    const eventWhere = {
      OR: [
        { title: { contains: query, mode: 'insensitive' as const } },
        { description: { contains: query, mode: 'insensitive' as const } },
      ],
    };

    const resourceWhere = {
      OR: [
        { title: { contains: query, mode: 'insensitive' as const } },
        { category: { contains: query, mode: 'insensitive' as const } },
      ],
    };

    const searchCourses = async () => {
      if (type !== 'all' && type !== 'course') {
        return [];
      }

      const courses = await prisma.course.findMany({
        where: courseWhere,
        select: {
          id: true,
          title: true,
          description: true,
          price: true,
          currency: true,
          maxStudents: true,
          imageUrl: true,
          startDate: true,
          endDate: true,
          createdAt: true,
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
        take: type === 'course' ? limit : ALL_RESULTS_LIMIT,
        orderBy: { createdAt: 'desc' },
      });

      return courses.map((course) => ({
        id: course.id,
        title: course.title,
        description: sanitizeHtmlPreviewServer(course.description, 220),
        type: 'course' as const,
        instructor: course.instructor.name,
        instructorImage: course.instructor.image,
        price: course.price,
        currency: course.currency,
        stats: {
          enrollments: course._count.enrollments,
          maxStudents: course.maxStudents,
        },
        image: course.imageUrl,
        dates: { start: course.startDate, end: course.endDate },
        createdAt: course.createdAt,
      }));
    };

    const searchMembers = async () => {
      if (type !== 'all' && type !== 'member') {
        return [];
      }

      const members = await prisma.user.findMany({
        where: memberWhere,
        select: {
          id: true,
          name: true,
          bio: true,
          title: true,
          image: true,
          role: true,
          endorsements: true,
          lastLogin: true,
          createdAt: true,
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
            take: 3,
            select: {
              level: true,
              endorsements: true,
              skill: {
                select: {
                  name: true,
                },
              },
            },
          },
          badges: {
            take: 3,
            select: {
              awardedAt: true,
              badge: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        skip: type === 'member' ? skip : 0,
        take: type === 'member' ? limit : ALL_RESULTS_LIMIT,
        orderBy: { createdAt: 'desc' },
      });

      return members.map((member) => ({
        id: member.id,
        title: member.name || 'Unbekannt',
        description: sanitizeHtmlPreviewServer(member.bio || member.title || '', 220),
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
        skills: member.skills.map((skill) => ({
          name: skill.skill.name,
          level: skill.level,
          endorsements: skill.endorsements,
        })),
        badges: member.badges.map((badge) => ({
          name: badge.badge.name,
          awardedAt: badge.awardedAt,
        })),
        lastActive: member.lastLogin,
        createdAt: member.createdAt,
      }));
    };

    const searchPosts = async () => {
      if (type !== 'all' && type !== 'post') {
        return [];
      }

      const posts = await prisma.post.findMany({
        where: postWhere,
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          author: {
            select: {
              name: true,
              image: true,
            },
          },
          tags: {
            select: {
              name: true,
            },
          },
          _count: {
            select: {
              comments: true,
              likePosts: true,
            },
          },
        },
        skip: type === 'post' ? skip : 0,
        take: type === 'post' ? limit : ALL_RESULTS_LIMIT,
        orderBy: { createdAt: 'desc' },
      });

      return posts.map((post) => ({
        id: post.id,
        title: post.title,
        description: sanitizeHtmlPreviewServer(post.content, 220),
        type: 'post' as const,
        author: post.author.name,
        authorImage: post.author.image,
        stats: { comments: post._count.comments, likes: post._count.likePosts },
        tags: post.tags.map((tag) => tag.name),
        createdAt: post.createdAt,
      }));
    };

    const searchEvents = async () => {
      if (type !== 'all' && type !== 'event') {
        return [];
      }

      const events = await prisma.event.findMany({
        where: eventWhere,
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          location: true,
          date: true,
          maxAttendees: true,
          startTime: true,
          endTime: true,
          timezone: true,
          createdAt: true,
          _count: {
            select: {
              attendees: true,
            },
          },
        },
        skip: type === 'event' ? skip : 0,
        take: type === 'event' ? limit : ALL_RESULTS_LIMIT,
        orderBy: { createdAt: 'desc' },
      });

      return events.map((event) => ({
        id: event.id,
        title: event.title,
        description: sanitizeHtmlPreviewServer(event.description, 220),
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
      if (type !== 'all' && type !== 'resource') {
        return [];
      }

      const resources = await prisma.resource.findMany({
        where: resourceWhere,
        select: {
          id: true,
          title: true,
          category: true,
          url: true,
          type: true,
          createdAt: true,
          author: {
            select: {
              name: true,
              image: true,
            },
          },
        },
        skip: type === 'resource' ? skip : 0,
        take: type === 'resource' ? limit : ALL_RESULTS_LIMIT,
        orderBy: { createdAt: 'desc' },
      });

      return resources.map((resource) => ({
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

    const [courses, members, posts, events, resources] = await Promise.all([
      searchCourses(),
      searchMembers(),
      searchPosts(),
      searchEvents(),
      searchResources(),
    ]);

    const results = [...courses, ...members, ...posts, ...events, ...resources];

    if (type === 'all') {
      results.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
    }

    let total = 0;

    if (type !== 'all') {
      switch (type) {
        case 'course':
          total = await prisma.course.count({ where: courseWhere });
          break;
        case 'member':
          total = await prisma.user.count({ where: memberWhere });
          break;
        case 'post':
          total = await prisma.post.count({ where: postWhere });
          break;
        case 'event':
          total = await prisma.event.count({ where: eventWhere });
          break;
        case 'resource':
          total = await prisma.resource.count({ where: resourceWhere });
          break;
      }
    }

    return NextResponse.json({
      results,
      pagination: {
        total,
        page,
        limit,
        pages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Fehler bei der Suche' },
      { status: 500 }
    );
  }
}
