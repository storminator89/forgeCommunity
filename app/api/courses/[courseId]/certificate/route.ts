import { NextRequest, NextResponse } from 'next/server';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';

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

    // Generate unique certificate ID
    const certificateId = uuidv4();

    // Store certificate in database
    const certificate = await prisma.certificate.create({
      data: {
        id: certificateId,
        userId: user.id,
        courseId: course.id,
        issuedAt: new Date(),
        courseName: course.title,
        userName: user.name || user.email,
      }
    });

    // Generate QR code with verification URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const verificationUrl = `${baseUrl}/verify-certificate/${certificateId}`;
    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl);

    // Create PDF document
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    // Get page dimensions
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Set background color (soft white)
    doc.setFillColor(252, 252, 252);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Add accent color bar at the top
    doc.setFillColor(44, 82, 130); // Primary blue
    doc.rect(0, 0, pageWidth, 20, 'F');

    // Add bottom accent bar in same color
    doc.setFillColor(44, 82, 130); // Same solid blue as top
    doc.rect(0, pageHeight - 25, pageWidth, 25, 'F');

    // Add main title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(46);
    doc.setTextColor(44, 82, 130);
    doc.text('ZERTIFIKAT', pageWidth / 2, 60, { align: 'center' });

    // Add subtitle
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(16);
    doc.setTextColor(128, 128, 128);
    doc.text('für herausragende Leistungen', pageWidth / 2, 75, { align: 'center' });

    // Add main text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.setTextColor(80, 80, 80);
    doc.text('Hiermit wird bestätigt, dass', pageWidth / 2, 95, { align: 'center' });

    // Add name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.setTextColor(44, 82, 130);
    doc.text(user.name || session.user.email, pageWidth / 2, 110, { align: 'center' });

    // Add course text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.setTextColor(80, 80, 80);
    doc.text('erfolgreich den Kurs', pageWidth / 2, 125, { align: 'center' });

    // Add course name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(44, 82, 130);
    doc.text(course.title, pageWidth / 2, 140, { align: 'center' });

    // Add completion text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.setTextColor(80, 80, 80);
    doc.text('abgeschlossen hat.', pageWidth / 2, 155, { align: 'center' });

    // Add date
    const date = new Date().toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.setFontSize(12);
    doc.text(`Ausgestellt am ${date}`, pageWidth / 2, 175, { align: 'center' });

    // Add QR code with white background
    const qrSize = 35;
    const qrX = 35;
    const qrY = pageHeight - 90;
    
    // Add white background for QR code
    doc.setFillColor(255, 255, 255);
    doc.rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 'F');
    
    // Add QR code
    doc.addImage(qrCodeDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    // Add verification text and URL
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text('Verifizieren Sie dieses Zertifikat:', qrX + qrSize/2, qrY + qrSize + 8, { align: 'center' });

    // Add clickable URL with custom text
    const linkText = 'Zertifikat verifizieren';
    doc.setTextColor(44, 82, 130);
    const urlY = qrY + qrSize + 15;
    const urlWidth = doc.getStringUnitWidth(linkText) * 10 / doc.internal.scaleFactor;
    const urlX = qrX + qrSize/2 - urlWidth/2;
    
    // Add white background for URL
    doc.setFillColor(255, 255, 255);
    doc.rect(urlX - 1, urlY - 4, urlWidth + 2, 6, 'F');
    
    doc.textWithLink(linkText, urlX, urlY, {
      url: verificationUrl
    });
    
    // Draw underline
    doc.setDrawColor(44, 82, 130);
    doc.setLineWidth(0.1);
    doc.line(urlX, urlY + 1, urlX + urlWidth, urlY + 1);

    // Add certificate ID with modern styling - now in white color due to blue background
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    const certificateIdText = `Zertifikat ID: ${certificateId}`;
    doc.text(certificateIdText, pageWidth - 35, pageHeight - 15, { align: 'right' });

    // Convert to buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    // Return the PDF
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${course.title.replace(/\s+/g, '_')}_Zertifikat.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error generating certificate:', error);
    return new NextResponse('Error generating certificate', { status: 500 });
  }
}
