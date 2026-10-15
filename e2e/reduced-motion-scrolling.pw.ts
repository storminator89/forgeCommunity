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
  const main = page.locator('main#page-content');
  await main.evaluate(element => {
    // Preserve the native scroll and record its immediate result. This catches
    // explicit smooth calls even if a browser suppresses animation itself.
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = (options: ScrollToOptions | number = {}, y?: number) => {
      if (typeof options === 'number') scrollTo(options, y ?? 0);
      else {
        scrollTo(options);
        element.dataset.requestedScrollBehavior = options.behavior;
        element.dataset.immediateScrollTop = String(element.scrollTop);
      }
    };
  });

  for (const reducedMotion of ['reduce', 'no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await main.evaluate(element => { element.scrollTop = 600; });
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(400);
    await page.getByRole('button', { name: 'Nach oben' }).click();
    await expect(main).toHaveAttribute('data-requested-scroll-behavior', reducedMotion === 'reduce' ? 'instant' : 'smooth');
    if (reducedMotion === 'reduce') await expect(main).toHaveAttribute('data-immediate-scroll-top', '0');
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(0);
  }
});
