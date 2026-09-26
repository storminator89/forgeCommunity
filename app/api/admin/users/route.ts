import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { emailEqualsInsensitive } from '@/lib/server/database-query'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/options'
import bcrypt from 'bcrypt'
import { adminUserInput } from '@/lib/server/account-security'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'

class AdminRoleLostError extends Error {}

// GET: Alle Benutzer abrufen
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: session?.user ? 'Keine Administratorrechte' : 'Nicht authentifiziert' },
        { status: session?.user ? 403 : 401 }
      )
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        title: true,
        contact: true,
        createdAt: true,
        lastLogin: true,
        skills: {
          select: {
            skill: true,
          }
        },
        _count: {
          select: {
            followers: true,
            following: true,
          }
        }
      }
    });

    const transformedUsers = users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      title: user.title,
      contact: user.contact,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      skills: user.skills.map(s => ({
        name: s.skill.name,
      })),
      stats: {
        followersCount: user._count.followers,
        followingCount: user._count.following,
      }
    }));

    return NextResponse.json(transformedUsers);
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json(
      { error: 'Fehler beim Abrufen der Benutzer' },
      { status: 500 }
    )
  }
}

// POST: Neuen Benutzer erstellen
export async function POST(request: NextRequest) {
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
    if (!parsed.success || !parsed.data.password) {
      return NextResponse.json(
        { error: 'Ungültige Benutzerdaten oder Passwort (12–72 UTF-8-Bytes, Groß-/Kleinbuchstaben, Zahl und Sonderzeichen erforderlich)' },
        { status: 400 }
      )
    }
    const data = parsed.data
    const { email, name } = data
    const password = data.password
    if (!password) return NextResponse.json({ error: 'Passwort erforderlich' }, { status: 400 })

    // Überprüfe, ob die E-Mail bereits existiert
    const existingUser = await prisma.user.findFirst({
      where: await emailEqualsInsensitive(email)
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Diese E-Mail-Adresse wird bereits verwendet' },
        { status: 400 }
      )
    }

    // Passwort hashen
    const hashedPassword = await bcrypt.hash(password, 12)

    // The authorization read and write share a serializable snapshot, so a
    // concurrent demotion cannot authorize a later account creation.
    const newUser = await prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({
        where: { id: session.user.id }, select: { role: true },
      })
      if (actor?.role !== 'ADMIN') throw new AdminRoleLostError()
      return tx.user.create({ data: {
        email,
        name,
        password: hashedPassword,
        role: data.role || 'USER',
        title: data.title || null,
        bio: data.bio || null,
        contact: data.contact || null,
        image: data.image || null,
        userSettings: {
          create: {
            emailNotifications: data.settings?.emailNotifications ?? true,
            pushNotifications: data.settings?.pushNotifications ?? true,
            theme: data.settings?.theme || 'LIGHT',
            language: data.settings?.language || 'de',
          }
        }
      }, include: { userSettings: true } })
    }, { isolationLevel: 'Serializable' })

    // Entferne das Passwort aus der Antwort
    const { password: _password, verificationToken: _verificationToken, resetPasswordToken: _resetPasswordToken, ...userWithoutPassword } = newUser

    // Optional: Sende Willkommens-E-Mail
    try {
      await sendWelcomeEmail(newUser.email, newUser.name ?? 'User')
    } catch (emailError) {
      console.error('Error sending welcome email:', emailError)
      // Fehler beim E-Mail-Versand sollte den Benutzer nicht am Erstellen hindern
    }

    return NextResponse.json(userWithoutPassword)

  } catch (error) {
    const inputError = requestErrorResponse(error)
    if (inputError) return inputError
    if (error instanceof AdminRoleLostError) {
      return NextResponse.json({ error: 'Keine Administratorrechte' }, { status: 403 })
    }
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 'P2034') return NextResponse.json({ error: 'Gleichzeitige Änderung. Bitte erneut versuchen.' }, { status: 409 })
      if (error.code === 'P2002') return NextResponse.json({ error: 'Diese E-Mail-Adresse wird bereits verwendet' }, { status: 409 })
    }
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Fehler beim Erstellen des Benutzers' },
      { status: 500 }
    )
  }
}

// Hilfsfunktion für Willkommens-E-Mail
async function sendWelcomeEmail(email: string, name: string | null) {
  const displayName = name ?? 'User'
  // Implementieren Sie hier Ihre E-Mail-Logik
  // Beispiel mit nodemailer oder einem E-Mail-Service Ihrer Wahl
  console.log(`Welcome email would be sent to ${email} for ${displayName}`)
}
