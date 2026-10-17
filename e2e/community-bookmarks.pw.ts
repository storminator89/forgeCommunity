import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
function disposablePath() {
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      new URL(origin).origin !== origin || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' || !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Community bookmarks browser QA requires the explicitly disposable loopback SQLite fixture.');
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
async function capture(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => document.fonts.status), { timeout: 10_000 }).toBe('loaded');
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  const overflow = await page.locator('#page-content button:visible, #page-content a:visible').evaluateAll(elements => elements.some(element => {
    const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1;
  }));
  expect(overflow).toBe(false);
  // Original viewport capture. No clipping, styling, freezing or cancelling motion.
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
}

test('private saved post/comment, older-comment resolver, uncertain write and current visibility', async ({ page, request }, info) => {
  const path = disposablePath(); const nonce = randomUUID(); const password = `SavedQaA1!${nonce}`;
  const accounts: { id: string; email: string }[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    for (const name of ['Saved QA Member', 'Saved QA Other']) {
      const email = `community-saved-${accounts.length}-${nonce}@example.test`;
      const registered = await request.post(`${origin}/api/register`, { headers: { origin }, data: { email, name, password } });
      expect(registered.status()).toBe(201); accounts.push({ id: (await registered.json()).userId, email });
    }
    await login(page, accounts[0].email, password);
    const created = await page.request.post('/api/posts', { headers: { origin }, data: { title: `Eine Frage für später ${nonce}`, content: '<p>Gemeinsam einen Zusammenhang verstehen.</p>' } });
    expect(created.status()).toBe(201); const post = await created.json();
    let olderId = '';
    for (let index = 0; index < 8; index++) {
      const reply = await page.request.post(`/api/posts/${post.id}/comments`, { headers: { origin }, data: { content: index === 0 ? `Ältere Antwort ${nonce}` : `Weitere Beobachtung ${index}` } });
      expect(reply.status()).toBe(200); const comment = await reply.json(); if (!index) olderId = comment.id;
    }
    const seed = new DatabaseSync(path);
    try { expect(seed.prepare('UPDATE "Comment" SET "createdAt" = ? WHERE "id" = ?').run(1, olderId).changes).toBe(1); } finally { seed.close(); }
    await page.goto(`/community#post-${post.id}`); const card = page.locator(`#post-${post.id}`);
    const savePost = card.getByRole('button', { name: 'Beitrag merken', exact: true });
    await expect(savePost).toBeEnabled(); await savePost.focus(); await page.keyboard.press('Enter');
    const savedPost = card.getByRole('button', { name: 'Beitrag aus Merkliste entfernen', exact: true });
    await expect(savedPost).toHaveAttribute('aria-pressed', 'true'); await expect(savedPost).toBeFocused();
    await card.getByRole('button', { name: '8 Kommentare anzeigen' }).click();
    await expect(card.locator(`#comment-${olderId}`)).toHaveCount(0);
    await card.getByRole('button', { name: 'Weitere Kommentare laden' }).click();
    const older = card.locator(`#comment-${olderId}`); await expect(older).toBeVisible();
    await older.getByRole('button', { name: 'Kommentar merken', exact: true }).click();
    await expect(older.getByRole('button', { name: 'Kommentar aus Merkliste entfernen', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/community/saved');
    const main = page.locator('#page-content'); await expect(main.getByRole('listitem')).toHaveCount(2);
    for (const scheme of ['Hell', 'Dunkel']) {
      await page.getByRole('button', { name: 'Farbschema auswählen' }).click(); await page.getByRole('menuitem', { name: scheme, exact: true }).click();
      await capture(page, info, `community-saved-${scheme}`);
    }
    await main.getByRole('button', { name: 'Kommentare', exact: true }).click(); await expect(main.getByRole('listitem')).toHaveCount(1);
    const deepLink = main.getByRole('link', { name: post.title, exact: true });
    await expect(deepLink).toHaveAttribute('href', `/api/community/bookmarks/comment/${olderId}`);
    await deepLink.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/community#comment-${olderId}$`)); await expect(page.locator(`#comment-${olderId}`)).toBeVisible();
    const commentButton = page.locator(`#comment-${olderId}`).getByRole('button', { name: 'Kommentar aus Merkliste entfernen', exact: true });
    await page.route(`**/api/community/bookmarks/comment/${olderId}`, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue(), { times: 1 });
    await commentButton.click();
    await expect(page.locator(`#comment-${olderId}`).getByRole('alert')).toContainText('Änderung nicht bestätigt');
    await page.locator(`#comment-${olderId}`).getByRole('button', { name: 'Kommentar: Stand erneut laden' }).click();
    await expect(commentButton).toHaveAttribute('aria-pressed', 'true');
    const revoke = new DatabaseSync(path);
    try { expect(revoke.prepare('UPDATE "Post" SET "published" = 0 WHERE "id" = ?').run(post.id).changes).toBe(1); } finally { revoke.close(); }
    const unavailable = await page.request.get(`/api/community/bookmarks/comment/${olderId}`, { maxRedirects: 0 });
    expect(unavailable.status()).toBe(404); expect(unavailable.headers()['cache-control']).toBe('private, no-store');
    await page.goto('/community/saved'); await expect(main.getByRole('heading', { name: 'Noch nichts gemerkt' })).toBeVisible();
    const image = main.locator('img[src*="community-saved-empty"]'); await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await capture(page, info, 'community-saved-empty');
    await page.getByRole('button', { name: 'Benutzermenü öffnen' }).click(); await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login$/); await login(page, accounts[1].email, password);
    await page.goto('/community/saved'); await expect(main.getByRole('heading', { name: 'Noch nichts gemerkt' })).toBeVisible(); await expect(main).not.toContainText(post.title);
    info.annotations.push({ type: 'coverage', description: 'Real disposable SQLite APIs and native older-comment redirect; only uncertain PUT is deliberately aborted. Viewport/theme reflect project. 200% and full CI remain separate acceptance gates.' });
  } finally {
    const cleanup = new DatabaseSync(path);
    try { cleanup.exec('PRAGMA foreign_keys=ON'); for (const account of accounts) cleanup.prepare('DELETE FROM "User" WHERE "id" = ?').run(account.id); }
    finally { cleanup.close(); }
  }
});
