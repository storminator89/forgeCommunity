// app/api/user/skills/[id]/route.ts

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const userId = session.user.id;
  const skillId = params.id;
  const { level } = await request.json();

  if (typeof level !== "number") {
    return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
  }

  try {
    const updatedSkill = await prisma.userSkill.updateMany({
      where: {
        userId,
        skillId,
      },
      data: { level },
    });

    if (updatedSkill.count === 0) {
      return NextResponse.json({ error: "Fähigkeit nicht gefunden." }, { status: 404 });
    }

    return NextResponse.json({ message: "Fähigkeit erfolgreich aktualisiert." }, { status: 200 });
  } catch (error) {
    console.error("Fehler beim Aktualisieren der Fähigkeit:", error);
    return NextResponse.json({ error: "Fehler beim Aktualisieren der Fähigkeit." }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const userId = session.user.id;
  const skillId = params.id;

  try {
    const deletedSkill = await prisma.userSkill.deleteMany({
      where: {
        userId,
        skillId,
      },
    });

    if (deletedSkill.count === 0) {
      return NextResponse.json({ error: "Fähigkeit nicht gefunden." }, { status: 404 });
    }

    return NextResponse.json({ message: "Fähigkeit erfolgreich gelöscht." }, { status: 200 });
  } catch (error) {
    console.error("Fehler beim Löschen der Fähigkeit:", error);
    return NextResponse.json({ error: "Fehler beim Löschen der Fähigkeit." }, { status: 500 });
  }
}
