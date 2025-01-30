// app/api/courses/[courseId]/contents/[contentId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

export async function DELETE(
  request: NextRequest,
  { params }: { params: { courseId: string; contentId: string } }
) {
  console.log('DELETE request received for content:', params.contentId);
  
  try {
    const session = await getServerSession(authOptions);
    console.log('Session:', session);
    
    if (!session?.user?.id) {
      console.log('Unauthorized - no valid session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Log before deleting subcontent
    console.log('Checking for subcontents to delete');
    const subcontents = await prisma.courseContent.findMany({
      where: { parentId: params.contentId }
    });
    console.log('Found subcontents:', subcontents);

    // Erst Unterinhalte löschen, falls vorhanden
    if (subcontents.length > 0) {
      console.log('Deleting subcontents');
      await prisma.courseContent.deleteMany({
        where: { parentId: params.contentId }
      });
    }

    // Dann den Hauptinhalt löschen
    console.log('Deleting main content');
    const deletedContent = await prisma.courseContent.delete({
      where: { id: params.contentId },
    });
    console.log('Deleted content:', deletedContent);

    return NextResponse.json({ 
      success: true, 
      message: 'Content deleted successfully',
      deletedContent 
    });
  } catch (error) {
    console.error('Error in DELETE operation:', error);
    return NextResponse.json({ 
      error: 'Failed to delete content',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { courseId: string; contentId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title } = body;

    const updatedContent = await prisma.courseContent.update({
      where: {
        id: params.contentId,
      },
      data: {
        title,
      },
    });

    return NextResponse.json(updatedContent);
  } catch (error) {
    console.error('Error updating content:', error);
    return NextResponse.json({ error: 'Failed to update content' }, { status: 500 });
  }
}
