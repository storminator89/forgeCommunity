import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const contributionPath = '/api/contributions/me';
const emptySelection = 'Noch keine aktuelle Auswahl durch andere Diskussionsautoren.';

// This CI journey only creates synthetic accounts and discussions in the
// explicitly disposable local fixture used by the existing browser-qa job.
function assertDisposableFixture() {
  const url = process.env.DATABASE_URL;
  const path = url?.startsWith('file:') ? url.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Private contribution browser QA requires the explicitly disposable local SQLite fixture.');
  }
}

function privateCard(page: Page) {
  return page.getByRole('complementary', { name: 'Deine Community im Überblick', exact: true })
    .getByRole('region', { name: 'Meine Diskussionsmeilensteine', exact: true });
}

function waitForContributionRead(page: Page) {
  return page.waitForResponse(response => new URL(response.url()).pathname === contributionPath &&
    response.request().method() === 'GET');
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  await expect(privateCard(page)).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Benutzermenü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(privateCard(page)).toHaveCount(0);
}

async function expectOwnSummary(request: APIRequestContext, selectedByAuthors: number, saturated = false) {
  const response = await request.get(contributionPath);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()['cache-control']).toContain('private');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers().vary).toMatch(/cookie/i);
  // Exact equality also prevents author identities, reply IDs or reward totals
  // from becoming part of this private, bounded read contract.
  expect(await response.json()).toEqual({ eligible: true, selectedByAuthors, saturated });
}

async function refreshOnFocus(page: Page) {
  const refreshed = waitForContributionRead(page);
  // Dispatch the native focus event deterministically instead of depending on
  // headless window activation, which differs across desktop/mobile projects.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await refreshed).status()).toBe(200);
}

async function pressSolutionControl(page: Page, button: Locator, postId: string) {
  await expect(button).toBeEnabled();
  const selected = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/posts/${postId}/solution` &&
    response.request().method() === 'PUT');
  const refreshed = waitForContributionRead(page);
  await button.focus();
  await page.keyboard.press('Enter');
  expect((await selected).status()).toBe(200);
  // Successful local changes must refresh the signed-in author's own card,
  // although selecting somebody else's reply does not credit the author.
  expect((await refreshed).status()).toBe(200);
}

test.beforeEach(() => assertDisposableFixture());

test('private discussion milestones stay account-scoped, deduplicate authors and reverse after keyboard clearing', async ({ page, browser, request }, testInfo) => {
  const id = randomUUID();
  const ownerEmail = `contribution-author-${id}@example.test`;
  const peerEmail = `contribution-peer-${id}@example.test`;
  const password = `ContributionQaA1!${id}`;
  const accounts: Record<string, string> = {};
  for (const [email, name] of [[ownerEmail, 'Contribution QA Author'], [peerEmail, 'Contribution QA Peer']]) {
    const registered = await request.post(`${origin}/api/register`, {
      headers: { origin }, data: { email, name, password },
    });
    expect(registered.status(), await registered.text()).toBe(201);
    accounts[email] = (await registered.json() as { userId: string }).userId;
  }
  const unauthenticated = await request.get(`${origin}${contributionPath}`);
  expect(unauthenticated.status()).toBe(401);

  await signIn(page, ownerEmail, password);
  await expect(privateCard(page).getByText(emptySelection, { exact: true })).toBeVisible();
  const posts: Array<{ id: string }> = [];
  for (let index = 1; index <= 2; index++) {
    const created = await page.request.post('/api/posts', {
      headers: { origin },
      data: { title: `Contribution QA ${index} ${id}`, content: 'Synthetic private milestone discussion.' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const post = await created.json() as { id: string; published: boolean };
    expect(post.published).toBe(true);
    posts.push(post);
  }

  // Separate cookies keep the peer's card mounted while the discussion author
  // selects and clears replies. Use each CI project's mobile/desktop viewport.
  const peerContext = await browser.newContext({
    baseURL: origin,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    const peerPage = await peerContext.newPage();
    await signIn(peerPage, peerEmail, password);
    const peerSummary = privateCard(peerPage);
    await expect(peerSummary.getByText(emptySelection, { exact: true })).toBeVisible();
    await expect(peerSummary.getByText(/Nur für dich sichtbar\./)).toBeVisible();
    await expect(peerSummary.getByText(/keine Punkte und beeinflusst keine öffentliche Rangliste oder Abzeichen/)).toBeVisible();
    await expectOwnSummary(peerPage.request, 0);

    for (const [index, post] of posts.entries()) {
      await peerPage.goto(`/community#post-${post.id}`);
      const card = peerPage.locator(`#post-${post.id}`);
      await card.getByRole('button', { name: '0 Kommentare anzeigen' }).click();
      const input = card.getByRole('textbox', { name: 'Kommentar schreiben' });
      const answer = `Helpful contribution answer ${index + 1} ${id}`;
      await input.fill(answer);
      const sent = peerPage.waitForResponse(response =>
        new URL(response.url()).pathname === `/api/posts/${post.id}/comments` &&
        response.request().method() === 'POST');
      const refreshed = waitForContributionRead(peerPage);
      await input.press('Enter');
      expect((await sent).status()).toBe(200);
      expect((await refreshed).status()).toBe(200);
      await expect(card.getByText(answer, { exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Diese Antwort als Lösung auswählen' })).toHaveCount(0);
      await expect(peerSummary.getByText(emptySelection, { exact: true })).toBeVisible();
    }

    await page.goto(`/community#post-${posts[0].id}`);
    const firstCard = page.locator(`#post-${posts[0].id}`);
    await firstCard.getByRole('button', { name: '1 Kommentar anzeigen' }).click();
    await pressSolutionControl(page, firstCard.getByRole('button', { name: 'Diese Antwort als Lösung auswählen' }), posts[0].id);
    await expect(firstCard.getByRole('region', { name: 'Ausgewählte Lösung' })).toBeVisible();
    await expect(privateCard(page).getByText(emptySelection, { exact: true })).toBeVisible();
    await expectOwnSummary(page.request, 0);

    await refreshOnFocus(peerPage);
    await expect(peerSummary.getByText('Aktuell von 1 Diskussionsautor ausgewählt', { exact: true })).toBeVisible();
    const progress = peerSummary.getByRole('progressbar', { name: 'Diskussionsmeilenstein: 1 von 3 unterschiedlichen Diskussionsautoren', exact: true });
    await expect(progress).toHaveJSProperty('tagName', 'PROGRESS');
    await expect(progress).toHaveAttribute('value', '1');
    await expect(progress).toHaveAttribute('max', '3');
    await expectOwnSummary(peerPage.request, 1);
    const otherAccountQuery = await peerPage.request.get(`${contributionPath}?userId=${encodeURIComponent(accounts[ownerEmail])}`);
    expect(otherAccountQuery.status()).toBe(400);
    expect(otherAccountQuery.headers()['cache-control']).toContain('no-store');
    await expectOwnSummary(peerPage.request, 1);
    await peerPage.screenshot({ path: testInfo.outputPath('private-contribution-milestone.png'), fullPage: true });

    // Switching accounts cannot retain the peer's one-author result.
    await signOut(peerPage);
    await signIn(peerPage, ownerEmail, password);
    await expect(privateCard(peerPage).getByText(emptySelection, { exact: true })).toBeVisible();
    await expectOwnSummary(peerPage.request, 0);
    await signOut(peerPage);
    await signIn(peerPage, peerEmail, password);
    await expect(peerSummary.getByText('Aktuell von 1 Diskussionsautor ausgewählt', { exact: true })).toBeVisible();

    // A second selected reply from the same discussion author stays at one.
    await page.goto(`/community#post-${posts[1].id}`);
    const secondCard = page.locator(`#post-${posts[1].id}`);
    await secondCard.getByRole('button', { name: '1 Kommentar anzeigen' }).click();
    await pressSolutionControl(page, secondCard.getByRole('button', { name: 'Diese Antwort als Lösung auswählen' }), posts[1].id);
    await refreshOnFocus(peerPage);
    await expectOwnSummary(peerPage.request, 1);
    await expect(peerSummary.getByText('Aktuell von 1 Diskussionsautor ausgewählt', { exact: true })).toBeVisible();

    await page.goto(`/community#post-${posts[0].id}`);
    await pressSolutionControl(page, firstCard.getByRole('button', { name: 'Lösungsauswahl entfernen', exact: true }), posts[0].id);
    await expect(firstCard.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveCount(0);
    await refreshOnFocus(peerPage);
    await expectOwnSummary(peerPage.request, 1);
    await expect(peerSummary.getByText('Aktuell von 1 Diskussionsautor ausgewählt', { exact: true })).toBeVisible();

    await page.goto(`/community#post-${posts[1].id}`);
    await pressSolutionControl(page, secondCard.getByRole('button', { name: 'Lösungsauswahl entfernen', exact: true }), posts[1].id);
    await expect(secondCard.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveCount(0);
    await refreshOnFocus(peerPage);
    await expectOwnSummary(peerPage.request, 0);
    await expect(peerSummary.getByText(emptySelection, { exact: true })).toBeVisible();
    await expect(peerSummary.getByRole('progressbar', { name: 'Diskussionsmeilenstein: 0 von 1 unterschiedlichen Diskussionsautoren', exact: true })).toHaveAttribute('value', '0');

    // An explicitly controlled read failure exercises accessible retry without
    // changing fixture data or interpreting a failed request as a zero count.
    await peerPage.route(`**${contributionPath}`, route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic private milestone read failure.' }),
    }), { times: 1 });
    const failedRead = waitForContributionRead(peerPage);
    await peerSummary.getByRole('button', { name: 'Diskussionsmeilensteine aktualisieren', exact: true }).focus();
    await peerPage.keyboard.press('Enter');
    expect((await failedRead).status()).toBe(503);
    await expect(peerSummary.getByRole('alert')).toHaveText('Diskussionsmeilensteine konnten nicht geladen werden.');
    await expect(peerSummary.getByText(emptySelection, { exact: true })).toHaveCount(0);
    const retryRead = waitForContributionRead(peerPage);
    await peerSummary.getByRole('button', { name: 'Diskussionsmeilensteine erneut laden', exact: true }).focus();
    await peerPage.keyboard.press('Enter');
    expect((await retryRead).status()).toBe(200);
    await expect(peerSummary.getByRole('alert')).toHaveCount(0);
    await expect(peerSummary.getByText(emptySelection, { exact: true })).toBeVisible();

    // Browser-only saturation fixture complements the real one-author journey;
    // it never writes additional accounts or public/reward data to the DB.
    await peerPage.route(`**${contributionPath}`, route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ eligible: true, selectedByAuthors: 5, saturated: true }),
    }), { times: 1 });
    const saturatedRead = waitForContributionRead(peerPage);
    await peerSummary.getByRole('button', { name: 'Diskussionsmeilensteine aktualisieren', exact: true }).focus();
    await peerPage.keyboard.press('Enter');
    expect((await saturatedRead).status()).toBe(200);
    await expect(peerSummary.getByText('Aktuell von 5+ Diskussionsautoren ausgewählt', { exact: true })).toBeVisible();
    await expect(peerSummary.getByRole('progressbar')).toHaveCount(0);
    await expect(peerSummary.getByText('Aktuell erreicht', { exact: true })).toHaveCount(3);
    // Removing the browser override restores the actual reversible zero state.
    await refreshOnFocus(peerPage);
    await expect(peerSummary.getByText(emptySelection, { exact: true })).toBeVisible();
    await expectOwnSummary(peerPage.request, 0);
  } finally {
    await peerContext.close();
  }
});
