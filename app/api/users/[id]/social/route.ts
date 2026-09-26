import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { socialLinksInput } from '@/lib/server/profile-input';

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || (session.user.id !== params.id && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      );
    }

    const parsed = socialLinksInput.safeParse(await readJsonObject(request));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Ungültige sozialen Links' }, { status: 400 });
    }
    const cleanedData = parsed.data;

    // Update des Benutzers
    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: {
        socialLinks: cleanedData
      },
      select: {
        id: true,
        socialLinks: true
      }
    });

    return NextResponse.json({
      success: true,
      socialLinks: updatedUser.socialLinks
    });

  } catch (error) {
    const invalidBody = requestErrorResponse(error);
    if (invalidBody) return invalidBody;
    console.error('Error updating social links:', error);
    return NextResponse.json(
      { error: 'Fehler beim Aktualisieren der sozialen Links' },
      { status: 500 }
    );
  }
}

// GET-Methode zum Abrufen der aktuellen Links
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        socialLinks: true
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      socialLinks: user.socialLinks || {}
    });

  } catch (error) {
    console.error('Error fetching social links:', error);
    return NextResponse.json(
      { error: 'Fehler beim Abrufen der sozialen Links' },
      { status: 500 }
    );
  }
}
