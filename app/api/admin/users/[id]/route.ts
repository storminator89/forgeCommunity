import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/options'
import bcrypt from 'bcrypt'

// GET: Einzelnen Benutzer abrufen
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      include: {
        userSettings: true,
        badges: {
          include: {
            badge: true,
          }
        },
        skills: {
          include: {
            skill: true,
          }
        },
        posts: {
          select: { id: true }
        },
        comments: {
          select: { id: true }
        },
        likePosts: {
          select: { id: true }
        },
        courses: {
          select: { id: true }
        },
        projects: {
          select: { id: true }
        },
        endorsementsReceived: {
          select: { id: true }
        }
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 404 }
      )
    }

    // Transformiere die Daten für die Frontend-Anzeige
    const transformedUser = {
      ...user,
      password: undefined, // Entferne das Passwort aus der Antwort
      stats: {
        postsCount: user.posts.length,
        commentsCount: user.comments.length,
        likesReceived: user.likePosts.length,
        coursesCount: user.courses.length,
        projectsCount: user.projects.length,
        endorsementsCount: user.endorsementsReceived.length
      },
      badges: user.badges.map(b => ({
        name: b.badge.name,
        awardedAt: b.awardedAt,
      })),
      skills: user.skills.map(s => ({
        name: s.skill.name,
        level: s.level,
      })),
      // Entferne die ursprünglichen Arrays
      posts: undefined,
      comments: undefined,
      likePosts: undefined,
      courses: undefined,
      projects: undefined,
      endorsementsReceived: undefined,
    }

    return NextResponse.json(transformedUser)
  } catch (error) {
    console.error('Error fetching user:', error)
    return NextResponse.json(
      { error: 'Fehler beim Abrufen des Benutzers' },
      { status: 500 }
    )
  }
}

// PUT: Benutzer aktualisieren
export async function PUT(
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

    // Prüfe ob der Benutzer Admin ist
    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true }
    })

    if (!adminUser || adminUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Keine Administratorrechte' },
        { status: 403 }
      )
    }

    const data = await request.json()

    // Validierung
    if (!data.email || !data.name) {
      return NextResponse.json(
        { error: 'Fehlende Pflichtfelder' },
        { status: 400 }
      )
    }

    // Überprüfe, ob die E-Mail bereits von einem anderen Benutzer verwendet wird
    const existingUser = await prisma.user.findFirst({
      where: {
        email: data.email,
        NOT: {
          id: params.id
        }
      }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Diese E-Mail-Adresse wird bereits verwendet' },
        { status: 400 }
      )
    }

    // Erstelle das Update-Objekt
    const updateData: any = {
      email: data.email,
      name: data.name,
      role: data.role,
      title: data.title,
      bio: data.bio,
      contact: data.contact,
      image: data.image,
    }

    // Wenn ein neues Passwort gesetzt werden soll
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10)
    }

    // Aktualisiere den Benutzer und seine Einstellungen
    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...updateData,
        userSettings: {
          upsert: {
            create: {
              emailNotifications: data.settings?.emailNotifications ?? true,
              pushNotifications: data.settings?.pushNotifications ?? true,
              theme: data.settings?.theme || 'LIGHT',
              language: data.settings?.language || 'de',
            },
            update: {
              emailNotifications: data.settings?.emailNotifications,
              pushNotifications: data.settings?.pushNotifications,
              theme: data.settings?.theme,
              language: data.settings?.language,
            }
          }
        }
      },
      include: {
        userSettings: true
      }
    })

    // Entferne sensitive Daten
    const { password, ...userWithoutPassword } = updatedUser

    return NextResponse.json(userWithoutPassword)
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json(
      { error: 'Fehler beim Aktualisieren des Benutzers' },
      { status: 500 }
    )
  }
}

// DELETE: Benutzer löschen
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

    // Prüfe ob der Benutzer Admin ist
    const adminUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true }
    })

    if (!adminUser || adminUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Keine Administratorrechte' },
        { status: 403 }
      )
    }

    // Verhindere das Löschen des eigenen Accounts
    if (session.user.id === params.id) {
      return NextResponse.json(
        { error: 'Sie können Ihren eigenen Account nicht löschen' },
        { status: 400 }
      )
    }

    // Überprüfe, ob der zu löschende Benutzer der letzte Admin ist
    const userToDelete = await prisma.user.findUnique({
      where: { id: params.id },
      select: { role: true }
    })

    if (userToDelete?.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN' }
      })

      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'Der letzte Administrator kann nicht gelöscht werden' },
          { status: 400 }
        )
      }
    }

    // Bereinige zuerst alle abhängigen Daten
    await prisma.$transaction(async (prisma) => {
      // Lösche Benutzereinstellungen
      await prisma.userSettings.deleteMany({
        where: { userId: params.id }
      })

      // Lösche Skill-Verknüpfungen
      await prisma.userSkill.deleteMany({
        where: { userId: params.id }
      })

      // Lösche Badge-Verknüpfungen
      await prisma.userBadge.deleteMany({
        where: { userId: params.id }
      })

      // Lösche Kurs-Einschreibungen
      await prisma.enrollment.deleteMany({
        where: { userId: params.id }
      })

      // Lösche Chat-Mitgliedschaften und Nachrichten
      await prisma.chatMessage.deleteMany({
        where: { authorId: params.id }
      })
      await prisma.chatMember.deleteMany({
        where: { userId: params.id }
      })

      // Lösche Benachrichtigungen
      await prisma.notification.deleteMany({
        where: { userId: params.id }
      })

      // Lösche Likes
      await prisma.likePost.deleteMany({
        where: { userId: params.id }
      })
      await prisma.likeComment.deleteMany({
        where: { userId: params.id }
      })

      // Lösche Kommentare
      await prisma.comment.deleteMany({
        where: { authorId: params.id }
      })

      // Lösche Endorsements
      await prisma.endorsement.deleteMany({
        where: {
          OR: [
            { endorserId: params.id },
            { endorsedId: params.id }
          ]
        }
      })

      // Lösche Follower-Beziehungen
      await prisma.follow.deleteMany({
        where: {
          OR: [
            { followerId: params.id },
            { followingId: params.id }
          ]
        }
      })

      // Lösche Sessions
      await prisma.session.deleteMany({
        where: { userId: params.id }
      })

      // Lösche verknüpfte Konten
      await prisma.account.deleteMany({
        where: { userId: params.id }
      })

      // Lösche verknüpfte Kurse des Users
      await prisma.course.deleteMany({
        where: { instructorId: params.id }
      })

      // Lösche verknüpfte Projekte des Users
      await prisma.project.deleteMany({
        where: { authorId: params.id }  // Changed from userId to authorId
      })

      // Lösche alle Posts des Users
      await prisma.post.deleteMany({
        where: { authorId: params.id }
      })

      // Lösche die Artikel des Users
      await prisma.article.deleteMany({
        where: { authorId: params.id }
      })

      // Lösche die Ressourcen des Users
      await prisma.resource.deleteMany({
        where: { authorId: params.id }
      })

      // Lösche die H5P-Inhalte des Users
      await prisma.h5PContent.deleteMany({
        where: { userId: params.id }
      })

      // Lösche die Zertifikate des Users
      await prisma.certificate.deleteMany({
        where: { userId: params.id }
      })

      // Lösche den Benutzer selbst
      await prisma.user.delete({
        where: { id: params.id }
      })
    })

    return NextResponse.json({
      success: true,
      message: 'Benutzer erfolgreich gelöscht'
    })

  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json(
      { error: 'Fehler beim Löschen des Benutzers' },
      { status: 500 }
    )
  }
}
