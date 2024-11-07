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

    const users = await prisma.user.findMany({
      include: {
        skills: {
          include: {
            skill: true,
          }
        },
        userSettings: true,
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
