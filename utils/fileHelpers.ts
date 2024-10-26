import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import path from 'path';

export function isValidImageType(mimeType: string): boolean {
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  return validTypes.includes(mimeType);
}

export function generateUniqueFileName(originalName: string, type: string): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  const extension = path.extname(originalName);
  return `${type}-${timestamp}-${random}${extension}`;
}

export async function deleteOldImage(imagePath: string | null) {
  if (!imagePath) return;

  try {
    const fullPath = path.join(process.cwd(), 'public', imagePath);
    if (imagePath.includes('/uploads/') && existsSync(fullPath)) {
      await unlink(fullPath);
    }
  } catch (error) {
    console.error('Error deleting old image:', error);
  }
}