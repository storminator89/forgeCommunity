import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

export async function PUT(
  request: NextRequest,
  { params }: { params: { courseId: string; contentId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { direction, mainContentId } = await request.json();

    // Hole alle Unterthemen des Hauptthemas, sortiert nach order
    const subContents = await prisma.courseContent.findMany({
      where: { parentId: mainContentId },
      orderBy: { order: 'asc' },
    });

    const currentIndex = subContents.findIndex(content => content.id === params.contentId);
    if (currentIndex === -1) return NextResponse.json({ error: 'Content not found' }, { status: 404 });

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= subContents.length) {
      return NextResponse.json({ error: 'Cannot move content further' }, { status: 400 });
    }

    // Tausche die order-Werte
    const currentOrder = subContents[currentIndex].order;
    const targetOrder = subContents[newIndex].order;

    await prisma.$transaction([
      prisma.courseContent.update({
        where: { id: subContents[currentIndex].id },
        data: { order: targetOrder },
      }),
      prisma.courseContent.update({
        where: { id: subContents[newIndex].id },
        data: { order: currentOrder },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reordering content:', error);
    return NextResponse.json({ error: 'Failed to reorder content' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
