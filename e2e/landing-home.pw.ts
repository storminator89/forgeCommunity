import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const destinations = [
  ['Community', '/community'], ['Kurse', '/courses'], ['Wissensdatenbank', '/knowledgebase'],
  ['Projekte', '/showcases'], ['Mitglieder', '/members'], ['Events', '/events'],
];
let memberState: Awaited<ReturnType<BrowserContext['storageState']>>;
let email: string;
let password: string;

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
      await page.goto('/');
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
      await expect(page.getByRole('img', { name: 'Aus Lernen wird gemeinsames Machen' })).toBeVisible();
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
  const art = page.getByRole('img', { name: 'Aus Lernen wird gemeinsames Machen' });
  const running = () => art.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length);
  expect(await running()).toBe(0);
  await art.evaluate(element => {
    element.addEventListener('animationstart', () => { element.setAttribute('data-motion-started', 'true'); });
  });
  const replay = page.getByRole('button', { name: 'Illustration bewegen', exact: true });
  await replay.focus();
  await page.keyboard.press('Enter');
  await expect(art).toHaveAttribute('data-motion-started', 'true');
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
