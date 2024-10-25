import { writeFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/options';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session) {
            return NextResponse.json(
                { error: 'Nicht autorisiert' },
                { status: 401 }
            );
        }

        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json(
                { error: 'Keine Datei hochgeladen' },
                { status: 400 }
            );
        }

        // Überprüfen Sie den Dateityp
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { error: 'Ungültiger Dateityp. Nur JPEG, PNG und GIF sind erlaubt.' },
                { status: 400 }
            );
        }

        // Maximale Dateigröße (5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB in Bytes
        if (file.size > maxSize) {
            return NextResponse.json(
                { error: 'Datei ist zu groß. Maximale Größe ist 5MB.' },
                { status: 400 }
            );
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Generieren Sie einen eindeutigen Dateinamen
        const fileExt = path.extname(file.name);
        const fileName = `${uuidv4()}${fileExt}`;
        const filePath = path.join(process.cwd(), 'public', 'images', 'uploads', fileName);

        // Speichern Sie die Datei
        await writeFile(filePath, buffer);

        // Aktualisieren Sie das Benutzerprofil mit dem neuen Bildpfad
        await prisma.user.update({
            where: {
                id: session.user.id,
            },
            data: {
                image: `/images/uploads/${fileName}`,
            },
        });

        return NextResponse.json({ 
            success: true, 
            filePath: `/images/uploads/${fileName}` 
        });

    } catch (error) {
        console.error('Fehler beim Hochladen:', error);
        return NextResponse.json(
            { error: 'Fehler beim Hochladen der Datei' },
            { status: 500 }
        );
    }
}
