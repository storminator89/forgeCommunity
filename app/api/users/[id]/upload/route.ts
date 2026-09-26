import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { deleteUploadedImage, ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';
import { consumeRateLimit, rateLimitHeaders, UPLOAD_RATE_LIMIT } from '@/lib/server/rate-limit';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;

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

    const uploadRate = consumeRateLimit(`upload:user:${session.user.id}`, UPLOAD_RATE_LIMIT);
    if (!uploadRate.allowed) {
      return NextResponse.json({ error: 'Zu viele Uploads.' }, { status: 429, headers: rateLimitHeaders(uploadRate) });
    }

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Datei ist zu gross.' }, { status: 413 });
    }

    const limitedRequest = await requestWithBodyLimit(request, MAX_MULTIPART_REQUEST_BYTES);
    const formData = await limitedRequest.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as 'avatar' | 'cover';

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Keine Datei gefunden' },
        { status: 400 }
      );
    }

    if (type !== 'avatar' && type !== 'cover') {
      return NextResponse.json({ error: 'Ungültiger Bildtyp' }, { status: 400 });
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
      { error: error instanceof ImageUploadValidationError ? error.message : 'Fehler beim Hochladen des Bildes' },
      { status: error instanceof ImageUploadValidationError ? 400 : error instanceof RequestBodyLimitError ? 413 : 500 }
    );
  }
}
