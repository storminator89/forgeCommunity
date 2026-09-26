import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

export type CertificateSnapshot = { id: string; userName: string; courseName: string; issuedAt: Date };

function safeDownloadName(value: string) {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '')
    .replace(/[\r\n"\\/<>:*?|]+/g, '').replace(/\s+/g, '_').slice(0, 120) || 'course';
}

export async function certificatePdfResponse(certificate: CertificateSnapshot) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl.replace(/\/$/, '')}/verify-certificate/${certificate.id}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.width;
  const height = doc.internal.pageSize.height;
  doc.setFillColor(252, 252, 252);
  doc.rect(0, 0, width, height, 'F');
  doc.setFillColor(44, 82, 130);
  doc.rect(0, 0, width, 20, 'F');
  doc.rect(0, height - 25, width, 25, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(46);
  doc.setTextColor(44, 82, 130);
  doc.text('ZERTIFIKAT', width / 2, 60, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text('Hiermit wird bestätigt, dass', width / 2, 95, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(44, 82, 130);
  doc.text(certificate.userName, width / 2, 110, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text('erfolgreich den Kurs', width / 2, 125, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(44, 82, 130);
  doc.text(certificate.courseName, width / 2, 140, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text('abgeschlossen hat.', width / 2, 155, { align: 'center' });
  doc.setFontSize(12);
  const issueDate = certificate.issuedAt.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  doc.text(`Ausgestellt am ${issueDate}`, width / 2, 175, { align: 'center' });
  doc.addImage(qrCodeDataUrl, 'PNG', 35, height - 90, 35, 35);
  doc.setFontSize(10);
  doc.setTextColor(44, 82, 130);
  doc.textWithLink('Zertifikat verifizieren', 35, height - 38, { url: verificationUrl });
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(`Zertifikat ID: ${certificate.id}`, width - 35, height - 15, { align: 'right' });
  return new Response(new Uint8Array(doc.output('arraybuffer')), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeDownloadName(certificate.courseName)}_Zertifikat.pdf"`,
    },
  });
}
