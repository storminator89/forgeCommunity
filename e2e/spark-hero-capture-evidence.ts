import sharp from 'sharp';

export type HeroCaptureRect = { x: number; y: number; width: number; height: number };

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
  const result = (ready: boolean, state = before, decodedAtMs: number | null = null) =>
    ({ ready, state, timing: { startedAtMs, decodedAtMs, observedAtMs: performance.now() } });
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

/** Reads only the image interior in the original full-page PNG; never rewrites it. */
export async function inspectSparkHeroCapture(png: Buffer, rect: HeroCaptureRect, dpr: number, viewportWidth: number) {
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
  // This is only a blank-output guard, not an exact-color visual baseline or a
  // claim that the full composition is correct. Genuine artwork is far above
  // these small variation floors; a uniform white or dark frame has zero.
  return {
    screenshot: { width: metadata.width, height: metadata.height }, region, channels,
    nonblank: channels.some(channel => channel.range >= 32 && channel.stdev >= 8),
  };
}
