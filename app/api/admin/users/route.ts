import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/options'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// GET: Alle Benutzer abrufen
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    console.log("Backend Session:", session); // Debugging

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      )
    }

    // Prüfe ob der Benutzer Admin ist
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true }
    })

    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Keine Administratorrechte' },
        { status: 403 }
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
        bio: true,
        contact: true,
        endorsements: true,
        emailVerified: true,
        lastLogin: true,
        createdAt: true,
        userSettings: {
          select: {
            emailNotifications: true,
            pushNotifications: true,
            theme: true,
            language: true,
          }
        },
        // Statistiken
        posts: { select: { id: true } },
        comments: { select: { id: true } },
        likePosts: { select: { id: true } },
        courses: { select: { id: true } },
        projects: { select: { id: true } },
        badges: {
          select: {
            badge: {
              select: {
                name: true,
              }
            },
            awardedAt: true,
          }
        },
        skills: {
          select: {
            skill: {
              select: {
                name: true,
              }
            },
            level: true,
          }
        },
      }
    })

    // Transformiere die Daten für die Frontend-Anzeige
    const transformedUsers = users.map(user => ({
      ...user,
      stats: {
        postsCount: user.posts.length,
        commentsCount: user.comments.length,
        likesReceived: user.likePosts.length,
        coursesCount: user.courses.length,
        projectsCount: user.projects.length,
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
    }))

    return NextResponse.json(transformedUsers)
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
    
    console.log("Create User Session:", session)

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
    if (!data.email || !data.password || !data.name) {
      return NextResponse.json(
        { error: 'Fehlende Pflichtfelder' },
        { status: 400 }
      )
    }

    // Überprüfe, ob die E-Mail bereits existiert
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Diese E-Mail-Adresse wird bereits verwendet' },
        { status: 400 }
      )
    }

    // Passwort hashen
    const hashedPassword = await bcrypt.hash(data.password, 10)

    // Erstelle den neuen Benutzer mit allen Daten
    const newUser = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
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
      },
      include: {
        userSettings: true
      }
    })

    // Entferne das Passwort aus der Antwort
    const { password, ...userWithoutPassword } = newUser

    // Optional: Sende Willkommens-E-Mail
    try {
      await sendWelcomeEmail(newUser.email, newUser.name)
    } catch (emailError) {
      console.error('Error sending welcome email:', emailError)
      // Fehler beim E-Mail-Versand sollte den Benutzer nicht am Erstellen hindern
    }

    return NextResponse.json(userWithoutPassword)

  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Fehler beim Erstellen des Benutzers' },
      { status: 500 }
    )
  }
}

// Hilfsfunktion für Willkommens-E-Mail
async function sendWelcomeEmail(email: string, name: string) {
  // Implementieren Sie hier Ihre E-Mail-Logik
  // Beispiel mit nodemailer oder einem E-Mail-Service Ihrer Wahl
  console.log(`Welcome email would be sent to ${email} for ${name}`)
}
