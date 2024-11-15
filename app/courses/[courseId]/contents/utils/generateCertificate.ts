import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

export interface CertificateData {
  userName: string;
  courseName: string;
  completionDate: Date;
  courseId: string;
}

export const generateCertificate = async (data: CertificateData): Promise<Blob> => {
  try {
    if (!data.userName || !data.courseName) {
      throw new Error('Missing required certificate data');
    }

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

    // Add certificate ID
    doc.setFontSize(10);
    doc.setTextColor(128, 128, 128);
    const certificateId = `Zertifikat ID: ${data.courseId}-${Date.now()}`;
    doc.text(certificateId, width - 15, height - 15, { align: 'right' });

    return doc.output('blob');
  } catch (error) {
    console.error('Error generating certificate:', error);
    throw error;
  }
};
