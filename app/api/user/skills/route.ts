// app/api/user/skills/route.ts

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const userSkills = await prisma.userSkill.findMany({
      where: { userId },
      include: { skill: true }, // Stellen Sie sicher, dass das Skill-Objekt eingeschlossen ist
    });
    return NextResponse.json(userSkills, { status: 200 });
  } catch (error) {
    console.error("Fehler beim Abrufen der Fähigkeiten:", error);
    return NextResponse.json({ error: "Fehler beim Abrufen der Fähigkeiten." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const userId = session.user.id;
  const { skillId, level } = await request.json();

  if (!skillId || typeof level !== "number") {
    return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
  }

  try {
    // Überprüfen, ob die Fähigkeit existiert
    const skill = await prisma.skill.findUnique({
      where: { id: skillId },
    });

    if (!skill) {
      return NextResponse.json({ error: "Fähigkeit nicht gefunden." }, { status: 404 });
    }

    // Überprüfen, ob der Benutzer die Fähigkeit bereits hat
    const existingUserSkill = await prisma.userSkill.findUnique({
      where: {
        userId_skillId: {
          userId,
          skillId,
        },
      },
    });

    if (existingUserSkill) {
      return NextResponse.json({ error: "Fähigkeit bereits hinzugefügt." }, { status: 400 });
    }

    // Neue Fähigkeit hinzufügen
    const newUserSkill = await prisma.userSkill.create({
      data: {
        userId,
        skillId,
        level,
      },
    });

    return NextResponse.json(newUserSkill, { status: 201 });
  } catch (error) {
    console.error("Fehler beim Hinzufügen der Fähigkeit:", error);
    return NextResponse.json({ error: "Fehler beim Hinzufügen der Fähigkeit." }, { status: 500 });
  }
}
