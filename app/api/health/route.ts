import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // A direct standalone start bypasses the Docker entrypoint. A legacy
    // course without a saved draft cannot be safely served by the new editor.
    await prisma.user.count();
    const unversioned = await prisma.course.findFirst({
      where: { draft: { is: null } }, select: { id: true },
    });
    if (unversioned) throw new Error('An unversioned course requires a fresh development database');
    return NextResponse.json({ status: 'ok' }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
