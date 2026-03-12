import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/options";
import prisma from '@/lib/prisma';
import { ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload';

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

        const publicPath = await saveImageUpload(file, 'profile');

        // Aktualisieren Sie das Benutzerprofil mit dem neuen Bildpfad
        await prisma.user.update({
            where: {
                id: session.user.id,
            },
            data: {
                image: publicPath,
            },
        });

        return NextResponse.json({
            success: true,
            filePath: publicPath
        });

    } catch (error) {
        console.error('Fehler beim Hochladen:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Fehler beim Hochladen der Datei' },
            { status: error instanceof ImageUploadValidationError ? 400 : 500 }
        );
    }
}
