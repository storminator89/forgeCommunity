import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';

// No notification publisher is connected. Avoid holding an idle stream forever.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });
  return NextResponse.json({ error: 'Notification streaming is unavailable' }, { status: 501 });
}
