import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/options'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'

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

    const isOwnAccount = session.user.id === params.id
    const canViewDrafts = isOwnAccount || session.user.role === 'ADMIN'
    // Read only the fields needed for a profile. In particular, never load
    // password or recovery tokens into this public-facing response path.
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        email: isOwnAccount,
        image: true,
        coverImage: true,
        bio: true,
        title: true,
        contact: true,
        role: true,
        endorsements: true,
        createdAt: true,
        lastLogin: isOwnAccount,
        socialLinks: true,
        skills: {
          select: {
            id: true,
            skillId: true,
            level: true,
            endorsements: true,
            skill: { select: { name: true } },
          },
        },
        badges: {
          select: {
            id: true,
            awardedAt: true,
            badge: { select: { name: true, description: true, image: true } },
          },
        },
        followers: {
          where: {
            followerId: session.user.id,
          },
          select: { followerId: true },
          take: 1,
        },
        endorsementsReceived: {
          where: { endorserId: session.user.id },
          select: { id: true },
          take: 1,
        },
        _count: {
          select: {
            followers: true,
            following: true,
            posts: canViewDrafts ? true : { where: { published: true } },
            courses: true,
            projects: true,
            articles: canViewDrafts ? true : { where: { isPublished: true } },
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

    const savedSocialLinks = user.socialLinks && typeof user.socialLinks === 'object' && !Array.isArray(user.socialLinks)
      ? user.socialLinks as Record<string, unknown>
      : {}
    const socialLink = (key: string) => typeof savedSocialLinks[key] === 'string' ? savedSocialLinks[key] as string : null

    const isCurrentUser = user.id === session.user.id
    // Email and last-login timestamps belong only to the account owner.
    const formattedUser = {
      id: user.id,
      name: user.name,
      image: user.image,
      coverImage: user.coverImage,
      bio: user.bio,
      title: user.title,
      contact: user.contact,
      role: user.role,
      endorsements: user.endorsements,
      createdAt: user.createdAt,
      ...(isCurrentUser ? { email: user.email, lastLogin: user.lastLogin } : {}),
      isFollowing: user.followers.length > 0,
      isCurrentUser,
      hasEndorsed: user.endorsementsReceived.length > 0,
      skills: user.skills.map(userSkill => ({
        id: userSkill.id,
        skillId: userSkill.skillId,
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
        github: socialLink('github'),
        linkedin: socialLink('linkedin'),
        twitter: socialLink('twitter'),
        website: socialLink('website'),
      },
    }

    return NextResponse.json(formattedUser, { headers: { 'Cache-Control': 'private, no-store' } })
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

    const data = await readJsonObject(request)
    const { skillId } = data

    if (session.user.id === params.id) {
      return NextResponse.json(
        { error: 'Sie können Ihre eigenen Skills nicht empfehlen' },
        { status: 400 }
      )
    }

    if (typeof skillId !== 'string' || !skillId.trim()) {
      return NextResponse.json(
        { error: 'Skill ID ist erforderlich' },
        { status: 400 }
      )
    }

    // Prüfe, ob das UserSkill existiert
    const userSkill = await prisma.userSkill.findFirst({
      where: {
        userId: params.id,
        OR: [{ id: skillId }, { skillId }],
      },
    })

    if (!userSkill) {
      return NextResponse.json(
        { error: 'Skill nicht gefunden' },
        { status: 404 }
      )
    }

    // The unique pair is the durable guard against retries and parallel requests.
    await prisma.$transaction(async tx => {
      await tx.skillEndorsement.create({
        data: { endorserId: session.user.id, userSkillId: userSkill.id },
      })
      await tx.userSkill.update({
        where: { id: userSkill.id },
        data: { endorsements: { increment: 1 } },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const invalidRequest = requestErrorResponse(error)
    if (invalidRequest) return invalidRequest
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ error: 'Skill bereits empfohlen' }, { status: 409 })
    }
    if (typeof error === 'object' && error !== null && 'code' in error && (error.code === 'P2003' || error.code === 'P2025')) {
      return NextResponse.json({ error: 'Skill nicht gefunden' }, { status: 404 })
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') {
      return NextResponse.json({ error: 'Gleichzeitige Änderung. Bitte erneut versuchen.' }, { status: 409 })
    }
    console.error('Error endorsing skill:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}
