import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

function disposableDatabasePath() {
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (new URL(origin).origin !== origin || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Mission overview browser QA requires the loopback, explicitly disposable SQLite fixture.');
  }
  return path;
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

async function checkReflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  const clipped = await page.locator('#page-content button:visible, #page-content a:visible').evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 ? [] : [element.getAttribute('aria-label') || element.textContent];
  }));
  expect(clipped).toEqual([]);
}

test('discover a private mission without courses, navigate by keyboard and remove revoked membership on refresh', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One real journey covers responsive widths and both themes.');
  test.setTimeout(180_000);
  const databasePath = disposableDatabasePath();
  const nonce = randomUUID();
  const password = `OverviewQa1!${nonce}`;
  const accounts: { id: string; email: string }[] = [];
  for (const name of ['Overview QA Admin', 'Overview QA Learner']) {
    const email = `overview-${accounts.length}-${nonce}@example.test`;
    const response = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name, email, password } });
    expect(response.status(), await response.text()).toBe(201);
    accounts.push({ id: (await response.json() as { userId: string }).userId, email });
  }
  const [admin, learner] = accounts;
  const db = new DatabaseSync(databasePath);
  try { expect(db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('ADMIN', admin.id).changes).toBe(1); }
  finally { db.close(); }
  const contexts: BrowserContext[] = [];
  try {
    for (const account of accounts) {
      const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      contexts.push(context);
      await login(await context.newPage(), account.email, password);
    }
    const adminRequest = contexts[0].request;
    const page = contexts[1].pages()[0];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const space = await adminRequest.post('/api/spaces', { headers: { origin }, data: {
      name: `Privater Lernraum ${nonce.slice(0, 8)}`, description: 'Disposable overview acceptance fixture.', visibility: 'PRIVATE',
    } });
    expect(space.status(), await space.text()).toBe(201);
    const spaceId = (await space.json() as { id: string }).id;
    const spaceApi = `/api/spaces/${spaceId}`;
    const membership = await adminRequest.post(`${spaceApi}/members`, { headers: { origin }, data: { userId: learner.id } });
    expect(membership.status(), await membership.text()).toBe(201);
    const title = `Gemeinsam${'LernzusammenhängeVerständlichErklären'.repeat(2)}`;
    const mission = await adminRequest.post(`${spaceApi}/missions`, { headers: { origin }, data: {
      title, prompt: 'Erklärt gemeinsam einen neuen Zusammenhang und baut auf einer anderen Erklärung auf.', requestId: randomUUID(),
    } });
    expect(mission.status(), await mission.text()).toBe(201);
    const missionId = (await mission.json() as { id: string }).id;
    const detailUrl = `/community/spaces/${spaceId}/missions/${missionId}`;
    const mutations: string[] = [];
    page.on('request', outgoing => {
      const path = new URL(outgoing.url()).pathname;
      if (/^\/api\/(space-missions|spaces\/[^/]+\/missions)/.test(path) && outgoing.method() !== 'GET') mutations.push(`${outgoing.method()} ${path}`);
    });

    await page.goto('/courses/journey');
    await expect(page.getByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' })).toBeVisible();
    const discovery = page.getByRole('link', { name: 'Space-Missionen entdecken' });
    await discovery.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/community\/missions$/);
    const detail = page.getByRole('link', { name: title, exact: true });
    await expect(detail).toBeVisible();
    await expect(page.getByText('Ohne feste Lernwoche · In deinem Tempo')).toBeVisible();
    await expect(page.getByRole('button', { name: /teilnehmen|beenden/i })).toHaveCount(0);
    await expect(page.getByText('Du nimmst teil', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Space-Missionen', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Community', exact: true })).not.toHaveAttribute('aria-current', 'page');
    const projected = await contexts[1].request.get('/api/space-missions');
    expect(projected.status(), await projected.text()).toBe(200);
    expect((await projected.json() as { items: { id: string; participationActive: boolean }[] }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: missionId, participationActive: false })]));

    for (const theme of ['Hell', 'Dunkel']) {
      await page.getByRole('button', { name: 'Farbschema auswählen' }).click();
      await page.getByRole('menuitem', { name: theme, exact: true }).click();
      for (const width of [320, 375, 414, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await checkReflow(page);
        await page.screenshot({ path: testInfo.outputPath(`mission-overview-${theme}-${width}.png`), animations: 'disabled' });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await checkReflow(page);
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    // A fresh document gives the keyboard traversal a predictable first target.
    await page.goto('/community/missions');
    await expect(detail).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#page-content')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Übersicht aktualisieren' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(detail).toBeFocused();
    expect(await detail.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${detailUrl}$`));
    await expect(page.getByRole('button', { name: 'Freiwillig teilnehmen' })).toBeVisible();
    expect(mutations).toEqual([]);

    // The global navigation and its quick-search projection reach the same page.
    await page.getByRole('link', { name: 'Space-Missionen', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(detail).toBeVisible();
    await page.keyboard.press('Control+k');
    const search = page.getByRole('dialog', { name: 'Schnell zum Ziel', exact: true });
    await search.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' }).fill('Space-Missionen');
    await search.getByRole('button', { name: 'Space-Missionen', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(search).toBeHidden();
    await expect(page).toHaveURL(/\/community\/missions$/);

    const removed = await adminRequest.delete(`${spaceApi}/members/${learner.id}`, { headers: { origin } });
    expect(removed.status(), await removed.text()).toBe(200);
    await page.getByRole('button', { name: 'Übersicht aktualisieren' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Keine offenen Missionen' })).toBeVisible();
    await expect(detail).toHaveCount(0);
    expect((await contexts[1].request.get(`${spaceApi}/missions/${missionId}`)).status()).toBe(404);
    expect(mutations).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});
