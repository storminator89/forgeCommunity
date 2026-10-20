const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 1_000_000;
const MAX_IMAGE_SIDE = 1600;

export class CourseImagePreparationError extends Error {}

function matches(bytes: Uint8Array, offset: number, expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function imageMime(bytes: Uint8Array) {
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  return null;
}

/** Local convenience only. The upload server must independently decode and validate every image. */
export async function prepareCourseOptionImage(file: File): Promise<File> {
  if (file.size === 0) throw new CourseImagePreparationError('Die Bilddatei ist leer. Bitte wähle ein anderes Bild.');
  if (file.size > MAX_IMAGE_BYTES) {
    throw new CourseImagePreparationError('Das Bild ist zu groß. Bitte wähle eine Datei mit höchstens 5 MiB.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new CourseImagePreparationError('Dieser Browser kann Bilder nicht sicher vorbereiten. Bitte nutze einen aktuellen Browser.');
  }

  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageMime(bytes);
    if (!type) throw new CourseImagePreparationError('Bitte wähle ein Bild im Format JPEG oder ein statisches PNG.');

    // PNG animation is not a supported input. The server independently enforces
    // its static canonical ingress; client checks are convenience, not trust.
    if (type === 'image/png') {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const length = view.getUint32(offset);
        if (length > bytes.length - offset - 12) throw new CourseImagePreparationError('Das PNG ist beschädigt.');
        if (matches(bytes, offset + 4, [0x61, 0x63, 0x54, 0x4c])) throw new CourseImagePreparationError('Animierte Bilder werden nicht unterstützt. Bitte wähle ein statisches PNG oder JPEG.');
        offset += length + 12;
      }
    }
    bitmap = await createImageBitmap(new Blob([file], { type }), { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new CourseImagePreparationError('Die Bildabmessungen konnten nicht gelesen werden. Bitte wähle ein anderes Bild.');
    }
    const scale = Math.min(1, MAX_IMAGE_SIDE / width, MAX_IMAGE_SIDE / height,
      Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
    const outputWidth = Math.max(1, Math.floor(width * scale));
    const outputHeight = Math.max(1, Math.floor(height * scale));
    if (outputWidth > MAX_IMAGE_SIDE || outputHeight > MAX_IMAGE_SIDE || outputWidth * outputHeight > MAX_IMAGE_PIXELS) {
      throw new CourseImagePreparationError('Das Bild konnte nicht ausreichend verkleinert werden. Bitte wähle ein kleineres Bild.');
    }

    canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new CourseImagePreparationError('Dieser Browser kann das Bild nicht vorbereiten. Bitte nutze einen aktuellen Browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
    const png = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/png'));
    if (!png || png.type !== 'image/png' || png.size === 0) {
      throw new CourseImagePreparationError('Das Bild konnte nicht als PNG vorbereitet werden. Bitte wähle ein anderes Bild.');
    }
    if (png.size > MAX_IMAGE_BYTES) {
      throw new CourseImagePreparationError('Das vorbereitete Bild ist größer als 5 MiB. Bitte wähle ein kleineres Bild.');
    }
    // Always send freshly encoded pixels. Never fall back to original bytes.
    return new File([png], 'course-option.png', { type: 'image/png' });
  } catch (error) {
    if (error instanceof CourseImagePreparationError) throw error;
    throw new CourseImagePreparationError('Das Bild konnte nicht gelesen oder vorbereitet werden. Bitte wähle ein anderes Bild.');
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
