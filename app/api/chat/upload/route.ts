import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/options';
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

        const publicPath = await saveImageUpload(file, 'chat');

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
