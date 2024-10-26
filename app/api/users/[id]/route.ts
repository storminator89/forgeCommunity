import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/options'

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

    // Hole den Benutzer mit allen relevanten Beziehungen
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      include: {
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
        followers: {
          where: {
            followerId: session.user.id,
          },
        },
        _count: {
          select: {
            followers: true,
            following: true,
            posts: true,
            courses: true,
            projects: true,
            articles: true,
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 404 }
      )
    }

    // Formatiere die Daten für die Frontend-Anzeige
    const formattedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      bio: user.bio,
      title: user.title,
      contact: user.contact,
      role: user.role,
      endorsements: user.endorsements,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      isFollowing: user.followers.length > 0,
      isCurrentUser: user.id === session.user.id,
      skills: user.skills.map(userSkill => ({
        id: userSkill.id,
        name: userSkill.skill.name,
        level: userSkill.level,
        endorsements: userSkill.endorsements,
      })),
      badges: user.badges.map(userBadge => ({
        id: userBadge.id,
        name: userBadge.badge.name,
        description: userBadge.badge.description,
        image: userBadge.badge.image,
        awardedAt: userBadge.awardedAt,
      })),
      stats: {
        followers: user._count.followers,
        following: user._count.following,
        posts: user._count.posts,
        courses: user._count.courses,
        projects: user._count.projects,
        articles: user._count.articles,
      },
      // Optional: Fügen Sie Social Media Links hinzu, wenn Sie diese in Ihrem Schema haben
      socialLinks: {
        github: null,    // TODO: Aus user-Daten oder separater Tabelle laden
        linkedin: null,  // TODO: Aus user-Daten oder separater Tabelle laden
        twitter: null,   // TODO: Aus user-Daten oder separater Tabelle laden
        website: null,   // TODO: Aus user-Daten oder separater Tabelle laden
      },
    }

    return NextResponse.json(formattedUser)
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}

// Follow/Unfollow Endpunkt
export async function POST(
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

    const followerId = session.user.id
    const followingId = params.id

    if (followerId === followingId) {
      return NextResponse.json(
        { error: 'Sie können sich nicht selbst folgen' },
        { status: 400 }
      )
    }

    // Prüfe, ob der Follow bereits existiert
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    if (existingFollow) {
      return NextResponse.json(
        { error: 'Sie folgen diesem Benutzer bereits' },
        { status: 400 }
      )
    }

    // Erstelle den Follow
    await prisma.follow.create({
      data: {
        followerId,
        followingId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error following user:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}

// Unfollow Endpunkt
export async function DELETE(
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

    const followerId = session.user.id
    const followingId = params.id

    // Lösche den Follow
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error unfollowing user:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}

// Endorsement Endpunkt
export async function PATCH(
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

    const data = await request.json()
    const { skillId } = data

    if (!skillId) {
      return NextResponse.json(
        { error: 'Skill ID ist erforderlich' },
        { status: 400 }
      )
    }

    // Prüfe, ob das UserSkill existiert
    const userSkill = await prisma.userSkill.findFirst({
      where: {
        userId: params.id,
        skillId,
      },
    })

    if (!userSkill) {
      return NextResponse.json(
        { error: 'Skill nicht gefunden' },
        { status: 404 }
      )
    }

    // Aktualisiere die Endorsements
    await prisma.userSkill.update({
      where: {
        id: userSkill.id,
      },
      data: {
        endorsements: {
          increment: 1,
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error endorsing skill:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}