import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { d1PrivatePathwayViews } from '@/lib/server/d1-private-overviews';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return reply({ error: 'Unauthorized' }, 401);
  try {
    const pathways = await d1PrivatePathwayViews(session.user.id);
    if (!pathways) return reply({ error: 'Forbidden' }, 403);
    return reply({ pathways });
  } catch (error) {
    console.error('Failed to read private learning pathways:', error);
    return reply({ error: 'Failed to read learning pathways' }, 500);
  }
}
