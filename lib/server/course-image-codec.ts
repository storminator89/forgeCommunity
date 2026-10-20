import 'server-only';

import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import pngBrowser from 'pngjs/browser.js';

import {
  CourseImageError, COURSE_IMAGE_CONTENT_TYPE, COURSE_IMAGE_MAX_BYTES,
  COURSE_IMAGE_MAX_PIXELS, COURSE_IMAGE_MAX_SIDE,
} from './course-image-policy';

// Bounded PNG techniques adapted from the reviewed native chat-image-codec.
// No Chat identity, policy import, URLs, authorization or JPEG path is reused.
const { PNG } = pngBrowser;
const MAX_METADATA_BYTES = 128 * 1024;
const MAX_CHUNKS = 256;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const invalid = () => new CourseImageError('IMAGE_INVALID');
const unsupported = () => new CourseImageError('IMAGE_UNSUPPORTED');

function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > COURSE_IMAGE_MAX_SIDE || height > COURSE_IMAGE_MAX_SIDE || width * height > COURSE_IMAGE_MAX_PIXELS) {
    throw new CourseImageError('IMAGE_DIMENSIONS');
  }
}

function boundedBytes(bytes: Uint8Array) {
  if (!Number.isSafeInteger(bytes.byteLength) || bytes.byteLength < 1) throw invalid();
  if (bytes.byteLength > COURSE_IMAGE_MAX_BYTES) throw new CourseImageError('IMAGE_TOO_LARGE');
}

function u32(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = Buffer.alloc(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc(bytes: Uint8Array, start: number, end: number) {
  let value = 0xffffffff;
  for (let index = start; index < end; index++) value = crcTable[(value ^ bytes[index]) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Strip ancillary bytes before decoding; never give EXIF, ICC or compressed
 * text to pngjs. canonicalOnly additionally requires our RGBA/filter-0 output
 * envelope and forbids all ancillary chunks, without re-encoding stored IDs. */
function preparePng(bytes: Uint8Array, canonicalOnly = false) {
  boundedBytes(bytes);
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) throw invalid();
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const compressed: Uint8Array[] = [];
  let offset = 8, chunks = 0, metadata = 0, width = 0, height = 0, channels = 0;
  let header = false, data = false, afterData = false, ended = false;
  while (offset < bytes.length) {
    if (++chunks > MAX_CHUNKS || offset + 12 > bytes.length) throw invalid();
    const length = u32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase() ||
        crc(bytes, offset + 4, end - 4) !== u32(bytes, end - 4)) throw invalid();
    if (!header && type !== 'IHDR') throw invalid();
    if (type === 'IHDR') {
      if (header || length !== 13) throw invalid();
      width = u32(bytes, offset + 8); height = u32(bytes, offset + 12);
      dimensions(width, height);
      const color = bytes[offset + 17];
      if (bytes[offset + 16] !== 8 || (color !== 2 && color !== 6) ||
          bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) throw unsupported();
      if (canonicalOnly && color !== 6) throw invalid();
      channels = color === 6 ? 4 : 3;
      header = true; parts.push(bytes.subarray(offset, end));
    } else if (type === 'IDAT') {
      if (afterData) throw invalid();
      data = true; compressed.push(bytes.subarray(offset + 8, end - 4));
      parts.push(bytes.subarray(offset, end));
    } else if (type === 'IEND') {
      if (!data || length !== 0 || end !== bytes.length) throw invalid();
      parts.push(bytes.subarray(offset, end)); ended = true; offset = end; break;
    } else {
      if (data) afterData = true;
      if (canonicalOnly) throw invalid();
      // Animation, palettes and keyed transparency need a different contract.
      if (['acTL', 'fcTL', 'fdAT', 'PLTE', 'tRNS'].includes(type) || type[0] === type[0].toUpperCase()) throw unsupported();
      metadata += length;
      if (metadata > MAX_METADATA_BYTES) throw invalid();
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length) throw invalid();
  const rowBytes = width * channels + 1;
  const expectedBytes = rowBytes * height;
  const joined = concat(compressed);
  // The independent native check bounds inflation and proves full zlib-stream
  // consumption; pngjs alone does not establish both properties.
  const inflated = inflateSync(joined, { maxOutputLength: expectedBytes, info: true }) as unknown as {
    buffer: Uint8Array; engine: { bytesWritten: number };
  };
  if (inflated.buffer.byteLength !== expectedBytes || inflated.engine?.bytesWritten !== joined.byteLength) throw invalid();
  for (let row = 0; row < height; row++) {
    const filter = inflated.buffer[row * rowBytes];
    if (filter > 4 || (canonicalOnly && filter !== 0)) throw invalid();
  }
  return { bytes: concat(parts), width, height };
}

/** Storage-reader validation only. Does not change bytes, derive authority,
 * create a URL or accept legacy formats under an existing immutable ID. */
export function assertCanonicalCourseImageBytes(bytes: Uint8Array): void {
  try { preparePng(bytes, true); }
  catch (error) {
    if (error instanceof CourseImageError) throw error;
    throw invalid();
  }
}

/** The caller must authorize the current course editor before consuming the
 * request/file. This codec does no authorization and no multipart admission. */
export async function normalizeCourseImage(file: File): Promise<Uint8Array> {
  try {
    if (!Number.isSafeInteger(file.size) || file.size < 1) throw invalid();
    if (file.size > COURSE_IMAGE_MAX_BYTES) throw new CourseImageError('IMAGE_TOO_LARGE');
    if (file.type !== COURSE_IMAGE_CONTENT_TYPE) throw unsupported();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) throw invalid();
    const prepared = preparePng(bytes);
    const decoded = PNG.sync.read(prepared.bytes, { checkCRC: true });
    if (decoded.width !== prepared.width || decoded.height !== prepared.height ||
        decoded.data.byteLength !== decoded.width * decoded.height * 4) throw invalid();
    dimensions(decoded.width, decoded.height);
    // Fresh pixel-only input; no original encoded bytes or ancillary metadata.
    const encoded = PNG.sync.write({ data: Buffer.from(decoded.data), width: decoded.width, height: decoded.height }, {
      colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, filterType: 0, deflateLevel: 6,
    });
    boundedBytes(encoded);
    // Trusted encoder header check avoids a third inflation during upload.
    if (encoded.byteLength < 58 || !PNG_SIGNATURE.every((value, index) => encoded[index] === value) ||
        u32(encoded, 8) !== 13 || ![73, 72, 68, 82].every((value, index) => encoded[12 + index] === value) ||
        u32(encoded, 16) !== decoded.width || u32(encoded, 20) !== decoded.height ||
        encoded[24] !== 8 || encoded[25] !== 6 || encoded[26] !== 0 || encoded[27] !== 0 || encoded[28] !== 0 ||
        crc(encoded, 12, 29) !== u32(encoded, 29)) throw invalid();
    return encoded;
  } catch (error) {
    if (error instanceof CourseImageError) throw error;
    throw invalid();
  }
}
