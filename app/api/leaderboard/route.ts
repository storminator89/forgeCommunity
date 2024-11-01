import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic' // Disable caching for real-time updates

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        image: true,
        endorsements: true,
        _count: {
          select: {
            posts: true,
            comments: true,
          }
        }
      }
    })

    // Calculate points for each user
    const leaderboardUsers = users
      .map(user => ({
        id: user.id,
        name: user.name || 'Anonymous',
        image: user.image,
        points: user.endorsements + (user._count.posts * 10) + (user._count.comments * 5)
      }))
      // Sort by points in descending order
      .sort((a, b) => b.points - a.points)
      // Take top 10
      .slice(0, 10)

    return NextResponse.json(leaderboardUsers)
  } catch (error) {
    return NextResponse.json(
      { error: 'Error fetching leaderboard' },
      { status: 500 }
    )
  }
}
