import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";

interface SocialLinks {
  github?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  website?: string | null;
}

function isValidUrl(url: string | null): boolean {
  if (!url) return true;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || (session.user.id !== params.id && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      );
    }

    const data = await request.json() as SocialLinks;

    // Validiere URLs
    const invalidUrls = Object.entries(data)
      .filter(([_, url]) => url && !isValidUrl(url))
      .map(([key]) => key);

    if (invalidUrls.length > 0) {
      return NextResponse.json(
        {
          error: 'Ungültige URLs für: ' + invalidUrls.join(', ')
        },
        { status: 400 }
      );
    }

    // Entferne leere Strings und ersetze sie durch null
    const cleanedData = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value?.trim() || null
      ])
    );

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
  { params }: { params: { id: string } }
) {
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