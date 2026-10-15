import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

test('quick search restores keyboard focus after Escape, visible close, and reopening', async ({ page, request }, testInfo) => {
  test.skip(!process.env.CI, 'Run this browser acceptance only in the supported disposable CI browser job.');
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db') {
    throw new Error('Quick-search QA requires its disposable SQLite fixture database.');
  }
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(origin).hostname);
  const id = randomUUID();
  const email = `quick-search-${id}@example.test`;
  const password = `QuickSearchA1!${id}`;
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Quick Search Fixture', email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  // About is an authenticated page. A fresh navigation gives the focus-order
  // assertion the same starting point as a keyboard user opening the page.
  await page.goto('/about');
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Gemeinsam lernen und Ideen weiterbringen.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Benutzermenü öffnen' })).toContainText('QS');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();

  const mobile = testInfo.project.name.startsWith('mobile-');
  const menu = page.getByRole('button', { name: 'Navigation öffnen' });
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
  if (mobile) {
    await page.keyboard.press('Tab');
    await expect(menu).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Navigation schließen' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(drawer.getByRole('link', { name: 'ForgeCommunity Start' })).toBeFocused();
  } else {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'ForgeCommunity Start' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Navigation einklappen' })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  const opener = mobile
    ? drawer.getByRole('button', { name: 'Schnellsuche öffnen' })
    : page.getByRole('button', { name: 'Schnellsuche öffnen' });
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  const search = page.getByRole('dialog', { name: 'Schnell zum Ziel', exact: true });
  const input = search.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' });
  const close = search.getByRole('button', { name: 'Schließen', exact: true });
  await expect(search).toBeVisible();
  await expect(input).toBeFocused();
  // Both ends of the focus trap remain keyboard reachable.
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
  await expect(opener).toBeFocused();
  if (mobile) await expect(drawer).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toBeHidden();
  await expect(opener).toBeFocused();
  if (mobile) {
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
  }

  // The global shortcut also works while the desktop rail is hidden. Closing
  // it must restore the actual previous focus, rather than that hidden rail.
  const previous = mobile ? menu : opener;
  await expect(previous).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search).toBeHidden();
  await expect(previous).toBeFocused();
});
