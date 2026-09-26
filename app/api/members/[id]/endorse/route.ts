// app/api/members/[id]/endorse/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next"; // Annahme: NextAuth.js wird verwendet
import { authOptions } from "@/lib/auth"; // Pfad zu deinen Auth-Optionen
import prisma from '@/lib/prisma';

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: endorsedId } = params;
  if (!endorsedId.trim()) {
    return NextResponse.json({ error: "Ungültige Benutzer-ID." }, { status: 400 });
  }

  // Hole die aktuelle Sitzung
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.id) {
    return NextResponse.json({ error: "Nicht authentifiziert" }, { status: 401 });
  }

  const endorserId = session.user.id;

  // Verhindere, dass ein Benutzer sich selbst empfiehlt
  if (endorserId === endorsedId) {
    return NextResponse.json({ error: "Du kannst dich nicht selbst empfehlen." }, { status: 400 });
  }

  try {
    // Überprüfe, ob der Endorser bereits den Endorsed empfohlen hat
    const existingEndorsement = await prisma.endorsement.findUnique({
      where: {
        endorserId_endorsedId: {
          endorserId,
          endorsedId,
        },
      },
    });

    if (existingEndorsement) {
      return NextResponse.json({ error: "Du hast dieses Mitglied bereits empfohlen." }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.endorsement.create({
        data: {
          endorser: { connect: { id: endorserId } },
          endorsed: { connect: { id: endorsedId } },
        },
      }),
      prisma.user.update({
        where: { id: endorsedId },
        data: { endorsements: { increment: 1 } },
      }),
    ]);

    return NextResponse.json({ message: "Mitglied erfolgreich empfohlen." }, { status: 200 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "P2002") {
        return NextResponse.json({ error: "Du hast dieses Mitglied bereits empfohlen." }, { status: 409 });
      }
      if (error.code === "P2025" || error.code === "P2003") {
        return NextResponse.json({ error: "Mitglied nicht gefunden." }, { status: 404 });
      }
    }
    console.error("Fehler beim Empfehlen des Mitglieds:", error);
    return NextResponse.json({ error: "Fehler beim Empfehlen des Mitglieds." }, { status: 500 });
  }
}
