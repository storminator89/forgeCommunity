// app/api/members/route.ts

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  try {
    const members = await prisma.user.findMany({
      where: {
        // Optional: Füge hier Filter hinzu, falls du nur bestimmte Benutzer als Mitglieder behandeln möchtest
        // Beispiel: role: 'USER'
      },
      select: {
        id: true,
        name: true,
        image: true, // Verwende 'image' statt 'avatar'
        title: true, // Erforderlich
        bio: true,
        contact: true, // Erforderlich
        endorsements: true, // Erforderlich
        skills: {
          select: {
            skill: {
              select: {
                name: true,
                category: true,
              },
            },
            level: true,
          },
        },
      },
    });

    // Formatiere die Daten, um 'image' als 'avatar' zurückzugeben
    const formattedMembers = members.map(member => ({
      id: member.id,
      name: member.name,
      avatar: member.image, // Mappe 'image' zu 'avatar'
      title: member.title,
      bio: member.bio,
      contact: member.contact,
      endorsements: member.endorsements,
      skills: member.skills.map(ms => ({
        skillName: ms.skill.name,
        level: ms.level,
      })),
    }));

    return NextResponse.json(formattedMembers);
  } catch (error) {
    console.error("Fehler beim Abrufen der Mitglieder:", error);
    return NextResponse.json({ error: "Fehler beim Abrufen der Mitglieder" }, { status: 500 });
  }
}
