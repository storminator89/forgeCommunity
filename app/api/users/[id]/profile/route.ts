import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/options'
import prisma from '@/lib/prisma'

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
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

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: params.id },
        data: {
          name,
          bio,
          title,
          contact,
        },
      })

      if (skills && Array.isArray(skills)) {
        await tx.userSkill.deleteMany({
          where: { userId: params.id },
        })

        if (skills.length > 0) {
          await tx.userSkill.createMany({
            data: skills.map((skill) => ({
              userId: params.id,
              skillId: skill.id,
              level: skill.level,
            })),
          })
        }
      }

      return user
    })

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
