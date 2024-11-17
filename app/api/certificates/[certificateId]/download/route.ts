import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

export async function GET(
  req: NextRequest,
  { params }: { params: { certificateId: string } }
) {
  try {
    // Get the authenticated user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Get the certificate from the database
    const certificate = await db.certificate.findUnique({
      where: { 
        id: params.certificateId,
        userId: session.user.id // Ensure the certificate belongs to the user
      },
      include: {
        course: true,
        user: true
      }
    });

    if (!certificate) {
      return new NextResponse('Certificate not found', { status: 404 });
    }

    // Create a new PDF document
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    // Set background color
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 297, 210, 'F');

    // Add border
    doc.setDrawColor(0, 123, 255);
    doc.setLineWidth(1);
    doc.rect(10, 10, 277, 190);

    // Add header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(40);
    doc.setTextColor(0, 123, 255);
    doc.text('Certificate of Completion', 148.5, 40, { align: 'center' });

    // Add user name
    doc.setFontSize(30);
    doc.setTextColor(33, 37, 41);
    doc.text(certificate.user.name || 'Student', 148.5, 80, { align: 'center' });

    // Add course details
    doc.setFontSize(20);
    doc.text('has successfully completed the course', 148.5, 100, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.text(certificate.course.title, 148.5, 120, { align: 'center' });

    // Add date
    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    const issueDate = new Date(certificate.issuedAt).toLocaleDateString('de-DE');
    doc.text(`Issued on ${issueDate}`, 148.5, 140, { align: 'center' });

    // Generate QR code for verification
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const verificationUrl = `${baseUrl}/verify-certificate/${certificate.id}`;
    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl);
    
    // Add QR code to the PDF
    doc.addImage(qrCodeDataUrl, 'PNG', 128.5, 150, 40, 40);

    // Add verification text
    doc.setFontSize(12);
    doc.text('Scan to verify certificate authenticity', 148.5, 195, { align: 'center' });

    // Generate the PDF as a buffer
    const pdfBuffer = doc.output('arraybuffer');

    // Return the PDF with appropriate headers
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${certificate.course.title}-certificate.pdf"`
      }
    });
  } catch (error) {
    console.error('Error generating certificate:', error);
    return new NextResponse('Error generating certificate', { status: 500 });
  }
}
