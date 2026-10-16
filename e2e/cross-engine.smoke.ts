import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { crossEngineFixtureOrigin } from './cross-engine-fixture';

test.beforeEach(() => {
  // Fail closed before either journey navigates or sends fixture data.
  crossEngineFixtureOrigin();
});

test('signed-out entry preserves keyboard navigation and browser history', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lernen. Machen. Weitergeben.', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-content')).toBeFocused();

  await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Konto erstellen/ }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'Konto erstellen', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('textbox', { name: 'E-Mail-Adresse' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'Konto erstellen', exact: true })).toBeVisible();

  await page.goto('/community');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toHaveCount(0);
});

test('member can publish, find their post, and end their session', async ({ page, request }) => {
  // Keep each engine's real account and session independent. No storage-state
  // files, production records, or intercepted product APIs are used.
  const origin = crossEngineFixtureOrigin();
  const id = randomUUID();
  const email = `cross-engine-${id}@example.test`;
  const password = `CrossEngineA1!${id}`;
  const title = `Cross-engine smoke ${id}`;
  const registration = await request.post(`${origin}/api/register`, {
    maxRedirects: 0,
    headers: { origin },
    data: { name: 'Cross-engine smoke fixture', email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole('heading', { name: 'Community', exact: true })).toBeVisible();

  const newPost = page.getByRole('button', { name: 'Neuen Beitrag erstellen' });
  await newPost.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Titel' })).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveCount(0);
  await newPost.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Titel' }).fill(title);
  await page.getByRole('textbox', { name: 'Text bearbeiten' }).fill('Synthetic cross-engine smoke content.');
  const published = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/posts' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Beitrag veröffentlichen', exact: true }).click();
  expect((await published).status()).toBe(201);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

  await page.goto('/search');
  const search = page.getByRole('searchbox', { name: /^Suche nach Kursen/ });
  await search.fill(title);
  // Wait for the query-only entry before the tab adds its history entry.
  await expect(page).toHaveURL(url => url.pathname === '/search' &&
    url.searchParams.get('q') === title && !url.searchParams.has('type'));
  await page.getByRole('tab', { name: 'Beiträge', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/search' &&
    url.searchParams.get('q') === title && url.searchParams.get('type') === 'post');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(url => url.pathname === '/search' &&
    url.searchParams.get('q') === title && !url.searchParams.has('type'));
  await expect(search).toHaveValue(title);
  await expect(page.getByRole('tab', { name: 'Alle', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page).toHaveURL(url => url.pathname === '/search' &&
    url.searchParams.get('q') === title && url.searchParams.get('type') === 'post');
  await expect(search).toHaveValue(title);
  await expect(page.getByRole('tab', { name: 'Beiträge', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Benutzermenü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/community');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toHaveCount(0);
});
