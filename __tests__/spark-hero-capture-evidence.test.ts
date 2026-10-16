/** @jest-environment node */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { inspectSparkHeroCapture, observeSparkHeroCapture } from '../e2e/spark-hero-capture-evidence';

const rect = { x: 8, y: 12, width: 80, height: 60 };
const solid = (background: string, width = 100, height = 90) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

async function withImage(action: (fixture: {
  image: HTMLImageElement; decode: jest.Mock; style: { display: string; visibility: string; opacity: string };
  onFrame: (callback: (frame: number) => void) => void;
}) => Promise<void>) {
  const style = { display: 'block', visibility: 'visible', opacity: '1' };
  const decode = jest.fn().mockResolvedValue(undefined);
  const image = {
    currentSrc: 'http://localhost/images/home/forge-workbench-480.webp',
    complete: true, naturalWidth: 480, naturalHeight: 320, isConnected: true, parentElement: null,
    getBoundingClientRect: () => ({ ...rect }), closest: () => ({ getAnimations: () => [] }), decode,
  } as unknown as HTMLImageElement;
  let frames = 0;
  let onFrame: (frame: number) => void = () => {};
  const globals = {
    location: { origin: 'http://localhost', href: 'http://localhost/' },
    scrollX: 3, scrollY: 100, innerWidth: 768, innerHeight: 900, devicePixelRatio: 2,
    getComputedStyle: () => style,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const frame = ++frames;
      queueMicrotask(() => { onFrame(frame); callback(performance.now()); });
      return frame;
    },
  };
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    await action({ image, decode, style, onFrame: callback => { onFrame = callback; } });
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

it('decodes the selected image and observes unchanged document geometry over two rendering frames', async () => {
  await withImage(async ({ image, decode }) => {
    const observation = await observeSparkHeroCapture(image, true);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(observation.ready).toBe(true);
    expect(observation.state).toMatchObject({
      currentSrc: '/images/home/forge-workbench-480.webp',
      rect: { ...rect, x: rect.x + 3, y: rect.y + 100 },
      viewport: { width: 768, height: 900, dpr: 2 }, renderable: true,
    });
    expect(observation.timing.decodedAtMs).not.toBeNull();
    expect(observation.timing.observedAtMs).toBeGreaterThanOrEqual(observation.timing.decodedAtMs!);
  });
});

it('only observes diagnostics when settling is disabled, without decoding or waiting', async () => {
  await withImage(async ({ image, decode, onFrame }) => {
    const frame = jest.fn();
    onFrame(frame);
    expect((await observeSparkHeroCapture(image, false)).ready).toBe(false);
    expect(decode).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });
});

it('does not accept currentSrc or geometry that changes after decode', async () => {
  await withImage(async ({ image, onFrame }) => {
    onFrame(frame => {
      if (frame === 1) Object.defineProperty(image, 'currentSrc', { value: 'http://localhost/images/home/forge-workbench-768.webp' });
    });
    expect((await observeSparkHeroCapture(image, true)).ready).toBe(false);
  });
  await withImage(async ({ image, onFrame }) => {
    onFrame(frame => {
      if (frame === 2) image.getBoundingClientRect = () => ({ ...rect, width: 81 } as DOMRect);
    });
    expect((await observeSparkHeroCapture(image, true)).ready).toBe(false);
  });
});

it('reobserves an invalidated responsive decode but propagates a same-source decode error', async () => {
  await withImage(async ({ image, decode }) => {
    decode.mockImplementation(async () => {
      Object.defineProperty(image, 'currentSrc', { value: 'http://localhost/images/home/forge-workbench-768.webp' });
      throw new Error('Source replaced during decode');
    });
    expect((await observeSparkHeroCapture(image, true)).ready).toBe(false);
  });
  await withImage(async ({ image, decode }) => {
    const error = new Error('Real decode failure');
    decode.mockRejectedValue(error);
    await expect(observeSparkHeroCapture(image, true)).rejects.toBe(error);
  });
});

it('rejects unloaded, invisible and unrecognized-source states without leaking arbitrary URLs', async () => {
  await withImage(async ({ image, decode, style }) => {
    Object.defineProperty(image, 'complete', { value: false, configurable: true });
    expect((await observeSparkHeroCapture(image, true)).ready).toBe(false);
    Object.defineProperty(image, 'complete', { value: true });
    style.opacity = '0';
    expect((await observeSparkHeroCapture(image, true)).ready).toBe(false);
    style.opacity = '1';
    Object.defineProperty(image, 'currentSrc', { value: 'https://elsewhere.invalid/private?account=secret' });
    const observation = await observeSparkHeroCapture(image, true);
    expect(observation.state.currentSrc).toBeNull();
    expect(JSON.stringify(observation)).not.toMatch(/private|secret|elsewhere/);
    expect(observation.ready).toBe(false);
    expect(decode).not.toHaveBeenCalled();
  });
});

it.each(['white', 'black', '#173c42'])('rejects a uniformly %s Hero interior', async background => {
  expect((await inspectSparkHeroCapture(await solid(background), rect, 1, 100)).nonblank).toBe(false);
});

it('does not count colorful surrounding UI or a frame border as visible artwork', async () => {
  const interior = await solid('white', 76, 56);
  const png = await sharp(await solid('#2f6dba')).composite([{ input: interior, left: 10, top: 14 }]).png().toBuffer();
  const original = Buffer.from(png);
  expect((await inspectSparkHeroCapture(png, rect, 1, 100)).nonblank).toBe(false);
  expect(png).toEqual(original);
});

it('accepts visible, varied artwork while preserving the original PNG bytes', async () => {
  const content = await solid('#c65522', 35, 30);
  const png = await sharp(await solid('white')).composite([{ input: content, left: 25, top: 25 }]).png().toBuffer();
  const original = Buffer.from(png);
  const result = await inspectSparkHeroCapture(png, rect, 1, 100);
  expect(result.nonblank).toBe(true);
  expect(result.region).toEqual({ left: 10, top: 14, width: 76, height: 56 });
  expect(png).toEqual(original);
});

it('maps fractional document coordinates and actual screenshot DPR inward', async () => {
  const png = await solid('white', 200, 180);
  const result = await inspectSparkHeroCapture(png, { ...rect, x: 8.25, y: 12.5 }, 2, 100);
  expect(result.region).toEqual({ left: 21, top: 29, width: 151, height: 112 });
  expect(result.screenshot).toEqual({ width: 200, height: 180 });
  expect(result.nonblank).toBe(false);
});

it.each([
  [{ ...rect, x: -20 }, 1], [{ ...rect, y: 80 }, 1], [{ ...rect, width: 2 }, 1],
  [{ ...rect, width: NaN }, 1], [rect, 0], [rect, Infinity],
] as const)('rejects invalid or unmeasurable capture geometry %#', async (box, dpr) => {
  await expect(inspectSparkHeroCapture(await solid('white'), box, dpr, 100)).rejects.toThrow(/Hero capture/);
});

it('rejects a screenshot scale inconsistent with the observed viewport and DPR', async () => {
  await expect(inspectSparkHeroCapture(await solid('white'), rect, 2, 100)).rejects.toThrow(/PNG width/);
  await expect(inspectSparkHeroCapture(await solid('white'), rect, 1, NaN)).rejects.toThrow(/geometry/);
});

it('keeps bounded render readiness and one unmodified capture rather than screenshot retries', () => {
  const source = readFileSync('e2e/spark-entry.pw.ts', 'utf8');
  const helper = readFileSync('e2e/spark-hero-capture-evidence.ts', 'utf8');
  const capture = source.slice(source.indexOf('async function capture('), source.indexOf('async function assertStaticFigure('));
  expect(capture).toContain('timeout: 20_000');
  expect(capture).toContain('document.fonts.ready');
  expect(capture).toContain('hero.evaluate(observeSparkHeroCapture, true)');
  expect(capture).toContain('expect(after.state');
  expect(capture).toContain('expect(pixels.nonblank');
  // The no-Hero path and Hero path each have exactly one capture, outside the readiness poll.
  expect(capture.match(/page\.screenshot\(/g)).toHaveLength(2);
  expect(capture).not.toMatch(/waitForTimeout|toPass|toHaveScreenshot|mask:|clip:|style:|scale:/);
  expect(helper).toContain('await image.decode()');
  expect(helper.match(/await nextFrame\(\)/g)).toHaveLength(2);
  expect(helper).toContain('image.currentSrc !== selected');
  expect(helper).toContain('throw error');
});
