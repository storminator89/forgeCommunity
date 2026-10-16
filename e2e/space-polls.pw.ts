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
    throw new Error('Poll browser QA requires the loopback, explicitly disposable SQLite fixture.');
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

test('members make voluntary Space decisions, retry safely, reflow, close, and lose revoked access', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One journey covers four responsive widths.');
  test.setTimeout(240_000);
  const databasePath = disposableDatabasePath();
  const nonce = randomUUID(); const password = `PollQa1!${nonce}`;
  const accounts: Array<{ id: string; email: string; name: string }> = [];
  for (const name of ['Poll QA Admin', 'Poll QA Alice', 'Poll QA Bob', 'Poll QA Outsider']) {
    const email = `poll-${accounts.length}-${nonce}@example.test`;
    const created = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name, email, password } });
    expect(created.status(), await created.text()).toBe(201);
    accounts.push({ id: (await created.json() as { userId: string }).userId, email, name });
  }
  const [admin, alice, bob] = accounts;
  const db = new DatabaseSync(databasePath);
  try { db.prepare('UPDATE "User" SET role=? WHERE id=?').run('ADMIN', admin.id); } finally { db.close(); }
  const contexts: BrowserContext[] = [];
  try {
    const pages: Page[] = []; const errors: string[] = [];
    for (const account of accounts) {
      const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      contexts.push(context); const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message)); await login(page, account.email, password); pages.push(page);
    }
    const [adminPage, alicePage, bobPage] = pages;
    const createdSpace = await contexts[0].request.post('/api/spaces', { headers: { origin }, data: {
      name: `Lernwerkstatt ${nonce.slice(0, 4)}`, description: 'Gemeinsam lernen. Kleine Schritte ausprobieren.', visibility: 'PRIVATE',
    } });
    expect(createdSpace.status(), await createdSpace.text()).toBe(201);
    const spaceId = (await createdSpace.json() as { id: string }).id;
    const api = `/api/spaces/${spaceId}`; const url = `/community/spaces/${spaceId}`;
    for (const account of [alice, bob]) {
      const added = await contexts[0].request.post(`${api}/members`, { headers: { origin }, data: { userId: account.id } });
      expect(added.status(), await added.text()).toBe(201);
    }
    expect((await request.get(`${origin}${api}/polls`)).status()).toBe(401);
    expect((await contexts[3].request.get(`${api}/polls`)).status()).toBe(404);
    await adminPage.goto(url);
    const open = adminPage.getByRole('button', { name: 'Umfrage erstellen', exact: true });
    await open.click(); await expect(adminPage.getByRole('textbox', { name: 'Frage', exact: true })).toBeFocused();
    await adminPage.keyboard.press('Escape'); await expect(open).toBeFocused();
    await open.click();
    const question = 'Was wollen wir gemeinsam ausprobieren?';
    const options = ['Zugänglichkeit gemeinsam prüfen', 'Tests gemeinsam verbessern'];
    await adminPage.getByRole('textbox', { name: 'Frage', exact: true }).fill(question);
    for (let i = 0; i < options.length; i++) await adminPage.getByRole('textbox', { name: `Antwort ${i + 1}`, exact: true }).fill(options[i]);
    const creation = adminPage.waitForResponse(response => new URL(response.url()).pathname === `${api}/polls` && response.request().method() === 'POST');
    await adminPage.getByRole('button', { name: 'Umfrage veröffentlichen', exact: true }).focus(); await adminPage.keyboard.press('Enter');
    const response = await creation; expect(response.status(), await response.text()).toBe(201);
    const item = await response.json() as { id: string; options: Array<{ id: string; label: string }> };
    await expect(adminPage.getByRole('heading', { level: 3, name: question })).toBeVisible();
    await expect(adminPage.getByText(/In kleinen Gruppen können Antworten erkennbar sein/)).toBeVisible();
    await alicePage.goto(url);
    const pollSection = alicePage.getByRole('region', { name: 'Umfragen', exact: true });
    await alicePage.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(pollSection.getByRole('button', { name: 'Animationen ausschalten', exact: true })).toBeEnabled();
    await alicePage.evaluate(() => {
      const state = window as typeof window & { friendlyAnimations: string[] };
      state.friendlyAnimations = [];
      document.addEventListener('animationstart', event => { if (event.target instanceof Element && event.target.closest('[data-poll-id]')) state.friendlyAnimations.push((event as AnimationEvent).animationName); });
    });
    // The first real server write succeeds, but its browser response is lost.
    // The explicit retry must replay the same receipt, with no optimistic vote.
    let interruptedBody: unknown;
    let interrupted = false;
    let voteAttempts = 0;
    const votePath = `${api}/polls/${item.id}/vote`;
    await alicePage.route(`**${votePath}`, async route => {
      voteAttempts++;
      if (interrupted) { await route.continue(); return; }
      interrupted = true; interruptedBody = route.request().postDataJSON();
      const result = await route.fetch(); expect(result.status()).toBe(200);
      await route.abort('failed');
    });
    const first = alicePage.getByRole('radio', { name: new RegExp(options[0]) }); await first.focus(); await alicePage.keyboard.press('Space');
    await alicePage.getByRole('button', { name: 'Abstimmen', exact: true }).focus(); await alicePage.keyboard.press('Enter');
    await expect(pollSection.getByRole('alert')).toBeVisible();
    await expect(pollSection.getByText('Deine gespeicherte Auswahl', { exact: true })).toHaveCount(0);
    const firstVote = alicePage.waitForResponse(result => new URL(result.url()).pathname === votePath && result.request().method() === 'PUT');
    await alicePage.getByRole('button', { name: 'Abstimmen', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    const voted = await firstVote; expect(voted.status(), await voted.text()).toBe(200);
    const originalRequest = voted.request().postDataJSON();
    expect(originalRequest).toEqual(interruptedBody);
    await alicePage.unroute(`**${votePath}`);
    await expect.poll(() => alicePage.evaluate(() => (window as typeof window & { friendlyAnimations: string[] }).friendlyAnimations.length > 0)).toBe(true);
    await expect(alicePage.getByText('Deine gespeicherte Auswahl', { exact: true })).toBeVisible();
    await expect(alicePage.getByText('1 Stimme insgesamt')).toBeVisible();
    expect(voteAttempts).toBe(2);
    await expect(first).toBeFocused();
    await pollSection.getByRole('button', { name: 'Animationen ausschalten', exact: true }).click();
    expect(await alicePage.evaluate(() => localStorage.getItem('forge-community-motion-off'))).toBe('true');
    await alicePage.evaluate(() => { (window as typeof window & { friendlyAnimations: string[] }).friendlyAnimations = []; });
    await alicePage.getByRole('radio', { name: new RegExp(options[1]) }).check();
    await alicePage.getByRole('button', { name: 'Auswahl ändern', exact: true }).click();
    await expect(alicePage.getByRole('radio', { name: new RegExp(`${options[1]}.*Deine gespeicherte Auswahl`) })).toBeChecked();
    await expect(pollSection.locator('[data-confirmed]')).toHaveCount(0);
    expect(await alicePage.evaluate(() => (window as typeof window & { friendlyAnimations: string[] }).friendlyAnimations)).toEqual([]);
    const replay = await contexts[1].request.put(`${api}/polls/${item.id}/vote`, { headers: { origin }, data: originalRequest });
    expect(replay.status(), await replay.text()).toBe(200);
    expect((await replay.json()).ownVote).toEqual({ optionId: item.options[1].id, revision: 2 });
    await bobPage.goto(url); await expect(bobPage.getByText('1 Stimme insgesamt')).toBeVisible();
    await expect(bobPage.getByText('Deine gespeicherte Auswahl')).toHaveCount(0);
    await bobPage.getByRole('radio', { name: new RegExp(options[0]) }).check(); await bobPage.getByRole('button', { name: 'Abstimmen', exact: true }).click();
    await expect(bobPage.getByText('2 Stimmen insgesamt')).toBeVisible();
    const privateView = await (await contexts[0].request.get(`${api}/polls/${item.id}`)).json();
    expect(privateView.ownVote).toEqual({ optionId: null, revision: 0 });
    expect(JSON.stringify(privateView)).not.toMatch(/userId|voters|creator|email|requestId|payloadDigest/);
    expect((await contexts[0].request.put(`${api}/polls/${item.id}/vote`, { headers: { origin }, data: { optionId: item.options[0].id, expectedRevision: 0, requestId: `visual-${nonce}` } })).status()).toBe(200);
    await alicePage.reload();
    await expect(pollSection.getByRole('button', { name: 'Animationen einschalten', exact: true })).toBeEnabled();
    await alicePage.emulateMedia({ reducedMotion: 'reduce' });
    await expect(pollSection.getByRole('button', { name: 'Animationen durch Systemeinstellung ausgeschaltet', exact: true })).toBeDisabled();
    await expect(pollSection.getByText('3 Stimmen insgesamt')).toBeVisible();
    for (const theme of ['Hell', 'Dunkel']) {
      await alicePage.getByRole('button', { name: 'Farbschema auswählen' }).click(); await alicePage.getByRole('menuitem', { name: theme, exact: true }).click();
      for (const width of [320, 375, 414, 768]) {
        await alicePage.setViewportSize({ width, height: 900 }); await checkReflow(alicePage);
        await pollSection.screenshot({ path: testInfo.outputPath(`poll-${theme}-${width}.png`), animations: 'disabled' });
        expect(await pollSection.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
      }
    }
    // Long dynamic copy is an explicit edge case, separate from the readable
    // primary demonstration. All content still comes from the real API.
    const longQuestion = `Welche gemeinsame Aufgabe folgt? ${'ZusammenarbeitVerständlichPlanen'.repeat(3)}`;
    const edge = await contexts[0].request.post(`${api}/polls`, { headers: { origin }, data: {
      question: longQuestion, options: ['ZugänglichkeitGemeinsamVerbessern'.repeat(3), 'VerständlichkeitZusammenPrüfen'.repeat(3)], requestId: `edge-${nonce}`,
    } });
    expect(edge.status(), await edge.text()).toBe(201); const edgeId = (await edge.json()).id;
    await alicePage.reload();
    const edgeCard = pollSection.getByRole('article').filter({ has: alicePage.getByRole('heading', { name: longQuestion, exact: true }) });
    for (const width of [320, 768]) {
      await alicePage.setViewportSize({ width, height: 900 }); await checkReflow(alicePage);
      await edgeCard.screenshot({ path: testInfo.outputPath(`poll-long-content-${width}.png`), animations: 'disabled' });
    }
    expect((await contexts[0].request.patch(`${api}/polls/${edgeId}`, { headers: { origin }, data: { hidden: true, expectedRevision: 0 } })).status()).toBe(200);
    await alicePage.reload();
    await alicePage.setViewportSize({ width: 1280, height: 900 });
    await alicePage.evaluate(() => { document.documentElement.style.zoom = '2'; }); await checkReflow(alicePage);
    await alicePage.evaluate(() => { document.documentElement.style.zoom = ''; });
    const adminPoll = adminPage.getByRole('article').filter({ has: adminPage.getByRole('heading', { name: question, exact: true }) });
    await adminPoll.getByText('Umfrage verwalten', { exact: true }).click();
    await adminPoll.getByRole('button', { name: 'Umfrage ausblenden', exact: true }).click();
    await expect(adminPoll.getByText('Offen · Ausgeblendet', { exact: true })).toBeVisible();
    await adminPoll.getByText('Umfrage verwalten', { exact: true }).click();
    await expect(adminPoll.getByRole('button', { name: 'Umfrage einblenden', exact: true })).toBeVisible();
    expect((await contexts[1].request.get(`${api}/polls/${item.id}`)).status()).toBe(404);
    await alicePage.reload(); await expect(alicePage.getByRole('heading', { name: question, exact: true })).toHaveCount(0);
    await adminPoll.getByRole('button', { name: 'Umfrage einblenden', exact: true }).click();
    await expect(adminPoll.getByText('Offen', { exact: true })).toBeVisible();
    await adminPoll.getByText('Umfrage verwalten', { exact: true }).click();
    await expect(adminPoll.getByRole('button', { name: 'Umfrage schließen', exact: true })).toBeVisible();
    await adminPoll.getByRole('button', { name: 'Umfrage schließen', exact: true }).click();
    await expect(adminPoll.getByText('Geschlossen', { exact: true })).toBeVisible();
    await expect(adminPoll.getByText('Umfrage verwalten', { exact: true })).toBeFocused();
    await expect(adminPoll.getByRole('button', { name: 'Umfrage schließen', exact: true })).toHaveCount(0);
    await alicePage.reload(); await expect(alicePage.getByRole('heading', { name: question, exact: true })).toBeVisible();
    await expect(alicePage.getByRole('button', { name: 'Auswahl ändern', exact: true })).toHaveCount(0);
    expect((await contexts[1].request.put(`${api}/polls/${item.id}/vote`, { headers: { origin }, data: { optionId: item.options[0].id, expectedRevision: 2, requestId: 'after-close' } })).status()).toBe(409);
    const removed = await contexts[0].request.delete(`${api}/members/${alice.id}`, { headers: { origin } });
    expect(removed.status(), await removed.text()).toBe(200);
    await alicePage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(alicePage.getByRole('heading', { level: 1, name: 'Space nicht verfügbar' })).toBeVisible();
    await expect(alicePage.getByText(question, { exact: true })).toHaveCount(0);
    expect((await contexts[1].request.get(`${api}/polls/${item.id}`)).status()).toBe(404);
    await alicePage.goto('/community/spaces'); await alicePage.goBack();
    await expect(alicePage.getByText(question, { exact: true })).toHaveCount(0);

    // PUBLIC Space membership changes must refresh canVote without a reload.
    const publicSpace = await contexts[0].request.post('/api/spaces', { headers: { origin }, data: { name: `Public Poll ${nonce.slice(0, 8)}`, description: 'A signed-in public decision.', visibility: 'PUBLIC' } });
    expect(publicSpace.status()).toBe(201); const publicId = (await publicSpace.json()).id;
    const publicPoll = await contexts[0].request.post(`/api/spaces/${publicId}/polls`, { headers: { origin }, data: { question: 'Was besprechen wir als Nächstes?', options: ['Planen', 'Testen'], requestId: nonce } });
    expect(publicPoll.status()).toBe(201); const publicItem = await publicPoll.json();
    await alicePage.goto(`/community/spaces/${publicId}`);
    await expect(alicePage.getByText('Tritt dem Space bei, um abzustimmen.')).toBeVisible();
    await alicePage.getByRole('button', { name: 'Beitreten', exact: true }).click();
    await expect(alicePage.getByRole('button', { name: 'Abstimmen', exact: true })).toBeVisible();
    await alicePage.getByRole('radio', { name: /Planen/ }).check(); await alicePage.getByRole('button', { name: 'Abstimmen', exact: true }).click();
    await expect(alicePage.getByText('1 Stimme insgesamt')).toBeVisible();
    await alicePage.getByRole('button', { name: 'Verlassen', exact: true }).click();
    await expect(alicePage.getByText('Tritt dem Space bei, um abzustimmen.')).toBeVisible();
    await expect(alicePage.getByRole('button', { name: 'Auswahl ändern', exact: true })).toHaveCount(0);
    expect((await contexts[1].request.put(`/api/spaces/${publicId}/polls/${publicItem.id}/vote`, { headers: { origin }, data: { optionId: publicItem.options[1].id, expectedRevision: 1, requestId: 'after-leave' } })).status()).toBe(403);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
