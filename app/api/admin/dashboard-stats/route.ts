import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { startOfYear, endOfYear, eachMonthOfInterval, format } from 'date-fns';
import { de } from 'date-fns/locale';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'ADMIN') {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const now = new Date();
    const startOfCurrentYear = startOfYear(now);
    const endOfCurrentYear = endOfYear(now);

    // Fetch stats counts
    const [totalUsers, totalCourses, totalEvents, totalPosts] = await Promise.all([
      prisma.user.count(),
      prisma.course.count(),
      prisma.event.count(),
      prisma.post.count(),
    ]);

    // Fetch Recent Activity
    // We'll combine latest users, posts, courses, and events
    const [recentUsers, recentPosts, recentCourses, recentEvents] = await Promise.all([
      prisma.user.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { name: true, email: true, image: true, createdAt: true },
      }),
      prisma.post.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { name: true, email: true, image: true } } },
      }),
      prisma.course.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: { instructor: { select: { name: true, email: true, image: true } } },
      }),
      prisma.event.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        include: { attendees: { take: 1, include: { user: true } } } // Just grabbing an attendee if needed, effectively simpler to just show created event
      }),
    ]);

    // Normalize activities
    const activities = [
      ...recentUsers.map(u => ({
        type: 'USER_REGISTERED',
        user: { name: u.name || 'Unbekannt', email: u.email, image: u.image },
        action: 'hat sich registriert',
        time: u.createdAt,
      })),
      ...recentPosts.map(p => ({
        type: 'POST_CREATED',
        user: { name: p.author.name || 'Unbekannt', email: p.author.email, image: p.author.image },
        action: 'hat einen neuen Beitrag erstellt',
        time: p.createdAt,
      })),
      ...recentCourses.map(c => ({
        type: 'COURSE_CREATED',
        user: { name: c.instructor.name || 'Unbekannt', email: c.instructor.email, image: c.instructor.image },
        action: `hat den Kurs "${c.title}" erstellt`,
        time: c.createdAt,
      })),
      // Events don't have an explicit 'creator' field in schema visible here (maybe implicit or managed elsewhere?), 
      // Assuming 'events' list implies creation or we simulate it. 
      // Actually schema has no `organizer` relation visible in provided file snippet (Course has instructor, Post has author). 
      // We will skip event creation for now or assume system events if no user relation found.
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 10); // Take top 10 combined

    return new NextResponse(JSON.stringify({
      totalUsers,
      totalCourses,
      totalEvents,
      totalPosts,
      activities
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return new NextResponse(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
