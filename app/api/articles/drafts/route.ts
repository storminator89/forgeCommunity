import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
  }

  try {
    const drafts = await prisma.article.findMany({
      where: {
        author: {
          email: session.user.email
        },
        isPublished: false
      },
      orderBy: {
        updatedAt: 'desc'
      },
      select: {
        id: true,
        title: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        featuredImage: true,
      }
    });

    return NextResponse.json(drafts);
  } catch (error) {
    console.error('Error fetching drafts:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Entwürfe' },
      { status: 500 }
    );
  }
}
