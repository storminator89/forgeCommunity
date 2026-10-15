import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

/** The authenticated skills workbench needs more than the public member list. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Nicht authentifiziert.' }, { status: 401 });
  }

  try {
    const [skills, members] = await Promise.all([
      prisma.skill.findMany({
        select: { id: true, name: true, category: true },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          image: true,
          title: true,
          endorsements: true,
          skills: { select: { level: true, skill: { select: { name: true } } } },
          endorsementsReceived: {
            where: { endorserId: session.user.id },
            select: { id: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return NextResponse.json({
      skills,
      members: members.map(member => ({
        id: member.id,
        name: member.name || 'Unbekannt',
        avatar: member.image || '',
        title: member.title || '',
        endorsements: member.endorsements,
        hasEndorsed: member.endorsementsReceived.length > 0,
        skills: member.skills.map(item => ({ skillName: item.skill.name, level: item.level })),
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Fehler beim Laden des Skill-Verzeichnisses:', error);
    return NextResponse.json({ error: 'Skill-Verzeichnis konnte nicht geladen werden.' }, { status: 500 });
  }
}
