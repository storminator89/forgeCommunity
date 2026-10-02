import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { authorizedH5PContent } from '@/lib/server/h5p-access';
import { readH5PAsset } from '@/lib/server/h5p-storage';
import { H5PValidationError } from '@/lib/server/h5p-archive';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await props.params;
    const content = await authorizedH5PContent(id, session.user, new URL(request.url).origin);
    await readH5PAsset(id, ['h5p.json']);
    const { userId: _owner, ...metadata } = content;
    return NextResponse.json({ ...metadata, embedUrl: `/h5p/embed/${id}` }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof H5PValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return NextResponse.json({ error: 'Die H5P-Paketdateien fehlen. Bitte importieren Sie die Datei erneut.' }, { status: 404 });
    console.error('Failed to retrieve H5P metadata:', error);
    return NextResponse.json({ error: 'Der H5P-Inhalt konnte nicht geladen werden.' }, { status: 500 });
  }
}
