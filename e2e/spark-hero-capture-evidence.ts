import sharp from 'sharp';
import type { Page, Request, Response } from '@playwright/test';

export type HeroCaptureRect = { x: number; y: number; width: number; height: number };

/** Never retain arbitrary page/account URLs, queries, headers or response bodies. */
export function sparkHeroArtworkPath(value: string, origin: string) {
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin && !url.search && !url.hash && !url.username && !url.password &&
      /^\/images\/home\/forge-workbench-(480|768|1440)\.webp$/.test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}

/** Passive listeners are installed before navigation, including on second tabs. */
export function observeSparkHeroRequests(page: Page, origin: string) {
  type Phase = 'outside-capture' | 'capture' | 'post-capture';
  type Event = { id: number; path: string; event: 'started' | 'response' | 'finished' | 'failed'; phase: Phase; atMs: number;
    status?: number; fromServiceWorker?: boolean; timing?: ReturnType<Request['timing']> };
  const events: Event[] = [];
  const requests = new WeakMap<Request, { id: number; path: string }>();
  let phase: Phase = 'outside-capture';
  let started = 0;
  let droppedEvents = 0;
  const record = (event: Omit<Event, 'phase' | 'atMs'>) => {
    if (events.length === 96) { droppedEvents++; return; }
    events.push({ ...event, phase, atMs: performance.now() });
  };
  const onRequest = (request: Request) => {
    const path = sparkHeroArtworkPath(request.url(), origin);
    if (request.resourceType() !== 'image' || !path) return;
    const identity = { id: ++started, path };
    requests.set(request, identity);
    record({ ...identity, event: 'started' });
  };
  const onResponse = (response: Response) => {
    const identity = requests.get(response.request());
    if (identity) record({ ...identity, event: 'response', status: response.status(), fromServiceWorker: response.fromServiceWorker() });
  };
  const onFinished = (request: Request) => {
    const identity = requests.get(request);
    if (identity) record({ ...identity, event: 'finished', timing: request.timing() });
  };
  const onFailed = (request: Request) => {
    const identity = requests.get(request);
    if (identity) record({ ...identity, event: 'failed' });
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  return {
    mark(next: Phase) { phase = next; return performance.now(); },
    snapshot() { return { timeOrigin: performance.timeOrigin, started, droppedEvents, events: [...events] }; },
    stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
    },
  };
}

/** Runs in the page without changing its DOM, styles, focus, scroll or requests. */
export async function observeSparkHeroCapture(element: Element, settle: boolean) {
  const image = element as HTMLImageElement;
  const snapshot = () => {
    const rect = image.getBoundingClientRect();
    const url = image.currentSrc ? new URL(image.currentSrc, location.href) : null;
    // Diagnostics contain only the known public artwork path, never page or account URLs.
    const currentSrc = url?.origin === location.origin && !url.search && !url.hash &&
      /^\/images\/home\/forge-workbench-(480|768|1440)\.webp$/.test(url.pathname) ? url.pathname : null;
    let renderable = image.isConnected && rect.width > 0 && rect.height > 0;
    for (let ancestor: Element | null = image; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          (style.opacity !== '' && Number(style.opacity) === 0)) renderable = false;
    }
    const frame = image.closest('[data-motion="forge-workbench"]');
    return {
      currentSrc, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      renderable,
      runningAnimations: frame?.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length ?? 0,
    };
  };
  const before = snapshot();
  const startedAtMs = performance.now();
  const result = (ready: boolean, state = before, decodedAtMs: number | null = null) => {
    const entries = performance.getEntriesByType('resource').flatMap(entry => {
      const url = new URL(entry.name, location.href);
      if (url.origin !== location.origin || url.search || url.hash ||
          !/^\/images\/home\/forge-workbench-(480|768|1440)\.webp$/.test(url.pathname)) return [];
      const resource = entry as PerformanceResourceTiming;
      return [{ path: url.pathname, initiatorType: resource.initiatorType === 'img' ? 'img' : 'other',
        startTime: resource.startTime, fetchStart: resource.fetchStart, responseStart: resource.responseStart,
        responseEnd: resource.responseEnd, transferSize: resource.transferSize,
        encodedBodySize: resource.encodedBodySize, decodedBodySize: resource.decodedBodySize,
        deliveryType: (resource as PerformanceResourceTiming & { deliveryType?: string }).deliveryType === 'cache' ? 'cache' : null }];
    });
    return { ready, state, timing: { startedAtMs, decodedAtMs, observedAtMs: performance.now() },
      resources: { timeOrigin: performance.timeOrigin, count: entries.length, dropped: Math.max(0, entries.length - 12), entries: entries.slice(-12) } };
  };
  if (!settle || !before.currentSrc || !before.complete || !before.naturalWidth || !before.naturalHeight ||
      !before.renderable || before.runningAnimations) return result(false);
  const selected = image.currentSrc;
  try {
    await image.decode();
  } catch (error) {
    // A responsive source change invalidates this observation. A real decode
    // failure of the same source must fail the test, rather than be swallowed.
    if (image.currentSrc !== selected) return result(false, snapshot());
    throw error;
  }
  const decodedAtMs = performance.now();
  const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await nextFrame();
  const firstFrame = snapshot();
  await nextFrame();
  const secondFrame = snapshot();
  const stable = image.currentSrc === selected && JSON.stringify(before) === JSON.stringify(firstFrame) &&
    JSON.stringify(firstFrame) === JSON.stringify(secondFrame);
  // Rendering opportunities and decoded data do not prove compositor output.
  // The single, unchanged screenshot is checked separately below.
  return result(stable, secondFrame, decodedAtMs);
}

/** Responsive candidates share one approved composition; their URL strings need not stay equal.
 * https://html.spec.whatwg.org/multipage/images.html#select-an-image-source
 * This alone says nothing about requests, cache use or the pixels actually captured.
 */
export function sparkHeroCaptureIdentity(before: Awaited<ReturnType<typeof observeSparkHeroCapture>>, after: Awaited<ReturnType<typeof observeSparkHeroCapture>>) {
  const { currentSrc: beforeSource, ...beforeState } = before.state;
  const { currentSrc: afterSource, ...afterState } = after.state;
  return {
    decodedAndStable: before.ready && after.ready,
    approvedCompositionFamily: [beforeSource, afterSource].every(source => source !== null &&
      /^\/images\/home\/forge-workbench-(480|768|1440)\.webp$/.test(source)),
    unchangedRenderedState: JSON.stringify(beforeState) === JSON.stringify(afterState),
  };
}

/** Reads only the image interior in the original full-page PNG; never rewrites it. */
export async function inspectSparkHeroCapture(png: Buffer, rect: HeroCaptureRect, dpr: number, viewportWidth: number, approvedArtwork: Buffer) {
  if (![rect.x, rect.y, rect.width, rect.height, dpr, viewportWidth].every(Number.isFinite) ||
      rect.width <= 0 || rect.height <= 0 || dpr <= 0 || viewportWidth <= 0) throw new Error('Invalid Hero capture geometry.');
  const metadata = await sharp(png).metadata();
  // The existing overflow contract permits at most one CSS pixel. Bind the
  // assumed device-pixel scale to the actual unmodified full-page screenshot.
  if (!metadata.width || Math.abs(metadata.width - viewportWidth * dpr) > Math.max(1, Math.ceil(dpr))) {
    throw new Error('Hero capture PNG width does not match the observed viewport and DPR.');
  }
  // Exclude edge antialiasing and the surrounding frame. A border, nearby text
  // or Spark itself must never make an empty artwork region pass this guard.
  const inset = Math.max(2, Math.min(rect.width, rect.height) * 0.02);
  const left = Math.ceil((rect.x + inset) * dpr);
  const top = Math.ceil((rect.y + inset) * dpr);
  const right = Math.floor((rect.x + rect.width - inset) * dpr);
  const bottom = Math.floor((rect.y + rect.height - inset) * dpr);
  if (left < 0 || top < 0 || right > metadata.width! || bottom > metadata.height! ||
      right - left < 8 || bottom - top < 8) throw new Error('Hero capture interior is outside the full-page PNG or too small.');
  const region = { left, top, width: right - left, height: bottom - top };
  // Sharp.stats() measures its input, not preceding pipeline operations. Feed
  // it only the extracted raw pixels so nearby page content cannot pass this.
  const { data, info } = await sharp(png).extract(region).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const stats = await sharp(data, { raw: info }).stats();
  const channels = stats.channels.map(channel => ({ range: channel.max - channel.min, stdev: channel.stdev }));
  // Compare spatial composition against the existing opaque, uncropped approved
  // artwork, not another screenshot. A small grid tolerates browser resampling
  // and WebP candidate differences while detecting wrong/shifted varied imagery.
  const reference = await sharp(approvedArtwork).metadata();
  if (!reference.width || !reference.height) throw new Error('Invalid approved Hero artwork.');
  const assetLeft = Math.round((left / dpr - rect.x) / rect.width * reference.width);
  const assetTop = Math.round((top / dpr - rect.y) / rect.height * reference.height);
  const assetRight = Math.round((right / dpr - rect.x) / rect.width * reference.width);
  const assetBottom = Math.round((bottom / dpr - rect.y) / rect.height * reference.height);
  const grid = { width: 24, height: 16 };
  const observed = await sharp(data, { raw: info }).resize(grid.width, grid.height, { fit: 'fill' }).raw().toBuffer();
  const expected = await sharp(approvedArtwork).extract({ left: assetLeft, top: assetTop,
    width: assetRight - assetLeft, height: assetBottom - assetTop })
    .toColourspace('srgb').removeAlpha().resize(grid.width, grid.height, { fit: 'fill' }).raw().toBuffer();
  let totalError = 0;
  let maxCellMeanError = 0;
  for (let offset = 0; offset < observed.length; offset += 3) {
    const error = Math.abs(observed[offset] - expected[offset]) + Math.abs(observed[offset + 1] - expected[offset + 1]) + Math.abs(observed[offset + 2] - expected[offset + 2]);
    totalError += error;
    maxCellMeanError = Math.max(maxCellMeanError, error / 3);
  }
  const meanAbsoluteError = totalError / observed.length;
  // Preserve the separate blank-output guard and its original floors. Genuine
  // artwork is far above them; a uniform white or dark frame has zero. The
  // composition check is spatial and deliberately not an exact-color baseline.
  return {
    screenshot: { width: metadata.width, height: metadata.height }, region, channels,
    nonblank: channels.some(channel => channel.range >= 32 && channel.stdev >= 8),
    composition: { grid, meanAbsoluteError, maxCellMeanError,
      matches: meanAbsoluteError <= 8 && maxCellMeanError <= 24 },
  };
}
