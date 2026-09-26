// app/api/skills/route.ts

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readJsonObject, requestErrorResponse } from "@/lib/server/api-input";

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

  try {
    const { name, category } = await readJsonObject(request);
    if (typeof name !== "string" || !name.trim() || name.length > 120 ||
        (category !== undefined && (typeof category !== "string" || category.length > 120))) {
      return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
    }
    const normalizedName = name.trim();
    // Überprüfen, ob die Fähigkeit bereits existiert
    const existingSkill = await prisma.skill.findUnique({
      where: { name: normalizedName },
    });

    if (existingSkill) {
      return NextResponse.json({ error: "Fähigkeit existiert bereits." }, { status: 400 });
    }

    // Neue Fähigkeit erstellen
    const newSkill = await prisma.skill.create({
      data: {
        name: normalizedName,
        category: category?.trim() || "Unkategorisiert",
      },
    });

    return NextResponse.json(newSkill, { status: 201 });
  } catch (error) {
    const invalidRequest = requestErrorResponse(error);
    if (invalidRequest) return invalidRequest;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Fähigkeit existiert bereits." }, { status: 409 });
    }
    console.error("Fehler beim Erstellen der Fähigkeit:", error);
    return NextResponse.json({ error: "Fehler beim Erstellen der Fähigkeit." }, { status: 500 });
  }
}
