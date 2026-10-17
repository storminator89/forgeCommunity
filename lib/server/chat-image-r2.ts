import 'server-only';

import { Buffer } from 'node:buffer';
import { env } from 'cloudflare:workers';
import { CHAT_IMAGE_MAX_BYTES } from '@/lib/server/chat-image-policy';

const KEY_PREFIX = 'private-chat-images/';
const OBJECT_SCOPE = 'private-chat-image-v1';
// Keeps the generated URL within the existing Chat message URL budget.
const MAX_OWNER_BYTES = 200;
const FILENAME = /^chat-([0-9a-f]{2,400})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.png$/;

const uploadState = globalThis as typeof globalThis & {
  __forgeChatImageUploadBusy?: boolean;
};

/** One admitted Chat upload per isolate, acquired before reading multipart.
 * This is an admission control, not an aggregate Worker memory guarantee. */
export function acquireChatImageUpload(): (() => void) | null {
  if (uploadState.__forgeChatImageUploadBusy) return null;
  uploadState.__forgeChatImageUploadBusy = true;
  let released = false;
  return () => {
    if (!released) uploadState.__forgeChatImageUploadBusy = false;
    released = true;
  };
}

export function parseChatImageFilename(filename: string): { ownerId: string; key: string } | null {
  const match = FILENAME.exec(filename);
  if (!match || match[1].length % 2 !== 0) return null;
  const ownerBytes = Buffer.from(match[1], 'hex');
  const ownerId = ownerBytes.toString('utf8');
  // Buffer's decoder substitutes malformed UTF-8; the round trip rejects it.
  if (!ownerId || ownerBytes.byteLength > MAX_OWNER_BYTES || ownerId.includes('\0') ||
      Buffer.from(ownerId, 'utf8').toString('hex') !== match[1]) return null;
  return { ownerId, key: `${KEY_PREFIX}${filename}` };
}

export async function putChatImage(bytes: Uint8Array, ownerId: string): Promise<string> {
  if (!env.BUCKET) throw new Error('Chat image storage is unavailable.');
  const filename = `chat-${Buffer.from(ownerId, 'utf8').toString('hex')}-${crypto.randomUUID()}.png`;
  const parsed = parseChatImageFilename(filename);
  if (!parsed || parsed.ownerId !== ownerId || !bytes.byteLength || bytes.byteLength > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('Invalid canonical Chat image.');
  }
  const stored = await env.BUCKET.put(parsed.key, bytes, {
    httpMetadata: { contentType: 'image/png', cacheControl: 'private, no-store' },
    customMetadata: { scope: OBJECT_SCOPE, owner: ownerId, format: 'png' },
  });
  if (!stored) throw new Error('Chat image storage failed.');
  // The message is written later in D1. Failure there can leave an owner-private
  // orphan; R2 and D1 are not cross-store atomic, and no deletion is attempted.
  return `/api/chat/uploads/${filename}`;
}

/** Call only after the route's live D1 authorization. No public bucket URL. */
export async function getChatImage(key: string, ownerId: string) {
  if (!env.BUCKET) throw new Error('Chat image storage is unavailable.');
  const object = await env.BUCKET.get(key);
  if (!object) return null;
  if (object.key !== key || !Number.isInteger(object.size) || object.size < 1 || object.size > CHAT_IMAGE_MAX_BYTES ||
      object.customMetadata?.scope !== OBJECT_SCOPE || object.customMetadata.owner !== ownerId ||
      object.customMetadata.format !== 'png' || object.httpMetadata?.contentType !== 'image/png' ||
      object.httpMetadata.contentEncoding !== undefined) {
    void object.body.cancel().catch(() => {});
    return null;
  }
  return object;
}
