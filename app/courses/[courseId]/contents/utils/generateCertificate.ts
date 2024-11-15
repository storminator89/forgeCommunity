import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';

export interface CertificateData {
  userName: string;
  courseName: string;
  completionDate: Date;
  courseId: string;
  certificateId?: string;
}

export const generateCertificate = async (data: CertificateData): Promise<Blob> => {
  try {
    if (!data.userName || !data.courseName) {
      throw new Error('Missing required certificate data');
    }

    // Generate certificate ID if not provided
    const certificateId = data.certificateId || uuidv4();
    data.certificateId = certificateId;

    // Create verification QR code with fallback URL
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
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();

    // Add decorative border
    doc.setDrawColor(44, 82, 130);
    doc.setLineWidth(2);
    doc.rect(10, 10, width - 20, height - 20);
    doc.setLineWidth(0.5);
    doc.rect(12, 12, width - 24, height - 24);

    // Add header
    doc.setFontSize(40);
    doc.setTextColor(44, 82, 130);
    const title = 'Zertifikat';
    const titleWidth = doc.getStringUnitWidth(title) * doc.getFontSize() / doc.internal.scaleFactor;
    doc.text(title, (width - titleWidth) / 2, 40);

    // Add completion text
    doc.setFontSize(16);
    doc.setTextColor(68, 68, 68);
    const completionText = 'Hiermit wird bestätigt, dass';
    const completionWidth = doc.getStringUnitWidth(completionText) * doc.getFontSize() / doc.internal.scaleFactor;
    doc.text(completionText, (width - completionWidth) / 2, 70);

    // Add name
    doc.setFontSize(24);
    doc.setTextColor(44, 82, 130);
    const nameWidth = doc.getStringUnitWidth(data.userName) * doc.getFontSize() / doc.internal.scaleFactor;
    doc.text(data.userName, (width - nameWidth) / 2, 85);

    // Add course completion text
    doc.setFontSize(16);
    doc.setTextColor(68, 68, 68);
    const courseText = 'erfolgreich den Kurs';
    const courseTextWidth = doc.getStringUnitWidth(courseText) * doc.getFontSize() / doc.internal.scaleFactor;
    doc.text(courseText, (width - courseTextWidth) / 2, 100);

    // Add course name
    doc.setFontSize(24);
    doc.setTextColor(44, 82, 130);
    const courseNameWidth = doc.getStringUnitWidth(data.courseName) * doc.getFontSize() / doc.internal.scaleFactor;
    doc.text(data.courseName, (width - courseNameWidth) / 2, 115);

    // Add completion date
    doc.setFontSize(14);
    doc.setTextColor(68, 68, 68);
    const formattedDate = data.completionDate.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
    const dateText = `Abgeschlossen am ${formattedDate}`;
    const dateWidth = doc.getStringUnitWidth(dateText) * doc.getFontSize() / doc.internal.scaleFactor;
    doc.text(dateText, (width - dateWidth) / 2, 135);

    // Add QR code
    const qrSize = 30;
    const qrX = width - 50;
    const qrY = height - 50;
    doc.addImage(qrCodeDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    // Add verification text and clickable URL
    doc.setFontSize(10);
    doc.setTextColor(128, 128, 128);
    
    // Add "Scan für Verifizierung" text
    doc.text('Scan für\nVerifizierung', qrX + qrSize/2, qrY + qrSize + 5, { 
      align: 'center'
    });

    // Add clickable URL
    const urlY = qrY + qrSize + 15;
    doc.setTextColor(0, 102, 204); // Set URL color to blue
    doc.setDrawColor(0, 102, 204);
    doc.setLineWidth(0.1);
    
    const shortUrl = verificationUrl.replace(/^https?:\/\//, ''); // Remove http:// or https://
    const urlWidth = doc.getStringUnitWidth(shortUrl) * doc.getFontSize() / doc.internal.scaleFactor;
    const urlX = qrX + qrSize/2 - urlWidth/2;
    
    doc.textWithLink(shortUrl, urlX, urlY, {
      url: verificationUrl
    });
    
    // Draw underline
    doc.line(urlX, urlY + 1, urlX + urlWidth, urlY + 1);

    // Add certificate ID
    doc.setFontSize(10);
    doc.setTextColor(128, 128, 128);
    const certificateIdText = `Zertifikat ID: ${certificateId}`;
    doc.text(certificateIdText, width - 15, height - 15, { align: 'right' });

    return doc.output('blob');
  } catch (error) {
    console.error('Error generating certificate:', error);
    throw error;
  }
};
