import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { emailEqualsInsensitive } from '@/lib/server/database-query'
import { getServerSession } from '@/lib/sites-auth/server'
import { authOptions } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import { adminUserInput } from '@/lib/server/account-security'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'
import { deleteCourseDependencies } from '@/lib/server/course-deletion'
import { decrementSkillEndorsementsForDeletedUser } from '@/lib/server/skill-endorsements'
import { reconcileUserRewards } from '@/lib/server/rewards'
import { readAsAdmin } from '@/lib/server/admin-read'
import { SpaceApiError } from '@/lib/server/space-api'
import { isUserEmailConflict } from '@/lib/server/database-conflicts'
import { invitationTransaction, revokeAccountMissionInvitations, eraseAccountMissionInvitations } from '@/lib/server/space-mission-invitation-state'

class LastAdminError extends Error {}
class MissingUserError extends Error {}
class OtherLearnersHaveCertificatesError extends Error {}

function mutationError(error: unknown): NextResponse | null {
  if (error instanceof LastAdminError) {
    return NextResponse.json({ error: 'Der letzte Administrator muss erhalten bleiben' }, { status: 400 })
  }
  if (error instanceof MissingUserError) {
    return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 404 })
  }
  if (error instanceof OtherLearnersHaveCertificatesError) {
    return NextResponse.json({ error: 'Dieses Konto kann nicht gelöscht werden, weil andere Mitglieder Zertifikate für seine Kurse besitzen. Es wurden keine Daten gelöscht.' }, { status: 409 })
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') {
    return NextResponse.json({ error: 'Gleichzeitige Änderung. Bitte erneut versuchen.' }, { status: 409 })
  }
  if (error instanceof SpaceApiError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (isUserEmailConflict(error)) {
    return NextResponse.json({ error: 'Diese E-Mail-Adresse wird bereits verwendet' }, { status: 409 })
  }
  return requestErrorResponse(error)
}

// GET: Einzelnen Benutzer abrufen
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      )
    }

    const result = await readAsAdmin(session.user.id, tx => tx.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        coverImage: true,
        bio: true,
        title: true,
        contact: true,
        role: true,
        isTestAccount: true,
        createdAt: true,
        updatedAt: true,
        lastLogin: true,
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
    }))
    if (!result.authorized) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
    }
    const user = result.data

    if (!user) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 404 }
      )
    }

    // Transformiere die Daten für die Frontend-Anzeige
    const transformedUser = {
      ...user,
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

    return NextResponse.json(transformedUser, { headers: { 'Cache-Control': 'private, no-store' } })
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

    const parsed = adminUserInput.safeParse(await readJsonObject(request))
    if (!parsed.success || (parsed.data.password !== undefined && !parsed.data.password)) {
      return NextResponse.json(
        { error: 'Ungültige Benutzerdaten oder Passwort' },
        { status: 400 }
      )
    }
    const data = parsed.data
    const { email, name } = data

    // Überprüfe, ob die E-Mail bereits von einem anderen Benutzer verwendet wird
    const existingUser = await prisma.user.findFirst({
      where: {
        ...(await emailEqualsInsensitive(email)),
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

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { email: true },
    })

    if (!targetUser) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 404 }
      )
    }

    const emailChanged = targetUser.email.trim().toLowerCase() !== email

    // Erstelle das Update-Objekt
    const updateData: any = {
      email,
      name,
      role: data.role,
      title: data.title,
      bio: data.bio,
      contact: data.contact,
      image: data.image,
    }

    if (emailChanged) {
      updateData.emailVerified = null
      updateData.verificationToken = null
      updateData.resetPasswordToken = null
    }

    // Wenn ein neues Passwort gesetzt werden soll
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 12)
    }

    // Aktualisiere den Benutzer und seine Einstellungen
    const updatedUser = await invitationTransaction(async tx => {
      const actingAdmin = await tx.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
      if (actingAdmin?.role !== 'ADMIN') throw new LastAdminError()
      const target = await tx.user.findUnique({ where: { id: params.id }, select: { role: true } })
      if (!target) throw new MissingUserError()
      if (target.role === 'ADMIN' && data.role && data.role !== 'ADMIN') {
        const adminCount = await tx.user.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) throw new LastAdminError()
      }
      const updated = await tx.user.update({
        where: { id: params.id },
        data: {
          ...updateData,
          ...(data.settings && { userSettings: {
            upsert: {
              create: {
                emailNotifications: data.settings.emailNotifications ?? true,
                pushNotifications: data.settings.pushNotifications ?? true,
                theme: data.settings.theme ?? 'LIGHT',
                language: data.settings.language ?? 'de',
              },
              update: data.settings,
            }
          } }),
        },
        include: { userSettings: true },
      })
      // Role changes out of USER revoke consent. Returning to USER requires a
      // fresh self-join; old epochs and capacity slots cannot reactivate.
      if (target.role === 'USER' && updated.role !== 'USER') {
        await revokeAccountMissionInvitations(params.id, tx)
        await tx.spaceMissionParticipation.updateMany({ where: { userId: params.id, optedOutAt: null },
          data: { optedOutAt: new Date() } })
      }
      if (target?.role !== updated.role) await reconcileUserRewards(tx, params.id)
      return updated
    })


    // Entferne sensitive Daten
    const {
      password: _password,
      verificationToken: _verificationToken,
      resetPasswordToken: _resetPasswordToken,
      ...userWithoutPassword
    } = updatedUser

    return NextResponse.json(userWithoutPassword)
  } catch (error) {
    const handled = mutationError(error)
    if (handled) return handled
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

    // Every retry must re-read the owner and their certificates before any
    // destructive write. A concurrent issuance can then abort serialization
    // and the next attempt will see the newly issued proof.
    await invitationTransaction(async (prisma) => {
      const actingAdmin = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
      if (actingAdmin?.role !== 'ADMIN') throw new LastAdminError()
      const target = await prisma.user.findUnique({ where: { id: params.id }, select: { role: true } })
      if (!target) throw new MissingUserError()
      if (target.role === 'ADMIN') {
        const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) throw new LastAdminError()
      }
      const ownedCourses = await prisma.course.findMany({
        where: { instructorId: params.id }, select: { id: true },
      })
      if (ownedCourses.length) {
        const otherLearnerCertificate = await prisma.certificate.findFirst({
          where: { courseId: { in: ownedCourses.map(course => course.id) }, userId: { not: params.id } },
          select: { id: true },
        })
        if (otherLearnerCertificate) throw new OtherLearnersHaveCertificatesError()
      }

      await eraseAccountMissionInvitations(params.id, prisma)

      // Lösche Benutzereinstellungen
      await prisma.userSettings.deleteMany({
        where: { userId: params.id }
      })

      await decrementSkillEndorsementsForDeletedUser(prisma, params.id)

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
      const givenEndorsements = await prisma.endorsement.findMany({
        where: { endorserId: params.id, endorsedId: { not: params.id } },
        select: { endorsedId: true },
      })
      for (const endorsement of givenEndorsements) {
        const updated = await prisma.user.updateMany({
          where: { id: endorsement.endorsedId, endorsements: { gte: 1 } },
          data: { endorsements: { decrement: 1 } },
        })
        if (updated.count !== 1) throw new Error('Endorsement count is inconsistent')
      }
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

      // Certificates can point both at this user and at courses owned by
      // this instructor, including certificates issued to other users.
      await prisma.certificate.deleteMany({ where: { userId: params.id } })
      await deleteCourseDependencies(prisma, ownedCourses.map(course => course.id))

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
    const handled = mutationError(error)
    if (handled) return handled
    console.error('Error deleting user:', error)
    return NextResponse.json(
      { error: 'Fehler beim Löschen des Benutzers' },
      { status: 500 }
    )
  }
}
