// app/api/members/[id]/endorse/route.ts

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth/next"; // Annahme: NextAuth.js wird verwendet
import { authOptions } from "@/lib/auth"; // Pfad zu deinen Auth-Optionen

const prisma = new PrismaClient();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { id: endorsedId } = params;

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

    // Erstelle die Empfehlung
    await prisma.endorsement.create({
      data: {
        endorser: { connect: { id: endorserId } },
        endorsed: { connect: { id: endorsedId } },
      },
    });

    // Erhöhe die endorsements-Zahl des Endorsed Benutzers
    await prisma.user.update({
      where: { id: endorsedId },
      data: { endorsements: { increment: 1 } },
    });

    return NextResponse.json({ message: "Mitglied erfolgreich empfohlen." }, { status: 200 });
  } catch (error) {
    console.error("Fehler beim Empfehlen des Mitglieds:", error);
    return NextResponse.json({ error: "Fehler beim Empfehlen des Mitglieds." }, { status: 500 });
  }
}
