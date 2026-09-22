import 'server-only';

import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const IMAGE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'images', 'uploads');
const PRIVATE_CHAT_UPLOAD_DIR = path.join(process.cwd(), 'private', 'chat-uploads');
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export class ImageUploadValidationError extends Error {}

function hasBytes(bytes: Uint8Array, ...expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function hasBytesAt(bytes: Uint8Array, offset: number, ...expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function detectImageMime(bytes: Uint8Array) {
  if (bytes.length >= 8 && hasBytes(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png';
  }
  if (bytes.length >= 6 && (hasBytes(bytes, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || hasBytes(bytes, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) {
    return 'image/gif';
  }
  if (bytes.length >= 3 && hasBytes(bytes, 0xff, 0xd8, 0xff)) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && hasBytes(bytes, 0x52, 0x49, 0x46, 0x46) && hasBytesAt(bytes, 8, 0x57, 0x45, 0x42, 0x50)) {
    return 'image/webp';
  }
  return null;
}

const EXPECTED_SHARP_FORMAT: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

async function validateAndNormalizeImage(fileType: string, bytes: Uint8Array) {
  if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) {
    throw new ImageUploadValidationError('Datei ist zu gross. Maximale Groesse ist 5MB.');
  }

  const detectedType = detectImageMime(bytes);
  if (!detectedType || detectedType !== fileType) {
    throw new ImageUploadValidationError('Dateiinhalt entspricht nicht dem angegebenen Bildtyp.');
  }

  try {
    const decoded = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
      animated: false,
    });
    const metadata = await decoded.metadata();
    if (
      metadata.format !== EXPECTED_SHARP_FORMAT[detectedType] ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    ) {
      throw new ImageUploadValidationError('Bildabmessungen oder Bildformat sind nicht erlaubt.');
    }

    // Decode and re-encode so an upload cannot retain an executable payload,
    // malformed ancillary chunks, or a mismatched MIME signature.
    const normalized = await decoded.rotate().toBuffer();
    if (normalized.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new ImageUploadValidationError('Datei ist zu gross. Maximale Groesse ist 5MB.');
    }
    return normalized;
  } catch (error) {
    if (error instanceof ImageUploadValidationError) throw error;
    throw new ImageUploadValidationError('Die Bilddatei konnte nicht validiert werden.');
  }
}

async function readAndNormalizeImage(file: File) {
  validateImageFile(file);
  const bytes = await file.arrayBuffer();
  const sourceBytes = new Uint8Array(bytes);
  if (sourceBytes.byteLength !== file.size) {
    throw new ImageUploadValidationError('Die Dateigrösse konnte nicht verifiziert werden.');
  }
  return {
    bytes: await validateAndNormalizeImage(file.type, sourceBytes),
    extension: MIME_TO_EXTENSION[file.type],
  };
}

export async function ensureImageUploadDirectory() {
  await mkdir(IMAGE_UPLOAD_DIR, { recursive: true });
  return IMAGE_UPLOAD_DIR;
}

export function validateImageFile(file: File) {
  const extension = MIME_TO_EXTENSION[file.type];

  if (!extension) {
    throw new ImageUploadValidationError('Ungueltiger Dateityp. Erlaubt sind JPG, PNG, GIF und WebP.');
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new ImageUploadValidationError('Datei ist zu gross. Maximale Groesse ist 5MB.');
  }

  return extension;
}

export async function saveImageUpload(file: File, prefix = 'image') {
  const uploadDir = await ensureImageUploadDirectory();
  const { bytes, extension } = await readAndNormalizeImage(file);
  const filename = `${prefix}-${randomUUID()}${extension}`;
  const filePath = path.join(uploadDir, filename);

  await writeFile(filePath, bytes);

  return `/images/uploads/${filename}`;
}

/** Store chat attachments outside `public/`; access is mediated by the chat file route. */
export async function saveChatImageUpload(file: File, ownerId: string) {
  await mkdir(PRIVATE_CHAT_UPLOAD_DIR, { recursive: true });
  const uploadDir = PRIVATE_CHAT_UPLOAD_DIR;
  const { bytes, extension } = await readAndNormalizeImage(file);
  // Hex keeps the owner delimiter unambiguous even though UUIDs contain '-'.
  const ownerToken = Buffer.from(ownerId, 'utf8').toString('hex');
  const filename = `chat-${ownerToken}-${randomUUID()}${extension}`;
  await writeFile(path.join(uploadDir, filename), bytes);
  return `/api/chat/uploads/${filename}`;
}

export function getPrivateChatUploadPath(filename: string) {
  if (!/^chat-[0-9a-f]+-[0-9a-f-]+\.(?:gif|jpg|png|webp)$/.test(filename)) {
    return null;
  }
  return path.join(PRIVATE_CHAT_UPLOAD_DIR, filename);
}

export function getPublicImageUploadPath(filename: string) {
  if (!/^[A-Za-z0-9_-]+-[0-9a-f-]+\.(?:gif|jpg|png|webp)$/.test(filename)) {
    return null;
  }
  return path.join(IMAGE_UPLOAD_DIR, filename);
}

export function getChatUploadOwnerId(filename: string) {
  const match = /^chat-([0-9a-f]+)-[0-9a-f-]+\.(?:gif|jpg|png|webp)$/.exec(filename);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'hex').toString('utf8');
  } catch {
    return null;
  }
}

export async function deleteUploadedImage(publicPath: string | null | undefined) {
  // Persisted image URLs are user controlled data in several legacy models.
  // There is no ownership proof in their random filenames, so automatic
  // deletion is disabled until a caller supplies an entity-owned capability.
  // This intentionally leaves orphaned files for a separately authorized GC.
  void publicPath;
}
