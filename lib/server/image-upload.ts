import 'server-only';

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';

const IMAGE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'images', 'uploads');
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export class ImageUploadValidationError extends Error {}

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
  const extension = validateImageFile(file);
  const uploadDir = await ensureImageUploadDirectory();
  const filename = `${prefix}-${randomUUID()}${extension}`;
  const filePath = path.join(uploadDir, filename);
  const bytes = await file.arrayBuffer();

  await writeFile(filePath, new Uint8Array(bytes));

  return `/images/uploads/${filename}`;
}

export async function deleteUploadedImage(publicPath: string | null | undefined) {
  if (!publicPath || !publicPath.startsWith('/images/uploads/')) {
    return;
  }

  const fullPath = path.join(process.cwd(), 'public', publicPath);
  const normalizedUploadsDir = path.normalize(IMAGE_UPLOAD_DIR);
  const normalizedFullPath = path.normalize(fullPath);

  if (!normalizedFullPath.startsWith(normalizedUploadsDir) || !existsSync(normalizedFullPath)) {
    return;
  }

  await unlink(normalizedFullPath);
}
