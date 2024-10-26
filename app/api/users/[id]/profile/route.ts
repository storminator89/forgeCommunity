import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/options'

const prisma = new PrismaClient()

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user || (session.user.id !== params.id && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      )
    }

    const data = await request.json()
    
    // Validiere die Eingaben
    const {
      name,
      bio,
      title,
      contact,
      socialLinks,
      skills,
      ...otherData
    } = data

    // Update Hauptprofil
    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: {
        name,
        bio,
        title,
        contact,
      },
    })

    // Update Skills
    if (skills && Array.isArray(skills)) {
      // Lösche alte Skills
      await prisma.userSkill.deleteMany({
        where: { userId: params.id },
      })

      // Füge neue Skills hinzu
      for (const skill of skills) {
        await prisma.userSkill.create({
          data: {
            userId: params.id,
            skillId: skill.id,
            level: skill.level,
          },
        })
      }
    }

    // Update Social Links (falls Sie eine separate Tabelle dafür haben)
    if (socialLinks) {
      // Implementieren Sie hier die Logik für Social Links
    }

    return NextResponse.json({
      success: true,
      user: updatedUser,
    })
  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json(
      { error: 'Fehler beim Aktualisieren des Profils' },
      { status: 500 }
    )
  }
}