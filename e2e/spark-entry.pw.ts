import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { inspectSparkHeroCapture, observeSparkHeroCapture, observeSparkHeroRequests, sparkHeroCaptureIdentity } from './spark-hero-capture-evidence';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const preferenceKey = 'forge-journey-mascot-hidden';
const preview = '[data-spark-entry-figure] img';
const approvedHeroArtwork = readFileSync('public/images/home/forge-workbench-1440.webp');
const heroRequests = new WeakMap<Page, ReturnType<typeof observeSparkHeroRequests>>();
const sizes = [
  { width: 1280, height: 800 }, { width: 320, height: 700 },
  { width: 375, height: 812 }, { width: 414, height: 896 }, { width: 768, height: 900 },
];

async function signIn(page: Page, freshRegistration = false) {
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Spark entry QA requires the explicitly disposable local SQLite fixture.');
  }
  const nonce = randomUUID();
  const email = `spark-entry-${nonce}@example.test`;
  const password = `SparkEntryQaA1!${nonce}`;
  if (freshRegistration) {
    // The actual UI receipt opens the first-action guide. API-created accounts
    // deliberately have no browser receipt and represent an existing member.
    await page.goto('/register');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Spark Entry QA Member');
    await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByLabel('Passwort bestätigen', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Konto erstellen' }).click();
    await expect(page).toHaveURL(/\/community$/);
    return;
  }
  const registered = await page.request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Spark Entry QA Member', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  const main = page.locator('#page-content');
  const overflow = await main.evaluate(element => element.scrollWidth - element.clientWidth);
  if (overflow > 1) {
    // Only report geometry on failure. Never include account/post text, URLs,
    // arbitrary IDs, attributes or screenshots changed for diagnostic purposes.
    const geometry = await main.evaluate(root => {
      const boundary = root.getBoundingClientRect();
      const knownSections = new Map([
        ['community-feed-title', 'Aktuelle Beiträge'], ['community-stats-title', 'Deine Aktivität'],
        ['contribution-milestones-title', 'Meine Diskussionsmeilensteine'], ['community-leaderboard-title', 'Rangliste'],
      ]);
      const knownLabels = new Set(['Beiträge', 'Likes', 'Kommentare', 'Meine Punkte', 'Mindestens einmal abgeschlossene Kurse', 'Meilenstein: Erster abgeschlossener Kurs']);
      const round = (value: number) => Math.round(value * 100) / 100;
      const path = (element: Element) => {
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current !== root && parts.length < 6) {
          const tag = current.tagName.toLowerCase();
          const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(sibling => sibling.tagName === current!.tagName) : [];
          parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
          current = current.parentElement;
        }
        return parts.join(' > ');
      };
      const describe = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const section = element.closest('section[aria-labelledby]')?.getAttribute('aria-labelledby') ?? '';
        return {
          path: path(element), section: knownSections.get(section) ?? null,
          left: round(rect.left), right: round(rect.right), width: round(rect.width),
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          display: style.display, minWidth: style.minWidth, maxWidth: style.maxWidth,
          whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap,
          overflowX: style.overflowX, overflowY: style.overflowY, position: style.position,
          gridTemplateColumns: style.gridTemplateColumns, columnGap: style.columnGap,
          flexBasis: style.flexBasis, flexShrink: style.flexShrink, flexWrap: style.flexWrap, fontSize: style.fontSize,
        };
      };
      const offenders = Array.from(root.querySelectorAll('*')).flatMap(element => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return [];
        const textRects = Array.from(element.childNodes).flatMap(node => {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return [];
          const range = document.createRange();
          range.selectNodeContents(node);
          return Array.from(range.getClientRects());
        });
        let right = Math.max(rect.right, ...textRects.map(rect => rect.right));
        let left = Math.min(rect.left, ...textRects.map(rect => rect.left));
        // A card's intentionally clipped descendants do not create main's
        // scroll extent. Keep them out of the bounded offender list.
        for (let ancestor: Element | null = element; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
          if (getComputedStyle(ancestor).overflowX !== 'visible') {
            const clip = ancestor.getBoundingClientRect();
            right = Math.min(right, clip.right);
            left = Math.max(left, clip.left);
          }
        }
        if (right <= boundary.right + 1 && left >= boundary.left - 1) return [];
        const label = element.textContent?.trim() ?? '';
        return [{
          ...describe(element), textRight: round(right), textLeft: round(left),
          knownLabel: knownLabels.has(label) ? label : null,
          ancestors: [element.parentElement, element.parentElement?.parentElement].filter((ancestor): ancestor is HTMLElement => !!ancestor && ancestor !== root).map(describe),
        }];
      }).sort((a, b) => b.textRight - a.textRight).slice(0, 24);
      return { viewportWidth: innerWidth, rootFontSize: getComputedStyle(document.documentElement).fontSize, main: describe(root), offenders };
    });
    console.info(`[spark-entry-overflow:${name}] ${JSON.stringify(geometry)}`);
  }
  expect(overflow).toBeLessThanOrEqual(1);
  const hero = main.locator('[data-motion="forge-workbench"] img');
  if (new URL(page.url()).pathname === '/') await expect(hero).toHaveCount(1);
  if (!await hero.count()) {
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
    return;
  }
  await expect(hero).toHaveCount(1);
  await expect(hero).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  let observation = await hero.evaluate(observeSparkHeroCapture, false);
  let immediateAfter: typeof observation | null = null;
  let after: typeof observation | null = null;
  let pixels: Awaited<ReturnType<typeof inspectSparkHeroCapture>> | null = null;
  const network = heroRequests.get(page);
  expect(network, 'Passive Hero request observation must start before navigation.').toBeDefined();
  const captureWindow: { startedAtMs: number | null; finishedAtMs: number | null } = { startedAtMs: null, finishedAtMs: null };
  try {
    await expect.poll(async () => {
      observation = await hero.evaluate(observeSparkHeroCapture, true);
      return observation.ready;
    }, { timeout: 20_000, message: 'Hero currentSrc, decode and geometry must settle across rendering frames.' }).toBe(true);
    expect(observation.state.viewport).toMatchObject(page.viewportSize()!);
    // Exactly one original full-page capture. A blank result is a hard failure;
    // never recapture until a preferable frame appears or alter the saved PNG.
    captureWindow.startedAtMs = network!.mark('capture');
    const png = await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
    captureWindow.finishedAtMs = network!.mark('post-capture');
    immediateAfter = await hero.evaluate(observeSparkHeroCapture, false);
    pixels = await inspectSparkHeroCapture(png, observation.state.rect, observation.state.viewport.dpr, observation.state.viewport.width, approvedHeroArtwork);
    expect(sparkHeroCaptureIdentity(observation, immediateAfter), 'Hero geometry and the approved family must also hold immediately after capture.').toMatchObject({
      approvedCompositionFamily: true, unchangedRenderedState: true,
    });
    await expect.poll(async () => {
      after = await hero.evaluate(observeSparkHeroCapture, true);
      return after.ready;
    }, { timeout: 20_000, message: 'Hero must independently decode and settle after the original capture.' }).toBe(true);
    expect(sparkHeroCaptureIdentity(observation, after!), 'Both decoded Hero observations must preserve document geometry and the approved composition family.').toEqual({
      decodedAndStable: true, approvedCompositionFamily: true, unchangedRenderedState: true,
    });
    expect(pixels.nonblank, 'The unchanged full-page PNG must contain visible Hero artwork, not an empty frame.').toBe(true);
    expect(pixels.composition.matches, 'The unchanged PNG interior must preserve the approved artwork composition.').toBe(true);
  } finally {
    // A source change is not evidence of a request. Likewise transferSize=0
    // alone does not establish cache reuse; report observed events and timings.
    console.info(`[spark-hero-capture:${name}] ${JSON.stringify({ before: observation, immediateAfter, after, pixels,
      network: network!.snapshot(), captureWindow })}`);
    network!.mark('outside-capture');
  }
}

async function assertStaticFigure(page: Page) {
  const image = page.locator(preview);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  // Next may emit either an absolute or relative local URL. Check both the
  // declared source and the resource actually selected by the browser.
  const sources = await image.evaluate(element => {
    const image = element as HTMLImageElement;
    return [image.getAttribute('src'), image.currentSrc];
  });
  for (const source of sources) {
    expect(source).toBeTruthy();
    const resource = new URL(source!, origin);
    expect(resource.origin).toBe(new URL(origin).origin);
    expect(resource.pathname).toBe('/images/forge-spark-preview.webp');
    expect(resource.search).toBe('');
    expect(resource.hash).toBe('');
  }
  await expect(image).toHaveAttribute('alt', '');
  const box = await image.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(64);
  expect(box!.height).toBeLessThanOrEqual(64);
  await expect(page.locator('[data-spark-celebration]')).toHaveCount(0);
}

async function setTheme(page: Page, value: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: value, reducedMotion: 'reduce' });
  await page.evaluate(value => localStorage.setItem('theme', value), value);
}

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'Dedicated Spark entry coverage checks five viewports itself.');
});

test.beforeEach(async ({ page, context }) => {
  const observe = (target: Page) => {
    if (!heroRequests.has(target)) heroRequests.set(target, observeSparkHeroRequests(target, origin));
  };
  observe(page);
  context.on('page', observe);
});

test('fresh public entry shows real static Spark after the primary actions in both themes', async ({ page }, info) => {
  await page.goto('/');
  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.reload();
      await assertStaticFigure(page);
      await expect(page.locator(preview)).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Spark ausblenden' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('link', { name: 'Konto erstellen' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('banner').locator('[data-spark-entry]')).toHaveCount(0);
      await capture(page, info, `spark-public-default-${mode}-${size.width}`);
    }
  }
});

test('fresh real member and successful zero-enrollment Journey show static Spark with usable actions', async ({ page }, info) => {
  await signIn(page, true);
  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.goto('/community');
      await assertStaticFigure(page);
      await expect(page.locator(preview)).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Spark ausblenden' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('heading', { name: 'Dein Einstieg' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeVisible();
      await capture(page, info, `spark-member-default-${mode}-${size.width}`);

      const courses = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses');
      await page.goto('/courses/journey');
      const response = await courses;
      expect(response.status()).toBe(200);
      const rows: Array<{ isEnrolled?: boolean; canDelete?: boolean }> = await response.json();
      expect(rows.filter(row => row.isEnrolled && !row.canDelete)).toHaveLength(0);
      await expect(page.getByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' })).toBeVisible();
      await assertStaticFigure(page);
      await expect(page.locator(preview)).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('link', { name: 'Kurse entdecken', exact: true })).toBeInViewport({ ratio: 1 });
      await capture(page, info, `spark-actual-zero-enrollment-${mode}-${size.width}`);
    }
  }
});

test('saved Off survives reload and public/member/Journey navigation without a preview request or flash', async ({ page }, info) => {
  await page.goto('/');
  await assertStaticFigure(page);
  await page.getByRole('button', { name: 'Spark ausblenden' }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe('true');
  await page.addInitScript(() => {
    const observation = { seen: false };
    new MutationObserver(() => {
      if (document.querySelector('[data-spark-entry-figure] img')) observation.seen = true;
    }).observe(document, { childList: true, subtree: true });
    (window as typeof window & { __sparkEntryObservation?: typeof observation }).__sparkEntryObservation = observation;
  });
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('forge-spark-preview.webp')) requests.push(request.url()); });
  const assertNoFlash = async () => expect(await page.evaluate(() =>
    (window as typeof window & { __sparkEntryObservation?: { seen: boolean } }).__sparkEntryObservation?.seen)).toBe(false);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Spark anzeigen' })).toBeVisible();
  await assertNoFlash();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Spark anzeigen' })).toBeVisible();
  await assertNoFlash();
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Spark anzeigen' })).toBeVisible();
  await assertNoFlash();
  await page.goto('/courses/journey');
  await expect(page.getByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Maskottchen anzeigen' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator(preview)).toHaveCount(0);
  await assertNoFlash();
  expect(requests).toEqual([]);
  await capture(page, info, 'spark-saved-off-actual-zero-enrollment');
});

test('native keyboard Hide and Show retain focus and synchronize a second tab', async ({ page, context }, info) => {
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await page.getByRole('button', { name: 'Spark ausblenden' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Spark anzeigen' })).toBeFocused();
  await expect(other.getByRole('button', { name: 'Spark anzeigen' })).toBeVisible();
  await expect(other.locator(preview)).toHaveCount(0);
  await capture(page, info, 'spark-keyboard-hidden');
  await other.getByRole('button', { name: 'Spark anzeigen' }).focus();
  await other.keyboard.press('Space');
  await expect(other.getByRole('button', { name: 'Spark ausblenden' })).toBeFocused();
  await assertStaticFigure(page);
  await page.reload();
  await assertStaticFigure(page);
  await capture(other, info, 'spark-keyboard-shown');
});

test('denied preference writes keep Hide working through same-document app navigation', async ({ page }, info) => {
  await page.addInitScript(key => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) throw new DOMException('Synthetic denied preference write', 'SecurityError');
      return write.call(this, name, value);
    };
  }, preferenceKey);
  await signIn(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Spark ausblenden' }).click();
  await expect(page.locator(preview)).toHaveCount(0);
  await page.getByRole('link', { name: 'Zur Community', exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole('button', { name: 'Spark anzeigen' })).toBeVisible();
  await expect(page.locator(preview)).toHaveCount(0);
  await page.getByRole('button', { name: 'Spark anzeigen' }).click();
  await assertStaticFigure(page);
  await capture(page, info, 'spark-storage-denied-member');
});

test('public and member Spark controls reflow at 200% text and remain keyboard usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  for (const state of ['public', 'member'] as const) {
    if (state === 'member') await signIn(page);
    for (const mode of ['light', 'dark'] as const) {
      await setTheme(page, mode);
      await page.goto(state === 'public' ? '/' : '/community');
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      const completedCourses = page.locator('dt').filter({ hasText: /^Mindestens einmal abgeschlossene Kurse$/ });
      if (state === 'member') await expect(completedCourses).toBeVisible();
      await assertStaticFigure(page);
      const hide = page.getByRole('button', { name: 'Spark ausblenden' });
      await hide.focus();
      await expect(hide).toBeFocused();
      const box = (await hide.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      await capture(page, info, `spark-${state}-200-percent-${mode}`);
      if (state === 'member') {
        // Wait for the actual loaded reward label before the main gate above,
        // then bring this exact dt/dd pair into the real internal scrollport.
        const metric = completedCourses.locator('..');
        await metric.scrollIntoViewIfNeeded();
        await expect(completedCourses).toBeInViewport({ ratio: 1 });
        await expect(metric.locator('dd')).toBeInViewport({ ratio: 1 });
        await expect(completedCourses).toHaveCSS('overflow-wrap', 'anywhere');
        const geometry = await metric.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const label = element.querySelector('dt')!;
          return { left: rect.left, right: rect.right, overflow: element.scrollWidth - element.clientWidth,
            labelOverflow: label.scrollWidth - label.clientWidth };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(320);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(geometry.labelOverflow).toBeLessThanOrEqual(1);
        await capture(page, info, `spark-member-stats-200-percent-${mode}`);
        await hide.focus();
      }
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Spark anzeigen' })).toBeFocused();
      await expect(page.locator(preview)).toHaveCount(0);
      await page.keyboard.press('Space');
      await expect(page.getByRole('button', { name: 'Spark ausblenden' })).toBeFocused();
      await assertStaticFigure(page);
    }
  }
});

test('reduced motion keeps Spark static at 200% text and a failed image leaves the actual Journey action usable', async ({ page }, info) => {
  await signIn(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('forge-journey-motion-off', 'true'));
  const clips: string[] = [];
  page.on('request', request => { if (request.url().includes('forge-spark-celebrate-once.webp')) clips.push(request.url()); });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/courses/journey');
  await expect(page.getByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await assertStaticFigure(page);
  await expect(page.getByRole('button', { name: 'Figurenanimationen aus' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Kurse entdecken', exact: true })).toBeVisible();
  await capture(page, info, 'spark-zero-enrollment-reduced-200-percent');
  await page.route('**/images/forge-spark-preview.webp', route => route.abort());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' })).toBeVisible();
  await expect(page.locator(preview)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Kurse entdecken', exact: true })).toBeVisible();
  expect(clips).toEqual([]);
  await capture(page, info, 'spark-failed-image-actual-zero-enrollment');
});
