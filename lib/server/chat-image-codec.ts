import 'server-only';

import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import decodeJpeg from 'jpeg-js/lib/decoder.js';
import pngBrowser from 'pngjs/browser.js';

import {
  ChatImageError, CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_PIXELS, CHAT_IMAGE_MAX_SIDE,
} from '@/lib/server/chat-image-policy';

const { PNG } = pngBrowser;
const MAX_METADATA_BYTES = 128 * 1024;
const MAX_SEGMENTS = 256;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const invalid = () => new ChatImageError('IMAGE_INVALID');
const unsupported = () => new ChatImageError('IMAGE_UNSUPPORTED');

function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > CHAT_IMAGE_MAX_SIDE || height > CHAT_IMAGE_MAX_SIDE || width * height > CHAT_IMAGE_MAX_PIXELS) {
    throw new ChatImageError('IMAGE_DIMENSIONS');
  }
}

function u16(bytes: Uint8Array, offset: number) {
  return bytes[offset] * 256 + bytes[offset + 1];
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

/** Strip ancillary data BEFORE any decoder sees it. Only a static, 8-bit RGB
 * or RGBA image with a fully bounded scanline stream enters pngjs. */
function preparePng(bytes: Uint8Array) {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) throw invalid();
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const compressed: Uint8Array[] = [];
  let offset = 8, chunks = 0, metadata = 0, width = 0, height = 0, channels = 0;
  let header = false, data = false, afterData = false, ended = false;
  while (offset < bytes.length) {
    if (++chunks > MAX_SEGMENTS || offset + 12 > bytes.length) throw invalid();
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
      // Animation, palettes and keyed transparency need another decoding
      // contract. The browser normalizes them to a static RGBA PNG first.
      if (['acTL', 'fcTL', 'fdAT', 'PLTE', 'tRNS'].includes(type) || type[0] === type[0].toUpperCase()) throw unsupported();
      metadata += length;
      if (metadata > MAX_METADATA_BYTES) throw invalid();
      // EXIF, ICC and compressed text are never passed to the codec.
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length) throw invalid();
  const expectedBytes = (width * channels + 1) * height;
  const joined = concat(compressed);
  // Node's published info:true result is narrower than the installed v22
  // declaration. Only public buffer/engine.bytesWritten fields are used.
  const inflated = inflateSync(joined, { maxOutputLength: expectedBytes, info: true }) as unknown as {
    buffer: Uint8Array; engine: { bytesWritten: number };
  };
  // pngjs' sync inflater truncates excess output and does not establish full
  // zlib-stream consumption. The independent native Z_FINISH check rejects
  // overflow, underflow, bad trailers/checksums and unused compressed bytes.
  if (inflated.buffer.byteLength !== expectedBytes || inflated.engine?.bytesWritten !== joined.byteLength) throw invalid();
  return { bytes: concat(parts), width, height };
}

function exifOrientation(payload: Uint8Array) {
  const tiff = payload.subarray(6);
  if (tiff.length < 8) throw invalid();
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) throw invalid();
  const read16 = (offset: number) => little ? tiff[offset] + tiff[offset + 1] * 256 : u16(tiff, offset);
  const read32 = (offset: number) => little
    ? tiff[offset] + tiff[offset + 1] * 256 + tiff[offset + 2] * 65536 + tiff[offset + 3] * 0x1000000
    : u32(tiff, offset);
  if (read16(2) !== 42) throw invalid();
  const start = read32(4);
  if (start < 8 || start + 2 > tiff.length) throw invalid();
  const count = read16(start);
  if (count > 128 || start + 2 + count * 12 + 4 > tiff.length) throw invalid();
  let orientation = 1, seen = false;
  for (let index = 0; index < count; index++) {
    const entry = start + 2 + index * 12;
    if (read16(entry) !== 0x0112) continue;
    if (seen || read16(entry + 2) !== 3 || read32(entry + 4) !== 1) throw invalid();
    orientation = read16(entry + 8); seen = true;
    if (orientation < 1 || orientation > 8) throw invalid();
  }
  return orientation;
}

/** Validate baseline tables before jpeg-js can interpret their nested lengths.
 * The single scan never sees a segment that can cross its declared boundary. */
function readQuantizationTables(payload: Uint8Array, tables: Set<number>) {
  let offset = 0;
  if (!payload.length) throw invalid();
  while (offset < payload.length) {
    const spec = payload[offset++], id = spec & 15;
    if ((spec >> 4) !== 0 || id > 3) throw unsupported();
    if (tables.has(id) || offset + 64 > payload.length) throw invalid();
    for (let index = 0; index < 64; index++) if (payload[offset + index] === 0) throw invalid();
    tables.add(id); offset += 64;
  }
}

function readHuffmanTables(payload: Uint8Array, tables: Set<number>) {
  let offset = 0;
  if (!payload.length) throw invalid();
  while (offset < payload.length) {
    if (offset + 17 > payload.length) throw invalid();
    const spec = payload[offset++], kind = spec >> 4, id = spec & 15;
    if (kind > 1 || id > 3) throw unsupported();
    if (tables.has(spec)) throw invalid();
    let symbols = 0, capacity = 1;
    for (let index = 0; index < 16; index++) {
      const count = payload[offset++];
      symbols += count; capacity = capacity * 2 - count;
      if (capacity < 0) throw invalid();
    }
    // A JPEG table must leave the all-ones code unused. Baseline alphabets
    // contain at most 12 DC or 162 AC symbols, each occurring only once.
    if (capacity === 0 || symbols < 1 || symbols > (kind === 0 ? 12 : 162) || offset + symbols > payload.length) throw invalid();
    const seen = new Set<number>();
    for (let index = 0; index < symbols; index++) {
      const value = payload[offset++];
      if (seen.has(value)) throw invalid();
      if (kind === 0 ? value > 11 : (value & 15) > 10 || ((value & 15) === 0 && value !== 0 && value !== 0xf0)) throw invalid();
      seen.add(value);
    }
    tables.add(spec);
  }
}

/** Only bounded baseline JPEG is accepted directly. Normal Chat selection
 * already sends PNG. Metadata is stripped and EXIF orientation is applied to
 * decoded pixels, never copied into the resulting PNG. */
function prepareJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid();
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const quantizationTables = new Set<number>(), huffmanTables = new Set<number>();
  const componentIds: number[] = [], quantizationIds: number[] = [];
  let offset = 2, segments = 0, metadata = 0, width = 0, height = 0, orientation = 1;
  let scanned = false, ended = false, seenExif = false, seenRestartInterval = false, restartInterval = 0;
  let adobeTransform: number | undefined;
  while (offset < bytes.length) {
    if (++segments > MAX_SEGMENTS || bytes[offset] !== 0xff) throw invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) throw invalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!scanned || offset !== bytes.length) throw invalid();
      parts.push(new Uint8Array([0xff, 0xd9])); ended = true; break;
    }
    if (scanned || offset + 2 > bytes.length) throw invalid();
    const length = u16(bytes, offset), end = offset + length;
    if (length < 2 || end > bytes.length) throw invalid();
    const payload = bytes.subarray(offset + 2, end);
    const segment = () => concat([new Uint8Array([0xff, marker]), bytes.subarray(offset, end)]);
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      metadata += length;
      if (metadata > MAX_METADATA_BYTES) throw invalid();
      if (marker === 0xe1 && payload.length >= 6 &&
          [69, 120, 105, 102, 0, 0].every((value, index) => payload[index] === value)) {
        if (seenExif) throw invalid();
        seenExif = true; orientation = exifOrientation(payload);
      }
      if (marker === 0xee && payload.length >= 5 &&
          [65, 100, 111, 98, 101].every((value, index) => payload[index] === value)) {
        if (adobeTransform !== undefined || payload.length !== 12 || payload[5] !== 0 || payload[11] > 1) throw unsupported();
        adobeTransform = payload[11];
        // Preserve only coding interpretation in a fixed Adobe marker. The
        // original version/flags and every other APP/COM byte are discarded.
        parts.push(new Uint8Array([0xff, 0xee, 0, 14, 65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, adobeTransform]));
      }
    } else if (marker === 0xc0) {
      if (width || payload.length < 6 || payload[0] !== 8) throw invalid();
      height = u16(payload, 1); width = u16(payload, 3); dimensions(width, height);
      const count = payload[5];
      if ((count !== 1 && count !== 3) || payload.length !== 6 + count * 3) throw unsupported();
      let blocksPerMcu = 0;
      for (let index = 0; index < count; index++) {
        const start = 6 + index * 3, sample = payload[start + 1];
        const horizontal = sample >> 4, vertical = sample & 15;
        if (componentIds.includes(payload[start]) || horizontal < 1 || horizontal > 2 ||
            vertical < 1 || vertical > 2 || payload[start + 2] > 3) throw unsupported();
        blocksPerMcu += horizontal * vertical;
        componentIds.push(payload[start]); quantizationIds.push(payload[start + 2]);
      }
      if (blocksPerMcu > 10 || (count === 1 && payload[7] !== 0x11)) throw unsupported();
      parts.push(segment());
    } else if (marker === 0xdb) {
      readQuantizationTables(payload, quantizationTables); parts.push(segment());
    } else if (marker === 0xc4) {
      readHuffmanTables(payload, huffmanTables); parts.push(segment());
    } else if (marker === 0xdd) {
      if (seenRestartInterval || payload.length !== 2) throw invalid();
      seenRestartInterval = true; restartInterval = u16(payload, 0); parts.push(segment());
    } else if (marker === 0xda) {
      const count = payload[0];
      if (!width || count !== componentIds.length || payload.length !== 4 + count * 2 ||
          payload[payload.length - 3] !== 0 || payload[payload.length - 2] !== 63 || payload[payload.length - 1] !== 0) throw unsupported();
      if (quantizationIds.some(id => !quantizationTables.has(id)) || (count === 1 && adobeTransform === 1)) throw invalid();
      const scanIds = Array.from({ length: count }, (_, index) => payload[1 + index * 2]);
      if (new Set(scanIds).size !== count || componentIds.some(id => !scanIds.includes(id))) throw invalid();
      for (let index = 0; index < count; index++) {
        const spec = payload[2 + index * 2];
        if ((spec >> 4) > 3 || (spec & 15) > 3 || !huffmanTables.has(spec >> 4) || !huffmanTables.has(0x10 | (spec & 15))) throw invalid();
      }
      parts.push(segment()); scanned = true;
      let cursor = end, nextRestart = 0;
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) { cursor++; continue; }
        const start = cursor;
        while (cursor < bytes.length && bytes[cursor] === 0xff) cursor++;
        if (cursor >= bytes.length) throw invalid();
        const next = bytes[cursor];
        if (next === 0) {
          if (cursor !== start + 1) throw invalid();
          cursor++; continue;
        }
        if (next >= 0xd0 && next <= 0xd7) {
          if (!restartInterval || next !== 0xd0 + nextRestart) throw invalid();
          nextRestart = (nextRestart + 1) % 8; cursor++; continue;
        }
        if (next !== 0xd9) throw unsupported();
        if (start === end) throw invalid();
        parts.push(bytes.subarray(end, start)); offset = start; break;
      }
      if (cursor >= bytes.length) throw invalid();
      continue;
    } else throw unsupported();
    offset = end;
  }
  if (!ended) throw invalid();
  return { bytes: concat(parts), width, height, orientation, colorTransform: adobeTransform !== 0 };
}

function orient(data: Uint8Array, width: number, height: number, orientation: number) {
  if (data.byteLength !== width * height * 4) throw invalid();
  if (orientation === 1) return { data, width, height };
  const swapped = orientation >= 5;
  const outputWidth = swapped ? height : width, outputHeight = swapped ? width : height;
  const result = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let targetX = x, targetY = y;
    if (orientation === 2) targetX = width - 1 - x;
    if (orientation === 3) { targetX = width - 1 - x; targetY = height - 1 - y; }
    if (orientation === 4) targetY = height - 1 - y;
    if (orientation === 5) { targetX = y; targetY = x; }
    if (orientation === 6) { targetX = height - 1 - y; targetY = x; }
    if (orientation === 7) { targetX = height - 1 - y; targetY = width - 1 - x; }
    if (orientation === 8) { targetX = y; targetY = width - 1 - x; }
    const from = (y * width + x) * 4, to = (targetY * outputWidth + targetX) * 4;
    result.set(data.subarray(from, from + 4), to);
  }
  return { data: result, width: outputWidth, height: outputHeight };
}

export async function normalizeChatImage(file: File) {
  if (!Number.isInteger(file.size) || file.size < 1) throw invalid();
  if (file.size > CHAT_IMAGE_MAX_BYTES) throw new ChatImageError('IMAGE_TOO_LARGE');
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw unsupported();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw invalid();
  try {
    let image: { data: Uint8Array; width: number; height: number };
    if (file.type === 'image/png') {
      const prepared = preparePng(bytes);
      const decoded = PNG.sync.read(prepared.bytes, { checkCRC: true });
      if (decoded.width !== prepared.width || decoded.height !== prepared.height) throw invalid();
      image = { data: decoded.data, width: decoded.width, height: decoded.height };
    } else {
      const prepared = prepareJpeg(bytes);
      const decoded = decodeJpeg(prepared.bytes, {
        useTArray: true, formatAsRGBA: true, tolerantDecoding: false, colorTransform: prepared.colorTransform,
        maxResolutionInMP: 1, maxMemoryUsageInMB: 32,
      });
      if (decoded.width !== prepared.width || decoded.height !== prepared.height) throw invalid();
      image = orient(decoded.data, decoded.width, decoded.height, prepared.orientation);
    }
    dimensions(image.width, image.height);
    if (image.data.byteLength !== image.width * image.height * 4) throw invalid();
    // Fresh three-field input: no EXIF, ICC, text or original encoded bytes.
    const encoded = PNG.sync.write({ data: Buffer.from(image.data), width: image.width, height: image.height }, {
      colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, filterType: 0, deflateLevel: 6,
    });
    if (!encoded.byteLength || encoded.byteLength > CHAT_IMAGE_MAX_BYTES) {
      throw new ChatImageError('IMAGE_TOO_LARGE');
    }
    // Check the trusted encoder's canonical header without a third inflate.
    if (encoded.byteLength < 58 || !PNG_SIGNATURE.every((value, index) => encoded[index] === value) ||
        u32(encoded, 8) !== 13 || ![73, 72, 68, 82].every((value, index) => encoded[12 + index] === value) ||
        u32(encoded, 16) !== image.width || u32(encoded, 20) !== image.height ||
        encoded[24] !== 8 || encoded[25] !== 6 || encoded[26] !== 0 || encoded[27] !== 0 || encoded[28] !== 0 ||
        crc(encoded, 12, 29) !== u32(encoded, 29)) throw invalid();
    return encoded;
  } catch (error) {
    if (error instanceof ChatImageError) throw error;
    throw invalid();
  }
}
