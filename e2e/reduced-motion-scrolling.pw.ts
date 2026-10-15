import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

test('back-to-top honors reduced motion and live preference changes', async ({ page, request }) => {
  const browserOrigin = new URL(origin);
  if (browserOrigin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname)) {
    throw new Error('Reduced-motion QA requires a loopback browser origin.');
  }
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db') {
    throw new Error('Reduced-motion QA requires its disposable SQLite fixture database.');
  }
  // Observe the native call on every page load. The signed-in providers may
  // replace their children when the session hydrates, so wrapping one main
  // element after navigation can silently lose the instrumentation.
  await page.addInitScript(() => {
    const nativeScrollTo = Element.prototype.scrollTo;
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: function (this: Element, options: ScrollToOptions | number, y?: number) {
        if (typeof options === 'number') Reflect.apply(nativeScrollTo, this, [options, y ?? 0]);
        else Reflect.apply(nativeScrollTo, this, [options]);
        if (this instanceof HTMLElement && this.matches('main#page-content') && options && typeof options === 'object') {
          this.dataset.requestedScrollBehavior = options.behavior;
          this.dataset.immediateScrollTop = String(this.scrollTop);
        }
      },
    });
  });
  const id = randomUUID();
  const email = `reduced-motion-${id}@example.test`;
  const password = `ReducedMotionA1!${id}`;
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Reduced Motion Fixture', email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  await page.route('**/api/members', route => route.fulfill({ json: Array.from({ length: 30 }, (_, index) => ({
    id: `motion-fixture-${index}`, name: `Fixture ${index}`, image: null, role: 'USER', title: null,
    createdAt: '2026-01-01T00:00:00Z', followers: 0, skills: [],
  })) }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  await page.goto('/members');
  await expect(page.getByRole('link', { name: /^Profil von Fixture/ })).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'Benutzermenü öffnen' })).toContainText('RM');
  const main = page.locator('main#page-content');

  for (const reducedMotion of ['reduce', 'no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await main.evaluate(element => {
      delete element.dataset.requestedScrollBehavior;
      delete element.dataset.immediateScrollTop;
      element.scrollTop = 600;
    });
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(400);
    const backToTop = page.getByRole('button', { name: 'Nach oben' });
    await expect(backToTop).toBeVisible();
    // On a 320px touch viewport Playwright's pointer action can itself scroll
    // the fixed target into view before dispatching a click. Keyboard
    // activation exercises the real handler without that unrelated scroll.
    await backToTop.evaluate(element => element.focus({ preventScroll: true }));
    await expect(backToTop).toBeFocused();
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(400);
    await page.keyboard.press('Enter');
    await expect(main).toHaveAttribute('data-requested-scroll-behavior', reducedMotion === 'reduce' ? 'instant' : 'smooth');
    if (reducedMotion === 'reduce') await expect(main).toHaveAttribute('data-immediate-scroll-top', '0');
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(0);
  }
});
