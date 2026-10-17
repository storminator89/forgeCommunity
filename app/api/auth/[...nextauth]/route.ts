import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';

export const dynamic = 'force-dynamic';
export const GET = async () => NextResponse.json(await getServerSession(), {
  headers: { 'Cache-Control': 'no-store' },
});
