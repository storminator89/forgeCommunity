import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // A query verifies the selected adapter, schema, and database connection.
    await prisma.user.count();
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
