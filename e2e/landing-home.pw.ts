import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import { expect, test, type BrowserContext, type Page, type Response, type TestInfo } from '@playwright/test';

import { fixedArtworkDelivery } from './landing-artwork-contract';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const destinations = [
  ['Community', '/community'], ['Kurse', '/courses'], ['Wissensdatenbank', '/knowledgebase'],
  ['Projekte', '/showcases'], ['Mitglieder', '/members'], ['Events', '/events'],
];
let memberState: Awaited<ReturnType<BrowserContext['storageState']>>;
let email: string;
let password: string;

const artworkName = 'Illustration: Zwei Erwachsene teilen einen goldenen Ideenfunken über einem offenen Buch, umgeben von farbigen Bausteinen.';
const artworkPath = /^\/images\/home\/forge-workbench-(480|768|1440)\.webp$/;
const fixedArtworkPath = fixedArtworkDelivery.path;

function observeArtwork(page: Page) {
  const requests: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'image' && artworkPath.test(new URL(request.url()).pathname)) requests.push(request.url());
  });
  const response = page.waitForResponse(response => artworkPath.test(new URL(response.url()).pathname) && response.request().resourceType() === 'image');
  return { requests, response };
}

async function expectArtwork(page: Page, delivery: { requests: string[]; response: Promise<Response> }, testInfo: TestInfo, expectedDpr: number) {
  const image = page.getByRole('img', { name: artworkName, exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  })).toBe(true);
  await image.evaluate(element => (element as HTMLImageElement).decode());
  const state = await image.evaluate(element => {
    const image = element as HTMLImageElement;
    const rect = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    const picture = image.closest('picture');
    const frame = image.closest<HTMLElement>('[data-motion="forge-workbench"]')!;
    const frameStyle = getComputedStyle(frame);
    const frameContentWidth = frame.getBoundingClientRect().width -
      parseFloat(frameStyle.paddingLeft) - parseFloat(frameStyle.paddingRight) -
      parseFloat(frameStyle.borderLeftWidth) - parseFloat(frameStyle.borderRightWidth);
    return {
      viewport: {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth,
        screenWidth: screen.width,
        meta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
        metaHeadIndex: Array.from(document.head.children).indexOf(document.querySelector('meta[name="viewport"]')!),
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        visual: window.visualViewport ? { width: window.visualViewport.width, height: window.visualViewport.height, scale: window.visualViewport.scale } : null,
      },
      heroPreloads: Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'))
        .filter(link => `${link.href} ${link.imageSrcset}`.includes('/images/home/forge-workbench-'))
        .map(link => ({ headIndex: Array.from(document.head.children).indexOf(link), href: link.getAttribute('href'), srcSet: link.imageSrcset, sizes: link.imageSizes, fetchPriority: link.fetchPriority })),
      dpr: window.devicePixelRatio,
      slot: { width: rect.width, height: rect.height, x: rect.x, y: rect.y },
      computed: { width: style.width, height: style.height, fit: style.objectFit },
      sizes: image.sizes, srcSet: image.srcset, frameContentWidth,
      picture: picture ? { sourceCount: picture.querySelectorAll('source').length } : null,
      imageAttributes: { src: image.getAttribute('src'), srcSet: image.getAttribute('srcset'), sizes: image.getAttribute('sizes') },
      resourceTimings: performance.getEntriesByType('resource')
        .filter(entry => /^\/images\/home\/forge-workbench-(480|768|1440)\.webp$/.test(new URL(entry.name).pathname))
        .map(entry => {
          const resource = entry as PerformanceResourceTiming;
          return { url: resource.name, initiatorType: resource.initiatorType, startTime: resource.startTime, fetchStart: resource.fetchStart, responseStart: resource.responseStart, responseEnd: resource.responseEnd, transferSize: resource.transferSize, encodedBodySize: resource.encodedBodySize, decodedBodySize: resource.decodedBodySize, deliveryType: (resource as PerformanceResourceTiming & { deliveryType?: string }).deliveryType ?? null };
        }),
      currentSrc: image.currentSrc,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
    };
  });
  const selectedUrl = new URL(state.currentSrc);
  const fixedUrl = new URL(fixedArtworkPath, origin).href;
  const demand = state.slot.width * state.dpr;
  const response = await delivery.response;
  const bytes = await response.body();
  const evidencePath = testInfo.outputPath('home-artwork-delivery.json');
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({
      configuredViewport: page.viewportSize(), expectedDpr, ...state,
      fixedSource: { ...fixedArtworkDelivery, renderedPixelDemand: demand, deliveredToDemandRatio: fixedArtworkDelivery.width / demand, sourceLimited: demand > fixedArtworkDelivery.width },
      policy: 'One fixed existing 1440px WebP, exactly 93,712 bytes below 100KiB, responsive through CSS only. Intentionally costs 76,550 more bytes than 480px and 58,756 more than 768px on mobile to remove candidate changes. This is a bounded robustness tradeoff, not optimal per-device delivery or proof of paint. visualViewport.scale is recorded separately, not multiplied into DPR demand or treated as a cause.',
      delivery: { requests: delivery.requests, requestCount: delivery.requests.length, status: response.status(), contentType: response.headers()['content-type'], cacheControl: response.headers()['cache-control'], fromServiceWorker: response.fromServiceWorker(), requestTiming: response.request().timing(), bytes: bytes.length, maximumBytes: fixedArtworkDelivery.maximumBytes },
  }, null, 2));
  await testInfo.attach('home-artwork-delivery.json', { path: evidencePath, contentType: 'application/json' });
  await expect(image).toHaveAttribute('width', '1440');
  await expect(image).toHaveAttribute('height', '960');
  await expect(image).toHaveAttribute('loading', 'eager');
  await expect(image).toHaveAttribute('fetchpriority', 'high');
  await expect(image).toHaveAttribute('decoding', 'async');
  expect(state.dpr).toBe(expectedDpr);
  expect(state.heroPreloads).toEqual([]);
  expect(state.picture).toEqual({ sourceCount: 0 });
  expect(state.imageAttributes.src).not.toBeNull();
  const fallbackUrl = new URL(state.imageAttributes.src!, origin);
  expect(fallbackUrl.origin).toBe(new URL(origin).origin);
  expect(fallbackUrl.pathname).toBe(fixedArtworkPath);
  expect(fallbackUrl.search).toBe('');
  expect(fallbackUrl.hash).toBe('');
  expect(state.imageAttributes.srcSet).toBeNull();
  expect(state.imageAttributes.sizes).toBeNull();
  expect(state.srcSet).toBe('');
  expect(state.sizes).toBe('');
  expect(state.currentSrc).toBe(fixedUrl);
  expect(Math.abs(state.frameContentWidth - state.slot.width)).toBeLessThanOrEqual(1);
  expect(selectedUrl.origin).toBe(new URL(origin).origin);
  expect(selectedUrl.search).toBe('');
  expect(selectedUrl.hash).toBe('');
  expect(selectedUrl.pathname).toBe(fixedArtworkPath);
  expect(state.naturalWidth).toBe(fixedArtworkDelivery.width);
  expect(state.naturalHeight).toBe(fixedArtworkDelivery.height);
  expect(state.slot.width / state.slot.height).toBeCloseTo(3 / 2, 2);
  expect(state.naturalWidth / state.naturalHeight).toBeCloseTo(3 / 2, 2);
  expect(state.computed.fit).not.toBe('cover');
  expect(response.url()).toBe(state.currentSrc);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^image\/webp(?:;|$)/);
  expect(bytes.length).toBe(fixedArtworkDelivery.bytes);
  expect(bytes.length).toBeLessThanOrEqual(fixedArtworkDelivery.maximumBytes);
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
  expect(delivery.requests).toEqual([state.currentSrc]);
  expect(state.resourceTimings).toHaveLength(1);
  expect(state.resourceTimings[0]).toMatchObject({ url: fixedUrl, initiatorType: 'img', encodedBodySize: fixedArtworkDelivery.bytes });
}

function requireDisposableFixture() {
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db') {
    throw new Error('Landing QA requires the loopback server and explicitly disposable SQLite fixture database.');
  }
}

async function login(page: Page) {
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
}

async function expectFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const targets = page.locator('header a, header button, main a, main button, footer a');
  for (const target of await targets.all()) {
    if (!await target.isVisible()) continue;
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(box!.height).toBeGreaterThanOrEqual(43);
  }
}

test.beforeAll(async ({ browser, request }) => {
  requireDisposableFixture();
  const id = randomUUID();
  email = `landing-home-${id}@example.test`;
  password = `LandingHomeA1!${id}`;
  // Real authentication, never an intercepted client-side session response.
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Landing QA member', email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await login(page);
    await expect(page).toHaveURL(/\/community$/);
    memberState = await context.storageState();
    expect(memberState.cookies.length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

// Every existing Chromium project runs these: desktop, real320 and390 viewports.
// Screenshots remain CI artifacts, not a claim of local visual verification.
for (const persona of ['guest', 'member'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${persona} home in ${theme}: entry, destinations, focus and 200% text`, async ({ page }, testInfo) => {
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      if (persona === 'member') await page.context().addCookies(memberState.cookies);
      const delivery = observeArtwork(page);
      await page.goto('/');
      await expectArtwork(page, delivery, testInfo, 1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lernen.Machen.Weitergeben.');
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      const primary = page.getByRole('link', { name: persona === 'member' ? 'Zur Community' : 'Konto erstellen', exact: true });
      await expect(primary).toHaveAttribute('href', persona === 'member' ? '/community' : '/register');
      const header = page.getByRole('banner');
      await expect(header.getByRole('link', { name: persona === 'member' ? 'Community' : 'Anmelden', exact: true })).toHaveAttribute('href', persona === 'member' ? '/community' : '/login');
      const areas = page.getByRole('navigation', { name: 'Bereiche', exact: true });
      await expect(areas.getByRole('link')).toHaveCount(6);
      for (const [name, href] of destinations) {
        await expect(areas.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', persona === 'member' ? href : `/login?callbackUrl=${encodeURIComponent(href)}`);
      }
      await expect(page.getByRole('img', { name: artworkName, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Illustration bewegen (reduzierte Bewegung aktiv)' })).toBeDisabled();
      await expectFits(page);
      await page.screenshot({ path: testInfo.outputPath(`landing-home-${persona}-${theme}.png`), fullPage: true });

      await primary.focus();
      await expect(primary).toBeFocused();
      expect(await primary.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(3);
      await page.screenshot({ path: testInfo.outputPath(`landing-home-${persona}-${theme}-focus.png`), fullPage: true });
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await expectFits(page);
      await page.screenshot({ path: testInfo.outputPath(`landing-home-${persona}-${theme}-large-text.png`), fullPage: true });
      // Real activation still works after text enlargement and layout reflow.
      await primary.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(persona === 'member' ? /\/community$/ : /\/register$/);
    });
  }
}

test('guest area login preserves its callback and about remains publicly reachable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Bereiche', exact: true }).getByRole('link', { name: /^Kurse/ }).click();
  await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('callbackUrl') === '/courses');
  await login(page);
  await expect(page).toHaveURL(/\/courses$/);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Zur Community', exact: true })).toBeVisible();
  await page.getByRole('contentinfo').getByRole('link', { name: 'Über uns', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { name: 'Hinter ForgeCommunity', exact: true })).toBeVisible();
});

test('illustration motion is keyboard-requested, finite and cancelled by a live reduced-motion change', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const frame = page.locator('[data-motion="forge-workbench"]');
  const workbench = frame.locator('..');
  const running = () => frame.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length);
  expect(await running()).toBe(0);
  await workbench.evaluate(element => {
    element.addEventListener('animationstart', () => { element.setAttribute('data-motion-started', 'true'); });
  });
  const replay = page.getByRole('button', { name: 'Illustration bewegen', exact: true });
  await replay.focus();
  await page.keyboard.press('Enter');
  await expect(workbench).toHaveAttribute('data-motion-started', 'true');
  await expect.poll(running).toBe(0);
  await expect(replay).toBeFocused();
  // Start another play, then change the OS preference while it is active.
  await page.keyboard.press('Space');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Illustration bewegen (reduzierte Bewegung aktiv)' })).toBeDisabled();
  await expect.poll(running).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(replay).toBeEnabled();
  expect(await running()).toBe(0);
});

test('home artwork decodes the one fixed bounded source at real 2x device density', async ({ browser, page }, testInfo) => {
  const viewport = page.viewportSize()!;
  const context = await browser.newContext({ baseURL: origin, viewport, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  try {
    const densePage = await context.newPage();
    const delivery = observeArtwork(densePage);
    await densePage.goto('/');
    await expectArtwork(densePage, delivery, testInfo, 2);
    await expectFits(densePage);
    await expect(densePage.getByRole('link', { name: 'Konto erstellen', exact: true })).toHaveAttribute('href', '/register');
  } finally {
    await context.close();
  }
});
