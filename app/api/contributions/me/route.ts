import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { currentContributionSummary } from '@/lib/server/contributions';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401, headers });
    // There is intentionally no other-account lookup, even for staff.
    if (new URL(request.url).searchParams.size) {
      return NextResponse.json({ error: 'Diese Ansicht unterstützt keine Abfrageparameter' }, { status: 400, headers });
    }
    const summary = await currentContributionSummary(session.user.id);
    if (!summary) return NextResponse.json({ error: 'Konto nicht gefunden' }, { status: 404, headers });
    return NextResponse.json(summary, { headers });
  } catch (error) {
    console.error('Failed to read private contribution milestones', error);
    return NextResponse.json({ error: 'Diskussionsmeilensteine konnten nicht geladen werden' }, { status: 500, headers });
  }
}
