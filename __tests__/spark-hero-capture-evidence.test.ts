/** @jest-environment node */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { Page, Request, Response } from '@playwright/test';
import { inspectSparkHeroCapture, observeSparkHeroCapture, observeSparkHeroRequests, sparkHeroArtworkPath, sparkHeroCaptureIdentity } from '../e2e/spark-hero-capture-evidence';

const rect = { x: 8, y: 12, width: 80, height: 60 };
const approvedArtwork = readFileSync('public/images/home/forge-workbench-1440.webp');
const inspect = (png: Buffer, box: typeof rect, dpr: number, viewportWidth: number) =>
  inspectSparkHeroCapture(png, box, dpr, viewportWidth, approvedArtwork);
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

it('accepts independently settled same-composition candidates, preserving every other rendered-state field', async () => {
  await withImage(async ({ image }) => {
    const before = await observeSparkHeroCapture(image, true);
    Object.defineProperty(image, 'currentSrc', { value: 'http://localhost/images/home/forge-workbench-768.webp' });
    const after = await observeSparkHeroCapture(image, true);
    expect(sparkHeroCaptureIdentity(before, after)).toEqual({
      decodedAndStable: true, approvedCompositionFamily: true, unchangedRenderedState: true,
    });
    expect(sparkHeroCaptureIdentity(before, { ...after, ready: false }).decodedAndStable).toBe(false);
    for (const patch of [
      { rect: { ...after.state.rect, x: 1 } }, { viewport: { ...after.state.viewport, width: 320 } },
      { naturalWidth: 768 }, { naturalHeight: 512 }, { complete: false }, { renderable: false }, { runningAnimations: 1 },
    ]) expect(sparkHeroCaptureIdentity(before, { ...after, state: { ...after.state, ...patch } }).unchangedRenderedState).toBe(false);
    expect(sparkHeroCaptureIdentity(before, { ...after, state: { ...after.state, currentSrc: null } }).approvedCompositionFamily).toBe(false);
  });
});

it('bounds public resource timings and does not expose arbitrary URLs or claim a zero transfer proves cache', async () => {
  const path = '/images/home/forge-workbench-480.webp';
  const entry = (name: string) => ({ name, entryType: 'resource', duration: 2, toJSON: () => ({}), initiatorType: 'img', startTime: 1, fetchStart: 1, responseStart: 2,
    responseEnd: 3, transferSize: 0, encodedBodySize: 17162, decodedBodySize: 17162, deliveryType: '' });
  const spy = jest.spyOn(performance, 'getEntriesByType').mockReturnValue([
    entry('https://elsewhere.invalid/private?account=secret'), entry(`http://localhost${path}?account=secret`),
    ...Array.from({ length: 14 }, () => entry(`http://localhost${path}`)),
  ] as PerformanceEntry[]);
  try {
    await withImage(async ({ image }) => {
      const observation = await observeSparkHeroCapture(image, false);
      expect(observation.resources).toMatchObject({ count: 14, dropped: 2 });
      expect(observation.resources.entries).toHaveLength(12);
      expect(observation.resources.entries[0]).toMatchObject({ path, transferSize: 0, deliveryType: null });
      expect(JSON.stringify(observation)).not.toMatch(/private|secret|elsewhere/);
    });
  } finally { spy.mockRestore(); }
});

it('passively distinguishes started, response, finished and failed requests within a bounded public-only log', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const page = { on: (event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event) } as unknown as Page;
  const path = '/images/home/forge-workbench-480.webp';
  const request = (url = `http://localhost${path}`, type = 'image') => ({ url: () => url, resourceType: () => type,
    timing: () => ({ startTime: 10, responseEnd: 2 }) } as Request);
  const observation = observeSparkHeroRequests(page, 'http://localhost');
  for (const url of ['https://elsewhere.invalid'+path, `http://localhost${path}?secret=1`, 'http://localhost/account', 'invalid%']) {
    expect(sparkHeroArtworkPath(url, 'http://localhost')).toBeNull();
    listeners.get('request')!(request(url));
  }
  listeners.get('request')!(request(undefined, 'fetch'));
  const first = request();
  listeners.get('request')!(first);
  observation.mark('capture');
  listeners.get('response')!({ request: () => first, status: () => 200, fromServiceWorker: () => false } as Response);
  listeners.get('requestfinished')!(first);
  observation.mark('post-capture');
  const failed = request();
  listeners.get('request')!(failed);
  listeners.get('requestfailed')!(failed);
  expect(observation.snapshot()).toMatchObject({ started: 2, droppedEvents: 0, events: [
    { id: 1, path, event: 'started', phase: 'outside-capture' },
    { id: 1, path, event: 'response', phase: 'capture', status: 200, fromServiceWorker: false },
    { id: 1, path, event: 'finished', phase: 'capture', timing: { startTime: 10, responseEnd: 2 } },
    { id: 2, path, event: 'started', phase: 'post-capture' }, { id: 2, path, event: 'failed', phase: 'post-capture' },
  ] });
  for (let i = 0; i < 100; i++) listeners.get('request')!(request());
  expect(observation.snapshot()).toMatchObject({ started: 102, droppedEvents: 9 });
  expect(observation.snapshot().events).toHaveLength(96);
  expect(JSON.stringify(observation.snapshot())).not.toMatch(/secret|elsewhere|account|invalid/);
  observation.stop();
  expect(listeners.size).toBe(0);
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
  expect((await inspect(await solid(background), rect, 1, 100)).nonblank).toBe(false);
});

it('does not count colorful surrounding UI or a frame border as visible artwork', async () => {
  const interior = await solid('white', 76, 56);
  const png = await sharp(await solid('#2f6dba')).composite([{ input: interior, left: 10, top: 14 }]).png().toBuffer();
  const original = Buffer.from(png);
  expect((await inspect(png, rect, 1, 100)).nonblank).toBe(false);
  expect(png).toEqual(original);
});

it('accepts visible, varied artwork while preserving the original PNG bytes', async () => {
  const content = await solid('#c65522', 35, 30);
  const png = await sharp(await solid('white')).composite([{ input: content, left: 25, top: 25 }]).png().toBuffer();
  const original = Buffer.from(png);
  const result = await inspect(png, rect, 1, 100);
  expect(result.nonblank).toBe(true);
  expect(result.composition.matches).toBe(false);
  expect(result.region).toEqual({ left: 10, top: 14, width: 76, height: 56 });
  expect(png).toEqual(original);
});

it.each([
  [320, 1, 270], [375, 1, 325], [390, 1, 340], [414, 1, 364], [768, 1, 374],
  [1280, 1, 655], [320, 2, 270], [390, 2, 340], [320, 1, 222],
] as const)('recognizes the approved composition across viewport %s, DPR %s and slot %s', async (viewportWidth, dpr, width) => {
  const box = { x: 25.25, y: 40.5, width, height: width * 2 / 3 };
  for (const candidate of [480, 768, 1440]) {
    const artwork = await sharp(readFileSync(`public/images/home/forge-workbench-${candidate}.webp`))
      .resize(Math.round(width * dpr), Math.round(box.height * dpr)).png().toBuffer();
    const png = await sharp(await solid('white', viewportWidth * dpr, Math.ceil((box.y + box.height + 20) * dpr)))
      .composite([{ input: artwork, left: Math.floor(box.x * dpr), top: Math.floor(box.y * dpr) }]).png().toBuffer();
    const original = Buffer.from(png);
    const result = await inspect(png, box, dpr, viewportWidth);
    expect(result.nonblank).toBe(true);
    expect(result.composition.matches).toBe(true);
    expect(png).toEqual(original);
  }
});

it.each(['shifted', 'mirrored', 'cropped', 'unrelated', 'local-patch'] as const)('rejects a nonblank %s composition', async variant => {
  const box = { x: 25, y: 40, width: 270, height: 180 };
  let image = sharp(approvedArtwork);
  if (variant === 'mirrored') image = image.flop();
  if (variant === 'cropped') image = image.extract({ left: 360, top: 240, width: 720, height: 480 });
  let artwork = await image.resize(box.width, box.height).png().toBuffer();
  if (variant === 'unrelated') artwork = await sharp(readFileSync('public/images/forge-spark-preview.webp')).resize(box.width, box.height, { fit: 'fill' }).png().toBuffer();
  if (variant === 'shifted') artwork = await sharp(await solid('white', box.width, box.height))
    .composite([{ input: await sharp(artwork).extract({ left: 0, top: 0, width: 216, height: 180 }).toBuffer(), left: 54, top: 0 }]).png().toBuffer();
  if (variant === 'local-patch') artwork = await sharp(artwork).composite([{ input: await solid('white', 40, 40), left: 100, top: 70 }]).png().toBuffer();
  const png = await sharp(await solid('white', 320, 250)).composite([{ input: artwork, left: box.x, top: box.y }]).png().toBuffer();
  const original = Buffer.from(png);
  const result = await inspect(png, box, 1, 320);
  expect(result.nonblank).toBe(true);
  expect(result.composition.matches).toBe(false);
  if (variant === 'local-patch') {
    expect(result.composition.meanAbsoluteError).toBeLessThanOrEqual(8);
    expect(result.composition.maxCellMeanError).toBeGreaterThan(24);
  }
  expect(png).toEqual(original);
});

it('maps fractional document coordinates and actual screenshot DPR inward', async () => {
  const png = await solid('white', 200, 180);
  const result = await inspect(png, { ...rect, x: 8.25, y: 12.5 }, 2, 100);
  expect(result.region).toEqual({ left: 21, top: 29, width: 151, height: 112 });
  expect(result.screenshot).toEqual({ width: 200, height: 180 });
  expect(result.nonblank).toBe(false);
});

it.each([
  [{ ...rect, x: -20 }, 1], [{ ...rect, y: 80 }, 1], [{ ...rect, width: 2 }, 1],
  [{ ...rect, width: NaN }, 1], [rect, 0], [rect, Infinity],
] as const)('rejects invalid or unmeasurable capture geometry %#', async (box, dpr) => {
  await expect(inspect(await solid('white'), box, dpr, 100)).rejects.toThrow(/Hero capture/);
});

it('rejects a screenshot scale inconsistent with the observed viewport and DPR', async () => {
  await expect(inspect(await solid('white'), rect, 2, 100)).rejects.toThrow(/PNG width/);
  await expect(inspect(await solid('white'), rect, 1, NaN)).rejects.toThrow(/geometry/);
});

it('keeps bounded render readiness and one unmodified capture rather than screenshot retries', () => {
  const source = readFileSync('e2e/spark-entry.pw.ts', 'utf8');
  const helper = readFileSync('e2e/spark-hero-capture-evidence.ts', 'utf8');
  const capture = source.slice(source.indexOf('async function capture('), source.indexOf('async function assertStaticFigure('));
  expect(capture).toContain('timeout: 20_000');
  expect(capture).toContain('document.fonts.ready');
  expect(capture).toContain('hero.evaluate(observeSparkHeroCapture, true)');
  expect(capture).toContain('sparkHeroCaptureIdentity(observation, after!)');
  expect(capture).toContain('sparkHeroCaptureIdentity(observation, immediateAfter)');
  expect(capture).toContain('expect(pixels.nonblank');
  expect(capture).toContain('expect(pixels.composition.matches');
  expect(capture).toContain('observation.state.viewport.width, approvedHeroArtwork');
  expect(capture).toContain("network!.mark('capture')");
  expect(source).toContain("context.on('page', observe)");
  // The no-Hero path and Hero path each have exactly one capture, outside the readiness poll.
  expect(capture.match(/page\.screenshot\(/g)).toHaveLength(2);
  expect(capture).not.toMatch(/waitForTimeout|toPass|toHaveScreenshot|mask:|clip:|style:|scale:/);
  expect(helper).toContain('await image.decode()');
  expect(helper.match(/await nextFrame\(\)/g)).toHaveLength(2);
  expect(helper).toContain('image.currentSrc !== selected');
  expect(helper).toContain('throw error');
});

it('requires the actual loaded long Stats label before the focused capture, then captures its in-view dt/dd pair', () => {
  const source = readFileSync('e2e/spark-entry.pw.ts', 'utf8');
  const test = source.slice(source.indexOf("test('public and member Spark controls reflow at 200%"), source.indexOf("test('reduced motion keeps Spark static"));
  expect(test.indexOf("if (state === 'member') await expect(completedCourses).toBeVisible()")).toBeLessThan(test.indexOf('await capture(page, info, `spark-${state}'));
  expect(test).toContain("hasText: /^Mindestens einmal abgeschlossene Kurse$/");
  expect(test).toContain('await metric.scrollIntoViewIfNeeded()');
  expect(test).toContain("await expect(metric.locator('dd')).toBeInViewport({ ratio: 1 })");
  expect(test).toContain('await expect(completedCourses).toBeInViewport({ ratio: 1 })');
  expect(test).toContain('`spark-member-stats-200-percent-${mode}`');
});
