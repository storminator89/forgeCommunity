import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../auth/[...nextauth]/options';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { role: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    }

    return NextResponse.json({ role: user.role });
  } catch (error) {
    console.error('Error fetching user role:', error);
    return NextResponse.json(
      { error: 'Fehler beim Abrufen der Benutzerrolle.' },
      { status: 500 }
    );
  }
}
