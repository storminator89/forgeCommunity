import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

test('global skill search opens the filtered directory by keyboard and preserves URL history and reflow', async ({ page, request }, testInfo) => {
  test.skip(!process.env.CI, 'This fixture-writing browser journey runs only in the disposable CI browser job.');
  const databasePath = process.env.DATABASE_URL?.replace(/^file:/, '') ?? '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Skill search QA requires a loopback server and its disposable SQLite fixture database.');
  }
  expect((await request.get(`${origin}/api/search?query=skill&type=skill`)).status()).toBe(401);

  const id = randomUUID();
  const email = `skill-search-${id}@example.test`;
  const password = `SkillSearchA1!${id}`;
  const name = `Fähigkeiten-Fachperson ${id}`;
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name, email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);

  const query = `Skillbrowser-${id}`;
  const titles = Array.from({ length: 12 }, (_, index) => `${query} ${String(index).padStart(2, '0')} Langwortfähigkeitsverzeichnis`);
  let skillId = '';
  for (const title of titles) {
    const created = await page.request.post(`${origin}/api/skills`, { headers: { origin }, data: { name: title, category: 'Browser-Fixture' } });
    expect(created.status(), await created.text()).toBe(201);
    const skill = await created.json() as { id: string };
    if (title === titles[0]) skillId = skill.id;
  }
  const attached = await page.request.post(`${origin}/api/user/skills`, { headers: { origin }, data: { skillId, level: 80 } });
  expect(attached.status(), await attached.text()).toBe(201);

  await page.goto(`/search?q=${encodeURIComponent(query)}`);
  const tabs = page.getByRole('tablist', { name: 'Suchkategorie' });
  const skillsTab = tabs.getByRole('tab', { name: 'Fähigkeiten', exact: true });
  await skillsTab.focus();
  await page.keyboard.press('Enter');
  await expect(skillsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${query}&type=skill$`));
  await expect(page.getByRole('heading', { name: 'Ergebnisse (12)', exact: true })).toBeVisible();
  await expect(page.locator('main ol > li')).toHaveCount(10);
  await page.getByRole('button', { name: /Nächste/ }).click();
  await expect(page.locator('main ol > li')).toHaveCount(2);
  await page.goBack();
  await expect(page.locator('main ol > li')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Seite 1', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { localStorage.setItem('theme', value); }, theme);
    await page.reload();
    await expect(page.locator('main ol > li')).toHaveCount(10);
    for (const width of [320, 375, 414, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await skillsTab.focus();
      await expect(skillsTab).toBeFocused();
      await expect(skillsTab).toBeInViewport();
      if (width === 320) await page.screenshot({ path: testInfo.outputPath(`global-skill-search-${theme}-320.png`), fullPage: true });
    }
    await page.screenshot({ path: testInfo.outputPath(`global-skill-search-${theme}.png`), fullPage: true });
  }

  const result = page.getByRole('link', { name: new RegExp(titles[0]) });
  await result.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/skills\?query=/);
  const filter = page.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen' });
  await expect(filter).toHaveValue(titles[0]);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await filter.fill('unmatched-fixture');
  await expect(page.getByText('Keine passenden Mitglieder', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(filter).toBeFocused();
  await expect(page).toHaveURL(/\/skills$/);

  // Same-route Link/router changes and real Back/Forward must synchronize the
  // input without remounting the account's directory or stealing focus.
  await filter.fill(titles[0]);
  await page.evaluate(other => window.history.pushState(null, '', `/skills?query=${encodeURIComponent(other)}`), 'unmatched-fixture');
  await expect(filter).toHaveValue('unmatched-fixture');
  await page.goBack();
  await expect(filter).toHaveValue(titles[0]);
  await page.goForward();
  await expect(filter).toHaveValue('unmatched-fixture');
  await page.goBack();
  await expect(filter).toHaveValue(titles[0]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { localStorage.setItem('theme', value); }, theme);
    await page.reload();
    await expect(filter).toHaveValue(titles[0]);
    for (const width of [320, 375, 414, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(filter).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (width === 320) await page.screenshot({ path: testInfo.outputPath(`skill-directory-${theme}-320.png`), fullPage: true });
    }
    await page.screenshot({ path: testInfo.outputPath(`skill-directory-${theme}.png`), fullPage: true });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(filter).toBeVisible();
});
