import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/options';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// New route segment config format
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

// Funktion zum Erstellen des Upload-Verzeichnisses, falls es nicht existiert
async function ensureUploadDirectory() {
  const uploadDir = path.join(process.cwd(), 'public', 'images', 'uploads');
  if (!existsSync(uploadDir)) {
    try {
      await mkdir(uploadDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create upload directory:', error);
      throw error;
    }
  }
  return uploadDir;
}

// Funktion zum Generieren eines eindeutigen Dateinamens
function generateUniqueFileName(originalName: string, type: string): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  const extension = path.extname(originalName);
  return `${type}-${timestamp}-${random}${extension}`;
}

// Funktion zum Validieren des Dateityps
function isValidImageType(mimeType: string): boolean {
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  return validTypes.includes(mimeType);
}

export async function POST(
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
  
      const formData = await request.formData();
      const file = formData.get('file') as File;
      const type = formData.get('type') as 'avatar' | 'cover';
  
      if (!file) {
        return NextResponse.json(
          { error: 'Keine Datei gefunden' },
          { status: 400 }
        );
      }
  
      // Validiere Dateityp
      if (!isValidImageType(file.type)) {
        return NextResponse.json(
          { error: 'Ungültiger Dateityp. Erlaubt sind: JPG, PNG, GIF, WebP' },
          { status: 400 }
        );
      }
  
      // Validiere Dateigröße (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'Datei ist zu groß (max 5MB)' },
          { status: 400 }
        );
      }
  
      // Erstelle Upload-Verzeichnis
      const uploadDir = await ensureUploadDirectory();
  
      // Generiere eindeutigen Dateinamen
      const fileName = generateUniqueFileName(file.name, type);
      const filePath = path.join(uploadDir, fileName);
  
      // Konvertiere File zu Buffer und speichere
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
  
      // Speichere Datei
      await writeFile(filePath, buffer);
  
      // Erstelle öffentliche URL
      const publicUrl = `/images/uploads/${fileName}`;
  
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
          const oldFilePath = path.join(process.cwd(), 'public', oldImagePath);
          if (existsSync(oldFilePath) && oldImagePath.includes('/uploads/')) {
            await unlink(oldFilePath);
          }
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
        { error: 'Fehler beim Hochladen des Bildes' },
        { status: 500 }
      );
    }
  }