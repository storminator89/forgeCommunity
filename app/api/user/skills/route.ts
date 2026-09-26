// app/api/user/skills/route.ts

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readJsonObject, requestErrorResponse } from "@/lib/server/api-input";

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
  try {
    const { skillId, level } = await readJsonObject(request);
    if (typeof skillId !== "string" || !skillId.trim() || typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
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
    const invalidRequest = requestErrorResponse(error);
    if (invalidRequest) return invalidRequest;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Fähigkeit bereits hinzugefügt." }, { status: 409 });
    }
    console.error("Fehler beim Hinzufügen der Fähigkeit:", error);
    return NextResponse.json({ error: "Fehler beim Hinzufügen der Fähigkeit." }, { status: 500 });
  }
}
