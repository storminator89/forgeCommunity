import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/options";
import prisma from '@/lib/prisma';
import { ImageUploadValidationError, saveImageUpload } from '@/lib/server/image-upload';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';
import { consumeRateLimit, rateLimitHeaders, UPLOAD_RATE_LIMIT } from '@/lib/server/rate-limit';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session) {
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
            { status: error instanceof ImageUploadValidationError ? 400 : error instanceof RequestBodyLimitError ? 413 : 500 }
        );
    }
}
