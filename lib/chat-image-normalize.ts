const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 1_000_000;
const MAX_IMAGE_SIDE = 1600;

export class ChatImagePreparationError extends Error {}

function matches(bytes: Uint8Array, offset: number, expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function imageMime(bytes: Uint8Array) {
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      matches(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  if (matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

/** Local convenience only. The upload server must independently decode and validate every image. */
export async function normalizeChatImage(file: File): Promise<File> {
  if (file.size === 0) throw new ChatImagePreparationError('Die Bilddatei ist leer. Bitte wähle ein anderes Bild.');
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ChatImagePreparationError('Das Bild ist zu groß. Bitte wähle eine Datei mit höchstens 5 MiB.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new ChatImagePreparationError('Dieser Browser kann Bilder nicht sicher vorbereiten. Bitte nutze einen aktuellen Browser.');
  }

  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    const type = imageMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    if (!type) throw new ChatImagePreparationError('Bitte wähle ein Bild im Format JPEG, PNG, WebP oder GIF.');

    // Blob decoding honors image orientation. The HTML algorithm requires an
    // animation's default image, or its first frame when no default exists:
    // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap
    bitmap = await createImageBitmap(new Blob([file], { type }), { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new ChatImagePreparationError('Die Bildabmessungen konnten nicht gelesen werden. Bitte wähle ein anderes Bild.');
    }
    const scale = Math.min(1, MAX_IMAGE_SIDE / width, MAX_IMAGE_SIDE / height,
      Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
    const outputWidth = Math.max(1, Math.floor(width * scale));
    const outputHeight = Math.max(1, Math.floor(height * scale));
    if (outputWidth > MAX_IMAGE_SIDE || outputHeight > MAX_IMAGE_SIDE || outputWidth * outputHeight > MAX_IMAGE_PIXELS) {
      throw new ChatImagePreparationError('Das Bild konnte nicht ausreichend verkleinert werden. Bitte wähle ein kleineres Bild.');
    }

    canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new ChatImagePreparationError('Dieser Browser kann das Bild nicht vorbereiten. Bitte nutze einen aktuellen Browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
    const png = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/png'));
    if (!png || png.type !== 'image/png' || png.size === 0) {
      throw new ChatImagePreparationError('Das Bild konnte nicht als PNG vorbereitet werden. Bitte wähle ein anderes Bild.');
    }
    if (png.size > MAX_IMAGE_BYTES) {
      throw new ChatImagePreparationError('Das vorbereitete Bild ist größer als 5 MiB. Bitte wähle ein kleineres Bild.');
    }
    // Always send freshly encoded pixels. Never fall back to original bytes.
    return new File([png], 'chat-image.png', { type: 'image/png' });
  } catch (error) {
    if (error instanceof ChatImagePreparationError) throw error;
    throw new ChatImagePreparationError('Das Bild konnte nicht gelesen oder vorbereitet werden. Bitte wähle ein anderes Bild.');
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
