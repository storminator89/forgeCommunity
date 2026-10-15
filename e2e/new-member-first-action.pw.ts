import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

async function registerThroughUi(page: Page, email: string, password: string) {
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('New member fixture');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort bestätigen', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole('heading', { name: 'Dein Einstieg', exact: true })).toBeVisible();
}

async function logout(page: Page) {
  await page.goto('/logout');
  await expect(page).toHaveURL(/\/$/);
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeVisible();
}

test('new-member guide skips, reopens and stays isolated across accounts in this browser', async ({ page, request }) => {
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db') {
    throw new Error('First-action QA requires its disposable SQLite fixture database.');
  }
  const id = randomUUID();
  const password = `FirstActionA1!${id}`;
  const firstEmail = `first-action-${id}@example.test`;
  const existingEmail = `existing-member-${id}@example.test`;
  const anotherEmail = `another-new-${id}@example.test`;
  // A direct API fixture has no UI receipt in the page's browser storage.
  const existing = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Existing member fixture', email: existingEmail, password },
  });
  expect(existing.status(), await existing.text()).toBe(201);

  await registerThroughUi(page, firstEmail, password);
  await expect(page.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeVisible();
  const readLink = page.getByRole('link', { name: 'Beiträge lesen', exact: true });
  await readLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Aktuelle Beiträge', exact: true })).toBeFocused();
  const skip = page.getByRole('button', { name: 'Überspringen', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  const reopen = page.getByRole('button', { name: 'Einstieg anzeigen', exact: true });
  await expect(reopen).toBeFocused();
  await page.reload();
  await expect(reopen).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dein Einstieg', exact: true })).toHaveCount(0);
  await reopen.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Dein Einstieg', exact: true })).toBeFocused();
  await skip.click();
  await expect(reopen).toBeVisible();

  await logout(page);
  await login(page, existingEmail, password);
  await expect(page.getByRole('region', { name: 'Dein Einstieg', exact: true })).toHaveCount(0);
  await logout(page);
  await registerThroughUi(page, anotherEmail, password);
  await expect(page.getByRole('button', { name: 'Überspringen', exact: true })).toBeVisible();
  await logout(page);
  await login(page, firstEmail, password);
  await expect(reopen).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dein Einstieg', exact: true })).toHaveCount(0);
});
