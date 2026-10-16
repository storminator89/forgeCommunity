import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const clipPath = '/images/forge-spark-celebrate-once.webp';
const clipSelector = 'img[data-spark-celebration]';

function assertDisposableFixture() {
  const url = process.env.DATABASE_URL;
  const path = url?.startsWith('file:') ? url.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Spark browser QA requires the explicitly disposable local SQLite fixture.');
  }
}

async function signIn(page: Page) {
  const nonce = randomUUID();
  const email = `spark-qa-${nonce}@example.test`;
  const password = `SparkQaA1!${nonce}`;
  const registered = await page.request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Spark QA Learner', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

async function journeyFixture(page: Page) {
  let complete = false;
  await page.route('**/api/courses', route => route.fulfill({ json: [
    { id: 'spark-qa-course', title: 'Spark QA Lernkurs', isEnrolled: true, canDelete: false },
  ] }));
  await page.route('**/api/courses/spark-qa-course/contents', route => route.fulfill({ json: [
    { id: 'spark-qa-step', title: 'Spark QA nächster Schritt', type: 'TEXT', order: 1, locked: false,
      publicationId: 'spark-qa-publication', subContents: [] },
  ] }));
  await page.route('**/api/courses/spark-qa-course/progress', route => route.fulfill({ json: {
    completedContentIds: complete ? ['spark-qa-step'] : [], complete, canTrack: true, publicationId: 'spark-qa-publication',
  } }));
  return { setComplete: (value: boolean) => { complete = value; } };
}

async function refresh(page: Page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/spark-qa-course/progress');
  await page.getByRole('button', { name: 'Stand aktualisieren' }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Stand aktualisieren' })).toBeVisible();
}

async function screenshotWidths(page: Page, testInfo: TestInfo, label: string) {
  for (const width of [320, 375, 414, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`spark-${label}-${width}.png`), fullPage: true });
  }
}

// Capture compositor frames throughout the real two-second window. Unlike two
// sequential locator screenshots, sampling does not wait for image stability,
// font readiness or a screenshot command before asking for the next frame.
async function captureChangingFrames(page: Page, testInfo: TestInfo, label: string, begin: () => void | Promise<void>) {
  const mascot = page.locator('[data-journey-mascot]');
  const box = await mascot.boundingBox();
  expect(box).not.toBeNull();
  // Timestamp the actual DOM playing interval in the browser. CDP events can
  // arrive late; receipt time would also count blank/loading/final-pose swaps.
  await page.evaluate(() => {
    const state: { start: number | null; end: number | null } = { start: null, end: null };
    const observer = new MutationObserver(() => {
      const playing = document.querySelector('[data-spark-celebration="playing"]');
      const now = performance.timeOrigin + performance.now();
      if (playing && state.start === null) state.start = now;
      else if (!playing && state.start !== null && state.end === null) state.end = now;
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-spark-celebration'] });
    (window as typeof window & { __sparkCapture?: { state: typeof state; observer: MutationObserver } }).__sparkCapture = { state, observer };
  });
  const session = await page.context().newCDPSession(page);
  const frames: Array<{ data: string; timestamp: number }> = [];
  let interval: { start: number | null; end: number | null } = { start: null, end: null };
  session.on('Page.screencastFrame', frame => {
    void session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    if (frame.metadata.timestamp !== undefined && frames.length < 200) {
      frames.push({ data: frame.data, timestamp: frame.metadata.timestamp * 1000 });
    }
  });
  await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  try {
    await begin();
    const clip = page.locator(clipSelector);
    await expect(clip).toHaveAttribute('data-spark-celebration', 'playing');
    // currentSrc becomes available only once the deliberately delayed request
    // loads. Verify the selected native resource during playback, not loading.
    expect(await clip.evaluate(image => (image as HTMLImageElement).currentSrc)).toBe(`${origin}${clipPath}`);
    await expect(clip).not.toHaveAttribute('srcset', /.+/);
    await expect(clip).toHaveCount(0);
  } finally {
    interval = await page.evaluate(() => {
      const capture = (window as typeof window & { __sparkCapture?: {
        state: { start: number | null; end: number | null }; observer: MutationObserver;
      } }).__sparkCapture;
      capture?.observer.disconnect();
      return capture?.state ?? { start: null, end: null };
    });
    await session.send('Page.stopScreencast');
    await session.detach();
  }
  expect(interval.start).not.toBeNull();
  expect(interval.end).not.toBeNull();
  // Exclude compositor edges as well as every pre/post-playback frame.
  const playingFrames = frames.filter(frame => frame.timestamp > interval.start! + 32 && frame.timestamp < interval.end! - 32);
  const distinct = new Map<string, Buffer>();
  for (const frame of playingFrames) {
    const pixels = await sharp(Buffer.from(frame.data, 'base64')).extract({
      left: Math.floor(box!.x), top: Math.floor(box!.y), width: Math.floor(box!.width), height: Math.floor(box!.height),
    }).png().toBuffer();
    distinct.set(createHash('sha256').update(pixels).digest('hex'), pixels);
  }
  // A still plus its fallback could yield two appearances. Three or more
  // distinct mascot-only frames establish actual changing Blender playback.
  expect(distinct.size, `${label}: compositor samples must show changing animated frames`).toBeGreaterThanOrEqual(3);
  for (const [index, pixels] of [...distinct.values()].slice(0, 3).entries()) {
    await writeFile(testInfo.outputPath(`spark-real-animation-${label}-frame-${index + 1}.png`), pixels);
  }
}

test.beforeEach(() => assertDisposableFixture());

test('Spark image requests respect visibility, independent motion preference, reduced motion and initial completion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One fixture checks all preference combinations and review widths.');
  await signIn(page);
  const fixture = await journeyFixture(page);
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    const asset = url.pathname === '/_next/image' ? url.searchParams.get('url') ?? '' : url.pathname;
    if (asset.includes('forge-spark')) requests.push(asset);
  });
  for (const hidden of [false, true]) for (const motionOff of [false, true]) for (const reduced of [false, true]) {
    fixture.setComplete(false);
    await page.evaluate(({ hidden, motionOff }) => {
      localStorage.setItem('forge-journey-mascot-hidden', String(hidden));
      localStorage.setItem('forge-journey-motion-off', String(motionOff));
    }, { hidden, motionOff });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    requests.length = 0;
    await page.goto('/courses/journey');
    await expect(page.getByRole('link', { name: 'Lernschritt öffnen' })).toBeVisible();
    await expect(page.locator(clipSelector)).toHaveCount(0);
    fixture.setComplete(true);
    await refresh(page);
    await expect(page.getByRole('status')).toContainText('Alle aktuellen Kursinhalte bestätigt');
    if (!hidden && !motionOff && !reduced) {
      await expect(page.locator(clipSelector)).toHaveAttribute('data-spark-celebration', 'playing');
      expect(requests.filter(path => path === clipPath)).toHaveLength(1);
      await expect(page.locator(clipSelector)).toHaveCount(0);
    } else {
      await expect(page.locator(clipSelector)).toHaveCount(0);
      expect(requests).not.toContain(clipPath);
    }
    if (hidden) {
      await expect(page.locator('[data-journey-mascot]')).toHaveCount(0);
      expect(requests).toEqual([]);
    }
    await refresh(page);
    await expect(page.locator(clipSelector)).toHaveCount(0);
    // A fresh visit to an already complete course must also stay static.
    requests.length = 0;
    await page.reload();
    await expect(page.getByRole('button', { name: 'Stand aktualisieren' })).toBeVisible();
    await expect(page.locator(clipSelector)).toHaveCount(0);
    expect(requests).not.toContain(clipPath);
  }
  // Visibility survives a revisit without altering the independently saved motion choice.
  expect(await page.evaluate(() => localStorage.getItem('forge-journey-motion-off'))).toBe('true');
  await page.getByRole('button', { name: 'Maskottchen anzeigen' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Maskottchen anzeigen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Figurenanimationen aus' })).toBeDisabled();
  await screenshotWidths(page, testInfo, 'reduced-motion-static');
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.evaluate(() => { localStorage.setItem('theme', 'dark'); });
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Alle aktuellen Kursinhalte bestätigt');
  await screenshotWidths(page, testInfo, 'dark-static');
});

test('the real Blender clip waits for load, changes frames once, settles to static and tolerates failures', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop run captures real animated frames and failure timing.');
  await signIn(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const fixture = await journeyFixture(page);
  let release!: () => void;
  let fail = false;
  let failedRequests = 0;
  let delayed = true;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${clipPath}`, async route => {
    if (fail) { failedRequests++; return route.abort('failed'); }
    if (delayed) await pending;
    await route.continue();
  });
  await page.goto('/courses/journey');
  await expect(page.getByRole('link', { name: 'Lernschritt öffnen' })).toBeVisible();
  fixture.setComplete(true);
  await refresh(page);
  const clip = page.locator(clipSelector);
  await expect(clip).toHaveAttribute('data-spark-celebration', 'loading');
  await expect(page.locator('[data-journey-mascot] img').first()).toBeVisible();
  // Deliberately longer than playback: the window starts when the asset loads.
  await page.waitForTimeout(2200);
  await expect(clip).toHaveAttribute('data-spark-celebration', 'loading');
  // Next Image can normalize img.src to an absolute URL when attaching its
  // error handler. Compare the actual resource, independent of serialization.
  expect(new URL((await clip.getAttribute('src'))!, origin).href).toBe(`${origin}${clipPath}`);
  await expect(clip).not.toHaveAttribute('srcset', /.+/);
  await captureChangingFrames(page, testInfo, 'first-completion', () => { release(); delayed = false; });
  const mascot = page.locator('[data-journey-mascot]');
  await expect(page.getByRole('status')).toContainText('Alle aktuellen Kursinhalte bestätigt');
  await screenshotWidths(page, testInfo, 'completion-static');
  await refresh(page);
  await expect(clip).toHaveCount(0);

  // A later genuinely new observation can try again, but an image error leaves
  // the course status, controls and static final pose fully usable.
  fixture.setComplete(false);
  await refresh(page);
  fail = true;
  fixture.setComplete(true);
  await refresh(page);
  await expect.poll(() => failedRequests).toBe(1);
  await expect(clip).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Alle aktuellen Kursinhalte bestätigt');
  await expect(page.getByRole('link', { name: 'Kurs ansehen' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('spark-image-failure-static.png'), fullPage: true });

  fail = false;
  fixture.setComplete(false);
  await refresh(page);
  fixture.setComplete(true);
  await captureChangingFrames(page, testInfo, 'later-completion', () => refresh(page));
  fixture.setComplete(false);
  await refresh(page);
  fixture.setComplete(true);
  await refresh(page);
  await expect(clip).toHaveAttribute('data-spark-celebration', 'playing');
  const motion = page.getByRole('button', { name: 'Figurenanimationen an' });
  await motion.focus();
  await page.keyboard.press('Enter');
  await expect(clip).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(clip).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Alle aktuellen Kursinhalte bestätigt');
  await page.getByRole('button', { name: 'Maskottchen anzeigen' }).focus();
  await page.keyboard.press('Enter');
  await expect(mascot).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('spark-hidden-completion.png'), fullPage: true });
});
