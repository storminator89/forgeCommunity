import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "@/lib/sites-auth/server";
import { authOptions } from '@/lib/auth';
import { listD1H5PContents } from '@/lib/server/d1-h5p-contents-read';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const h5pContents = await listD1H5PContents(session.user.id, session.user.role === 'ADMIN');

    return NextResponse.json(h5pContents.map(content => ({ ...content, embedUrl: `/h5p/embed/${content.id}` })), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to fetch H5P contents:', error);
    return NextResponse.json({ error: 'Failed to fetch H5P contents' }, { status: 500 });
  }
}
