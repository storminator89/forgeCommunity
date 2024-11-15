import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";

const prisma = new PrismaClient();

export async function POST(
  request: NextRequest,
  { params }: { params: { courseId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const courseId = params.courseId;

    // Fetch course and user data
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        contents: true,
      },
    });

    if (!course) {
      return new NextResponse('Course not found', { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return new NextResponse('User not found', { status: 404 });
    }

    // Create PDF document
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    // Set background color
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, doc.internal.pageSize.width, doc.internal.pageSize.height, 'F');

    // Add border
    doc.setLineWidth(1);
    doc.rect(10, 10, doc.internal.pageSize.width - 20, doc.internal.pageSize.height - 20, 'S');

    // Add decorative inner border
    doc.setLineWidth(0.5);
    doc.rect(15, 15, doc.internal.pageSize.width - 30, doc.internal.pageSize.height - 30, 'S');

    // Add title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(40);
    doc.text('Certificate of Completion', doc.internal.pageSize.width / 2, 50, { align: 'center' });

    // Add course completion text
    doc.setFontSize(20);
    doc.setFont('helvetica', 'normal');
    doc.text('This is to certify that', doc.internal.pageSize.width / 2, 80, { align: 'center' });

    // Add user name
    doc.setFontSize(30);
    doc.setFont('helvetica', 'bold');
    doc.text(user.name || session.user.email, doc.internal.pageSize.width / 2, 100, { align: 'center' });

    // Add course completion text
    doc.setFontSize(20);
    doc.setFont('helvetica', 'normal');
    doc.text('has successfully completed the course', doc.internal.pageSize.width / 2, 120, { align: 'center' });

    // Add course title
    doc.setFontSize(30);
    doc.setFont('helvetica', 'bold');
    doc.text(course.title, doc.internal.pageSize.width / 2, 140, { align: 'center' });

    // Add date
    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text(`Issued on ${date}`, doc.internal.pageSize.width / 2, 170, { align: 'center' });

    // Convert to buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    // Return the PDF
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${course.title.replace(/\s+/g, '_')}_Certificate.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error generating certificate:', error);
    return new NextResponse('Error generating certificate', { status: 500 });
  }
}
