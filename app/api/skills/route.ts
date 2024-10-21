// app/api/skills/route.ts

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Handler für GET-Anfragen: Alle verfügbaren Skills abrufen
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  try {
    const skills = await prisma.skill.findMany({
      orderBy: { name: "asc" },
    });
    return NextResponse.json(skills, { status: 200 });
  } catch (error) {
    console.error("Fehler beim Abrufen der Fähigkeiten:", error);
    return NextResponse.json({ error: "Fehler beim Abrufen der Fähigkeiten." }, { status: 500 });
  }
}

// Handler für POST-Anfragen: Neue Skill erstellen
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const { name, category } = await request.json();

  if (!name) {
    return NextResponse.json({ error: "Name der Fähigkeit ist erforderlich." }, { status: 400 });
  }

  try {
    // Überprüfen, ob die Fähigkeit bereits existiert
    const existingSkill = await prisma.skill.findUnique({
      where: { name },
    });

    if (existingSkill) {
      return NextResponse.json({ error: "Fähigkeit existiert bereits." }, { status: 400 });
    }

    // Neue Fähigkeit erstellen
    const newSkill = await prisma.skill.create({
      data: {
        name,
        category: category || "Unkategorisiert",
      },
    });

    return NextResponse.json(newSkill, { status: 201 });
  } catch (error) {
    console.error("Fehler beim Erstellen der Fähigkeit:", error);
    return NextResponse.json({ error: "Fehler beim Erstellen der Fähigkeit." }, { status: 500 });
  }
}
