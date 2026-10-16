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
    throw new Error('Mission browser QA requires the loopback, explicitly disposable SQLite fixture.');
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
  const clipped = await page.locator('#page-content button:visible, #page-content input:visible, #page-content textarea:visible').evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 ? [] : [element.getAttribute('aria-label') || element.textContent || element.tagName];
  }));
  expect(clipped).toEqual([]);
}

test('two learners voluntarily teach back, reverse consent and moderate within a real private Space', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One real journey checks all four responsive widths.');
  test.setTimeout(240_000);
  const databasePath = disposableDatabasePath();
  const nonce = randomUUID();
  const password = `MissionQa1!${nonce}`;
  const accounts: { name: string; email: string; id: string }[] = [];
  for (const name of ['Mission QA Admin', 'Mission QA Alice', 'Mission QA Bob', 'Mission QA Outsider']) {
    const email = `mission-${accounts.length}-${nonce}@example.test`;
    const response = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name, email, password } });
    expect(response.status(), await response.text()).toBe(201);
    accounts.push({ name, email, id: (await response.json() as { userId: string }).userId });
  }
  const [admin, alice, bob] = accounts;
  const db = new DatabaseSync(databasePath);
  try { db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('ADMIN', admin.id); }
  finally { db.close(); }
  const contexts: BrowserContext[] = [];
  try {
    const pages: Page[] = [];
    const errors: string[] = [];
    for (const account of accounts) {
      const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await login(page, account.email, password);
      pages.push(page);
    }
    const [adminPage, alicePage, bobPage] = pages;
    const createdSpace = await contexts[0].request.post('/api/spaces', { headers: { origin }, data: {
      name: `Mission QA ${nonce.slice(0, 8)}`, description: 'Disposable private cooperative mission.', visibility: 'PRIVATE',
    } });
    expect(createdSpace.status(), await createdSpace.text()).toBe(201);
    const spaceId = (await createdSpace.json() as { id: string }).id;
    const spaceApi = `/api/spaces/${encodeURIComponent(spaceId)}`;
    for (const account of [alice, bob]) {
      const added = await contexts[0].request.post(`${spaceApi}/members`, { headers: { origin }, data: { userId: account.id } });
      expect(added.status(), await added.text()).toBe(201);
    }
    expect((await request.get(`${origin}${spaceApi}/missions`)).status()).toBe(401);
    expect((await contexts[3].request.get(`${spaceApi}/missions`)).status()).toBe(404);

    await adminPage.goto(`/community/spaces/${spaceId}`);
    await adminPage.getByRole('button', { name: 'Mission starten', exact: true }).click();
    const title = `Zusammenhänge${'VerständlichErklären'.repeat(3)}`;
    await adminPage.getByRole('textbox', { name: 'Thema', exact: true }).fill(title);
    await adminPage.getByRole('textbox', { name: 'Aufgabe', exact: true }).fill('Erklärt eine neue Idee und entwickelt den Gedanken einer anderen Person weiter.');
    const creation = adminPage.waitForResponse(response => new URL(response.url()).pathname === `${spaceApi}/missions` && response.request().method() === 'POST');
    await adminPage.getByRole('button', { name: 'Mission erstellen', exact: true }).focus();
    await adminPage.keyboard.press('Enter');
    const response = await creation;
    expect(response.status(), await response.text()).toBe(201);
    const missionId = (await response.json() as { id: string }).id;
    const url = `/community/spaces/${spaceId}/missions/${missionId}`;
    const base = `${spaceApi}/missions/${missionId}`;
    await expect(adminPage).toHaveURL(new RegExp(`${url}$`));
    expect((await contexts[3].request.get(base)).status()).toBe(404);
    for (const page of [alicePage, bobPage]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Freiwillig teilnehmen' })).toBeVisible();
      await page.getByRole('button', { name: 'Freiwillig teilnehmen' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Teilnahme beenden', exact: true })).toBeVisible();
      await page.getByLabel('Deine Erkenntnis', { exact: true }).fill(page === alicePage
        ? 'Eine Erklärung wird klarer, wenn ein konkretes Beispiel den Zusammenhang zeigt.'
        : `Ein Gegenbeispiel zeigt die Grenze eines Gedankens. ${'Lernzusammenhang'.repeat(15)}`);
      await page.getByRole('button', { name: 'Im Space teilen', exact: true }).click();
      await expect(page.getByText('Dein Beitrag ist im Space sichtbar.', { exact: true })).toBeVisible();
    }
    await alicePage.reload();
    await alicePage.getByRole('radio', { name: /Darauf aufbauen/ }).check();
    const target = alicePage.getByRole('radio', { name: /^Mission QA Bob:/ });
    await target.scrollIntoViewIfNeeded();
    const scrollBefore = await alicePage.locator('#page-content').evaluate(element => element.scrollTop);
    await target.check();
    expect(await alicePage.locator('#page-content').evaluate(element => element.scrollTop)).toBe(scrollBefore);
    await alicePage.getByLabel('Dein weiterführender Gedanke').fill('Das Gegenbeispiel kann nach dem ersten Beispiel helfen, die Erklärung genauer abzugrenzen.');
    await alicePage.getByRole('button', { name: 'Im Space teilen', exact: true }).click();
    await expect(alicePage.getByText('Gemeinsam weitergedacht. Das aktuelle Ziel ist erreicht.')).toBeVisible();
    await expect(alicePage.getByText('Mission QA Bobs Erkenntnis')).toBeVisible();

    for (const theme of ['Hell', 'Dunkel']) {
      await alicePage.getByRole('button', { name: 'Farbschema auswählen' }).click();
      await alicePage.getByRole('menuitem', { name: theme, exact: true }).click();
      for (const width of [320, 375, 414, 768]) {
        await alicePage.setViewportSize({ width, height: 900 });
        await checkReflow(alicePage);
        await alicePage.screenshot({ path: testInfo.outputPath(`mission-${theme}-${width}.png`), animations: 'disabled' });
      }
    }
    await alicePage.setViewportSize({ width: 1280, height: 900 });
    await alicePage.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await checkReflow(alicePage);
    await alicePage.evaluate(() => { document.documentElement.style.zoom = ''; });
    await alicePage.getByRole('button', { name: 'Teilnahme beenden', exact: true }).click();
    await expect(alicePage.getByRole('dialog', { name: 'Teilnahme beenden?' })).toBeVisible();
    await alicePage.keyboard.press('Escape');
    await expect(alicePage.getByRole('button', { name: 'Teilnahme beenden', exact: true })).toBeFocused();
    await alicePage.keyboard.press('Enter');
    await alicePage.getByRole('dialog').getByRole('button', { name: 'Teilnahme beenden', exact: true }).click();
    await expect(alicePage.getByText('Das gemeinsame Ziel ist noch offen.')).toBeVisible();
    await expect(alicePage.getByText('Eine Erklärung wird klarer, wenn ein konkretes Beispiel den Zusammenhang zeigt.', { exact: true })).toHaveCount(0);
    const rejoinResponse = alicePage.waitForResponse(response => new URL(response.url()).pathname === `${base}/participation` && response.request().method() === 'POST');
    await alicePage.getByRole('button', { name: 'Freiwillig teilnehmen' }).click();
    const rejoinResult = await rejoinResponse;
    expect(rejoinResult.status(), await rejoinResult.text()).toBe(200);
    expect(await rejoinResult.json()).toMatchObject({ participation: { epoch: 2, active: true }, ownContributions: [] });
    await expect(alicePage.getByLabel('Deine Erkenntnis', { exact: true })).toBeVisible();
    const afterRejoin = await contexts[1].request.get(base);
    const rejoined = await afterRejoin.json();
    expect(rejoined.participation).toMatchObject({ epoch: 2, active: true });
    expect(rejoined.ownContributions).toEqual([]);

    // Author withdrawal invalidates its target without letting an admin restore it.
    await bobPage.reload();
    await bobPage.getByRole('button', { name: 'Beitrag zurückziehen', exact: true }).click();
    await bobPage.getByRole('dialog').getByRole('button', { name: 'Beitrag zurückziehen', exact: true }).click();
    await expect(bobPage.getByText('Dein Beitrag ist zurückgezogen und wird nicht mehr mitgezählt.')).toBeVisible();
    await adminPage.reload();
    await adminPage.getByRole('button', { name: 'Moderation ansehen' }).click();
    await expect(adminPage.getByText('Erkenntnis · Von der Person zurückgezogen')).toBeVisible();
    const withdrawn = adminPage.getByRole('listitem').filter({ hasText: 'Erkenntnis · Von der Person zurückgezogen' });
    await expect(withdrawn.getByRole('button', { name: /einblenden|Ausblenden/ })).toHaveCount(0);

    const removed = await contexts[0].request.delete(`${spaceApi}/members/${alice.id}`, { headers: { origin } });
    expect(removed.status(), await removed.text()).toBe(200);
    await alicePage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(alicePage.getByRole('heading', { level: 2, name: 'Mission nicht verfügbar' })).toBeVisible();
    await expect(alicePage.getByRole('heading', { level: 1, name: title })).toHaveCount(0);
    await expect(alicePage.getByRole('textbox')).toHaveCount(0);
    expect((await contexts[1].request.get(base)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});
