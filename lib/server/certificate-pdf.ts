import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { certificateInterRegular, certificateInterBold } from '@/lib/server/certificate-fonts';

export type CertificateSnapshot = { id: string; userName: string; courseName: string; issuedAt: Date };

const CERTIFICATE_FONT = 'ForgeCertificateInter';
const MM_PER_POINT = 25.4 / 72;
const LINE_HEIGHT = 1.45;

type TextBox = { x: number; y: number; width: number; height: number };

function safeDownloadName(value: string) {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '')
    .replace(/[\r\n"\\/<>:*?|]+/g, '').replace(/\s+/g, '_').slice(0, 120) || 'course';
}

function certificateText(doc: jsPDF, value: string) {
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  const font = doc.getFont().metadata as { characterToGlyph(codePoint: number): number };
  // jsPDF's embedded-font encoder can stop at a missing glyph. Fail before
  // creating a misleading receipt instead of deleting or replacing its facts.
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0xffff || font.characterToGlyph(codePoint) === 0) {
      throw new Error('Certificate text contains a character unsupported by its embedded font');
    }
  }
  if (!text) throw new Error('Certificate text must not be empty');
  return text;
}

function textInBox(doc: jsPDF, value: string, box: TextBox, maximumFontSize: number, minimumFontSize: number) {
  const text = certificateText(doc, value);
  const font = doc.getFont().metadata as { bbox: number[] };
  // The embedded face's full glyph bounds include accents and descenders.
  // Measure both axes, with side bearings reserved inside the page margins.
  const ascent = Math.max(0, font.bbox[3]) / 1000;
  const descent = Math.max(0, -font.bbox[1]) / 1000;
  const availableWidth = box.width - 12;
  for (let fontSize = maximumFontSize; fontSize >= minimumFontSize; fontSize -= 1) {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, availableWidth) as string[];
    const em = fontSize * MM_PER_POINT;
    const textHeight = (ascent + descent + (lines.length - 1) * LINE_HEIGHT) * em;
    if (textHeight > box.height || lines.some(line => doc.getTextWidth(line) > availableWidth)) continue;
    const baseline = box.y + (box.height - textHeight) / 2 + ascent * em;
    doc.text(lines, box.x + box.width / 2, baseline, { align: 'center', lineHeightFactor: LINE_HEIGHT });
    return;
  }
  // Do not truncate a historical name or course title to make a PDF fit.
  throw new Error('Certificate text does not fit within the certificate layout');
}

export async function certificatePdfResponse(certificate: CertificateSnapshot) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl.replace(/\/$/, '')}/verify-certificate/${encodeURIComponent(certificate.id)}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS('ForgeCertificateInter-Regular.ttf', certificateInterRegular);
  doc.addFont('ForgeCertificateInter-Regular.ttf', CERTIFICATE_FONT, 'normal');
  doc.addFileToVFS('ForgeCertificateInter-Bold.ttf', certificateInterBold);
  doc.addFont('ForgeCertificateInter-Bold.ttf', CERTIFICATE_FONT, 'bold');
  const width = doc.internal.pageSize.width;
  const height = doc.internal.pageSize.height;
  doc.setFillColor(252, 252, 252);
  doc.rect(0, 0, width, height, 'F');
  doc.setFillColor(44, 82, 130);
  doc.rect(0, 0, width, 20, 'F');
  doc.rect(0, height - 25, width, 25, 'F');
  doc.setFont(CERTIFICATE_FONT, 'bold');
  doc.setFontSize(40);
  doc.setTextColor(44, 82, 130);
  doc.text('ZERTIFIKAT', width / 2, 52, { align: 'center' });
  doc.setFont(CERTIFICATE_FONT, 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text('Hiermit wird bestätigt, dass', width / 2, 72, { align: 'center' });
  doc.setFont(CERTIFICATE_FONT, 'bold');
  doc.setTextColor(44, 82, 130);
  textInBox(doc, certificate.userName, { x: 25, y: 78, width: width - 50, height: 23 }, 28, 14);
  doc.setFont(CERTIFICATE_FONT, 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text('erfolgreich den Kurs', width / 2, 112, { align: 'center' });
  doc.setFont(CERTIFICATE_FONT, 'bold');
  doc.setTextColor(44, 82, 130);
  // This block ends at 144 mm. The QR area starts below it at 145 mm,
  // so a wrapped title can never run beneath the image.
  textInBox(doc, certificate.courseName, { x: 25, y: 117, width: width - 50, height: 27 }, 24, 10);
  doc.setFont(CERTIFICATE_FONT, 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text('abgeschlossen hat.', width / 2, 154, { align: 'center' });
  doc.setFontSize(12);
  const issueDate = certificate.issuedAt.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  doc.text(`Ausgestellt am ${issueDate}`, width / 2, 168, { align: 'center' });
  // A separate lower-right verification area leaves the centered closing
  // sentence/date clear and stays above the footer at 185 mm.
  const qrSize = 34;
  const qrX = width - 60;
  const qrY = 145;
  doc.addImage(qrCodeDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
  doc.link(qrX, qrY, qrSize, qrSize, { url: verificationUrl });
  doc.setFontSize(9);
  doc.setTextColor(44, 82, 130);
  const verificationLabel = 'Zertifikat verifizieren';
  const verificationLabelX = qrX + (qrSize - doc.getTextWidth(verificationLabel)) / 2;
  doc.textWithLink(verificationLabel, verificationLabelX, 182, { url: verificationUrl });
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(certificateText(doc, `Zertifikat ID: ${certificate.id}`), width - 25, height - 15, { align: 'right' });
  return new Response(new Uint8Array(doc.output('arraybuffer')), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeDownloadName(certificate.courseName)}_Zertifikat.pdf"`,
    },
  });
}
