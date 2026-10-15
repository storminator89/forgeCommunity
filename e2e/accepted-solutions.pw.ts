import { randomUUID } from 'node:crypto';
import { isAbsolute, basename } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
function assertDisposableFixture() {
  const url = process.env.DATABASE_URL;
  const path = url?.startsWith('file:') ? url.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Accepted-solution browser QA requires the explicitly disposable local SQLite fixture.');
  }
}
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Benutzermenü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('a peer reply can be author-selected, conflict-refreshed and cleared with keyboard controls', async ({ page, request }, testInfo) => {
  assertDisposableFixture();
  const id = randomUUID();
  const ownerEmail = `solution-owner-${id}@example.test`;
  const peerEmail = `solution-peer-${id}@example.test`;
  const password = `SolutionQaA1!${id}`;
  for (const [email, name] of [[ownerEmail, 'Solution QA Author'], [peerEmail, 'Solution QA Peer']]) {
    const registered = await request.post(`${origin}/api/register`, { headers: { origin }, data: { email, name, password } });
    expect(registered.status(), await registered.text()).toBe(201);
  }
  await signIn(page, ownerEmail, password);
  const created = await page.request.post('/api/posts', { headers: { origin }, data: { title: `Solution QA ${id}`, content: 'Synthetic solution question.' } });
  expect(created.status(), await created.text()).toBe(201);
  const post = await created.json();
  await signOut(page);
  await signIn(page, peerEmail, password);
  await page.goto(`/community#post-${post.id}`);
  const card = page.locator(`#post-${post.id}`);
  await card.getByRole('button', { name: '0 Kommentare anzeigen' }).click();
  await card.getByRole('textbox', { name: 'Kommentar schreiben' }).fill(`Helpful peer answer ${id}`);
  const sent = page.waitForResponse(response => response.url().endsWith(`/api/posts/${post.id}/comments`) && response.request().method() === 'POST');
  await card.getByRole('button', { name: 'Kommentar senden' }).click();
  expect((await sent).status()).toBe(200);
  await expect(card.getByText(`Helpful peer answer ${id}`, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Diese Antwort als Lösung auswählen' })).toHaveCount(0);
  await signOut(page);
  await signIn(page, ownerEmail, password);
  await page.goto(`/community#post-${post.id}`);
  await card.getByRole('button', { name: '1 Kommentar anzeigen' }).click();
  const choose = card.getByRole('button', { name: 'Diese Antwort als Lösung auswählen' });

  // A controlled conflict response tests accessible recovery without timing a
  // second session against the browser. Actual API concurrency has DB tests.
  const solutionPath = `**/api/posts/${post.id}/solution`;
  await page.route(solutionPath, async route => {
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Die Lösung wurde inzwischen geändert. Bitte erneut auswählen.', post }) });
  }, { times: 1 });
  await choose.focus();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('alert')).toHaveText(/Die Lösung wurde inzwischen geändert/);
  await expect(choose).toBeEnabled();
  const selectedResponse = page.waitForResponse(response => response.url().endsWith(`/api/posts/${post.id}/solution`) && response.request().method() === 'PUT');
  await choose.focus();
  await page.keyboard.press('Enter');
  expect((await selectedResponse).status()).toBe(200);
  await expect(card.getByRole('region', { name: 'Ausgewählte Lösung' })).toBeVisible();
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Lösungsauswahl für diese Antwort entfernen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByText(`Helpful peer answer ${id}`, { exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('accepted-solution.png'), fullPage: true });
  await page.reload();
  await expect(card.getByRole('region', { name: 'Ausgewählte Lösung' })).toBeVisible();
  const clearResponse = page.waitForResponse(response => response.url().endsWith(`/api/posts/${post.id}/solution`) && response.request().method() === 'PUT');
  await card.getByRole('button', { name: 'Lösungsauswahl entfernen', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect((await clearResponse).status()).toBe(200);
  await expect(card.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveCount(0);
  await page.reload();
  await expect(card.getByRole('button', { name: '1 Kommentar anzeigen' })).toBeVisible();
  await expect(card.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveCount(0);
});
