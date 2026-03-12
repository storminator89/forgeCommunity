import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { deleteUploadedImage, ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload';

// New route segment config format
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';



export async function POST(
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

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as 'avatar' | 'cover';

    if (!file) {
      return NextResponse.json(
        { error: 'Keine Datei gefunden' },
        { status: 400 }
      );
    }

    const uploadType = type === 'cover' ? 'cover' : 'avatar';
    const publicUrl = await saveImageUpload(file, uploadType);

    // Hole aktuellen Benutzer mit relevanten Bildern
    const currentUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        image: true,
        coverImage: true,
      }
    });

    // Bestimme altes Bild basierend auf Upload-Typ
    const oldImagePath = type === 'avatar' ? currentUser?.image : currentUser?.coverImage;

    // Lösche altes Bild wenn vorhanden
    if (oldImagePath) {
      try {
        await deleteUploadedImage(oldImagePath);
      } catch (error) {
        console.error('Error deleting old image:', error);
      }
    }

    // Update User in der Datenbank
    const updateData = type === 'avatar'
      ? { image: publicUrl }
      : { coverImage: publicUrl };

    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      url: publicUrl,
    });

  } catch (error) {
    console.error('Error uploading image:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Fehler beim Hochladen des Bildes' },
      { status: error instanceof ImageUploadValidationError ? 400 : 500 }
    );
  }
}
