import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/options'
import prisma from '@/lib/prisma'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'
import { publicProfileInput } from '@/lib/server/profile-input'

class InvalidProfileSkillsError extends Error {}

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

    const parsed = publicProfileInput.safeParse(await readJsonObject(request))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Ungültige Profildaten' }, { status: 400 })
    }
    const { name, bio, title, contact, image, socialLinks, skills } = parsed.data

    const updatedUser = await prisma.$transaction(async (tx) => {
      // The profile API has historically received either a Skill.id or an
      // owned UserSkill.id as `id`. Resolve both before changing any row.
      let wantedSkills: { skillId: string; level: number }[] | undefined
      if (skills !== undefined) {
        const existing = await tx.userSkill.findMany({
          where: { userId: params.id }, select: { id: true, skillId: true },
        })
        const byOwnedId = new Map(existing.map(row => [row.id, row.skillId]))
        wantedSkills = skills.map(({ id, level }) => ({
          skillId: byOwnedId.get(id) ?? id, level,
        }))
        const skillIds = wantedSkills.map(skill => skill.skillId)
        if (new Set(skillIds).size !== skillIds.length) throw new InvalidProfileSkillsError()
        if (skillIds.length) {
          const valid = await tx.skill.findMany({
            where: { id: { in: skillIds } }, select: { id: true },
          })
          if (valid.length !== skillIds.length) throw new InvalidProfileSkillsError()
        }
        await tx.userSkill.deleteMany({
          where: { userId: params.id, skillId: { notIn: skillIds } },
        })
        for (const skill of wantedSkills) {
          await tx.userSkill.upsert({
            where: { userId_skillId: { userId: params.id, skillId: skill.skillId } },
            update: { level: skill.level },
            create: { userId: params.id, skillId: skill.skillId, level: skill.level },
          })
        }
      }

      const user = await tx.user.update({
        where: { id: params.id },
        data: {
          name,
          bio,
          title,
          contact,
          image,
          ...(socialLinks && { socialLinks }),
        },
        // Keep credentials and account recovery claims out of the response.
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          bio: true,
          title: true,
          contact: true,
          socialLinks: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      return user
    })

    const safeUser = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      image: updatedUser.image,
      bio: updatedUser.bio,
      title: updatedUser.title,
      contact: updatedUser.contact,
      socialLinks: updatedUser.socialLinks,
      role: updatedUser.role,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    }

    return NextResponse.json({
      success: true,
      user: safeUser,
    })
  } catch (error) {
    const invalidBody = requestErrorResponse(error)
    if (invalidBody) return invalidBody
    if (error instanceof InvalidProfileSkillsError) {
      return NextResponse.json({ error: 'Ungültige oder doppelte Fähigkeiten' }, { status: 400 })
    }
    console.error('Error updating profile:', error)
    return NextResponse.json(
      { error: 'Fehler beim Aktualisieren des Profils' },
      { status: 500 }
    )
  }
}
