import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });

    // Personal totals never depend on staff privileges or a caller-supplied
    // target. Count in the database; do not load all activity into memory.
    const [posts, receivedLikes, comments] = await prisma.$transaction([
      prisma.post.count({ where: { authorId: userId } }),
      prisma.likePost.count({ where: { post: { authorId: userId } } }),
      prisma.comment.count({ where: {
        authorId: userId,
        post: { OR: [{ published: true }, { authorId: userId }] },
      } }),
    ]);
    return NextResponse.json({ posts, receivedLikes, comments }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Fehler beim Abrufen der eigenen Community-Statistik:', error);
    return NextResponse.json({ error: 'Statistik konnte nicht geladen werden' }, { status: 500 });
  }
}
