// app/api/members/route.ts

import { NextResponse } from "next/server";
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const members = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        image: true,
        title: true,
        role: true,
        createdAt: true,
        _count: {
          select: { followers: true },
        },
        skills: {
          select: {
            skill: {
              select: { name: true },
            },
          },
        },
      },
    });

    const formattedMembers = members.map(member => ({
      id: member.id,
      name: member.name,
      image: member.image,
      title: member.title,
      role: member.role,
      createdAt: member.createdAt,
      followers: member._count.followers,
      skills: member.skills.map(({ skill }) => skill.name),
    }));

    return NextResponse.json(formattedMembers);
  } catch (error) {
    console.error("Fehler beim Abrufen der Mitglieder:", error);
    return NextResponse.json({ error: "Fehler beim Abrufen der Mitglieder" }, { status: 500 });
  }
}
