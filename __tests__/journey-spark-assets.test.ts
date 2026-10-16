/** @jest-environment node */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Chunk = { name: string; data: Buffer };
function webpChunks(file: string): Chunk[] {
  const buffer = readFileSync(join(process.cwd(), 'public/images', file));
  expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buffer.toString('ascii', 8, 12)).toBe('WEBP');
  const chunks: Chunk[] = [];
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset + 4);
    chunks.push({ name: buffer.toString('ascii', offset, offset + 4), data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length + length % 2;
  }
  return chunks;
}

it('ships the verified transparent two-second one-shot Blender clip', () => {
  const path = join(process.cwd(), 'public/images/forge-spark-celebrate-once.webp');
  const buffer = readFileSync(path);
  expect(buffer.length).toBe(134882);
  expect(createHash('sha256').update(buffer).digest('hex')).toBe('e2c4c7024d1f8d068a67081296bf5f1800035d068094b53110054eea04613e32');
  const chunks = webpChunks('forge-spark-celebrate-once.webp');
  const canvas = chunks.find(chunk => chunk.name === 'VP8X')!.data;
  expect(canvas[0] & 0x10).toBe(0x10); // Alpha channel
  expect([canvas.readUIntLE(4, 3) + 1, canvas.readUIntLE(7, 3) + 1]).toEqual([224, 224]);
  expect(chunks.find(chunk => chunk.name === 'ANIM')!.data.readUInt16LE(4)).toBe(1);
  const frames = chunks.filter(chunk => chunk.name === 'ANMF');
  expect(frames).toHaveLength(25);
  expect(frames.map(frame => frame.data.readUIntLE(12, 3))).toEqual(Array(25).fill(80));
});

it('ships a genuine still for the final/fallback pose', () => {
  const chunks = webpChunks('forge-spark-celebrate-final.webp');
  expect(chunks.some(chunk => chunk.name === 'ANIM' || chunk.name === 'ANMF')).toBe(false);
  expect(chunks.some(chunk => chunk.name === 'ALPH')).toBe(true);
});
