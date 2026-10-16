import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

// These responses are deterministic rendering fixtures, not assertions about
// membership, authorization or stored skills. Existing real-HTTP journeys keep
// their original long UUID/skill strings for the before/after comparison.
const skills = [
  { id: 'typescript', name: 'TypeScript', category: 'Technik' },
  { id: 'figma', name: 'Figma', category: 'Design' },
  { id: 'moderation', name: 'Moderation', category: 'Zusammenarbeit' },
];
const members = [
  { id: 'ada', name: 'Ada Winter', image: null, role: 'ADMIN', title: 'Entwicklerin und Lernbegleiterin', createdAt: '2026-01-10T10:00:00Z', followers: 2, skills: ['TypeScript', 'Moderation'] },
  { id: 'bea', name: 'Bea Sommer', image: null, role: 'USER', title: 'Produktdesignerin', createdAt: '2026-02-10T10:00:00Z', followers: 0, skills: ['Figma'] },
];
const directory = {
  skills,
  members: members.map(member => ({ id: member.id, name: member.name, avatar: '', title: member.title,
    endorsements: member.id === 'ada' ? 2 : 0, hasEndorsed: false,
    skills: member.skills.map(skillName => ({ skillName, level: skillName === 'TypeScript' ? 80 : 60 })),
  })),
};

async function login(page: Page) {
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Directory captures require a loopback server and its explicitly disposable SQLite fixture database.');
  }
  const id = randomUUID();
  const email = `directory-capture-${id}@example.test`;
  const password = `DirectoryCaptureA1!${id}`;
  const registered = await page.request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Directory QA', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  await page.goto('/login?callbackUrl=%2Fskills');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/skills$/);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.locator('main').evaluate(main => main.scrollWidth <= main.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

test('directories put people first with compact controls in light, dark and narrow viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390-chromium', '375/414 are captured explicitly alongside the original 320 and desktop viewports.');
  await login(page);
  await page.route('**/api/members', route => route.fulfill({ json: members }));
  await page.route('**/api/skills/directory', route => route.fulfill({ json: directory }));
  await page.route('**/api/user/skills', route => route.fulfill({ json: [{ id: 'own-typescript', skillId: skills[0].id, skill: skills[0], level: 80, endorsements: 0 }] }));
  // Reuse the existing device-local opt-out. Do not add a new preference.
  await page.addInitScript(() => localStorage.setItem('forge-community-motion-off', 'true'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const widths = testInfo.project.name === 'mobile-320-chromium' ? [320] : [320, 375, 414, 768, 1280];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme);
    for (const width of widths) {
      await page.setViewportSize({ width, height: testInfo.project.name === 'mobile-320-chromium' ? 700 : 800 });
      await page.goto('/members');
      const ada = page.getByRole('link', { name: 'Profil von Ada Winter öffnen', exact: true });
      await expect(ada).toBeVisible();
      await expect(ada).toBeInViewport();
      await expect(ada).toContainText('Administration');
      await expect(page.getByText('Aktive Mitglieder', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', 'Name, Rolle oder Skill');
      await capture(page, testInfo, `members-realistic-${theme}-${width}`);
      await page.getByRole('searchbox').fill('Lehrperson');
      await expect(page.getByRole('heading', { name: 'Keine Mitglieder gefunden', exact: true })).toBeVisible();
      await capture(page, testInfo, `members-no-results-${theme}-${width}`);

      await page.goto('/skills?query=TypeScript');
      const filter = page.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen', exact: true });
      const member = page.getByRole('link', { name: 'Ada Winter', exact: true });
      await expect(member).toBeVisible();
      await expect(member).toBeInViewport();
      await expect(page.getByText('Kenntnisstände sind Selbsteinschätzungen.', { exact: true })).toBeVisible();
      const sort = await page.getByRole('combobox', { name: 'Sortieren nach', exact: true }).boundingBox();
      const direction = await page.getByRole('button', { name: 'Absteigend sortieren', exact: true }).boundingBox();
      expect(sort).not.toBeNull(); expect(direction).not.toBeNull();
      expect(Math.abs(sort!.y - direction!.y)).toBeLessThanOrEqual(1);
      await capture(page, testInfo, `skills-realistic-filtered-${theme}-${width}`);
      const detail = page.getByRole('listitem').filter({ has: member }).getByRole('button', { name: 'Details anzeigen', exact: true });
      await detail.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Ada Winter', exact: true })).toBeVisible();
      await capture(page, testInfo, `skills-details-${theme}-${width}`);
      await page.keyboard.press('Escape');
      await expect(detail).toBeFocused();
      const summary = page.locator('summary').filter({ hasText: 'Fähigkeiten entdecken' });
      await summary.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'TypeScript: 1 Mitglied finden', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'TypeScript: 1 Mitglied finden', exact: true }).click();
      await expect(filter).toBeFocused();
      await page.getByRole('tab', { name: 'Meine Fähigkeiten', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'TypeScript', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Eigene Fähigkeiten ergänzen' })).toHaveCount(0);
      await capture(page, testInfo, `skills-own-realistic-${theme}-${width}`);
    }
  }
});

test('directory loading, empty and error states stay readable without invented result counts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390-chromium', 'Original 320 and desktop contexts cover these states.');
  await login(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => localStorage.setItem('forge-community-motion-off', 'true'));
    for (const routeName of ['members', 'skills']) {
      const endpoint = routeName === 'members' ? '**/api/members' : '**/api/skills/directory';
      let finishLoading!: () => void;
      const loading = new Promise<void>(resolve => { finishLoading = resolve; });
      await page.route(endpoint, async route => { await loading; await route.fulfill({ json: routeName === 'members' ? [] : { skills: [], members: [] } }); });
      await page.goto(`/${routeName}`);
      if (routeName === 'members') await expect(page.getByRole('status', { name: 'Mitglieder werden geladen' })).toBeVisible();
      else await expect(page.getByRole('heading', { name: 'Skill-Verzeichnis wird geladen', exact: true })).toBeVisible();
      await expect(page.getByText('0 Ergebnisse', { exact: true })).toHaveCount(0);
      await capture(page, testInfo, `${routeName}-loading-${theme}`);
      finishLoading();
      await expect(page.getByRole('heading', { name: 'Noch keine Mitglieder', exact: true })).toBeVisible();
      await capture(page, testInfo, `${routeName}-empty-${theme}`);
      await page.unroute(endpoint);
      await page.route(endpoint, route => route.fulfill({ status: 503, json: { error: 'Synthetic fixture unavailable' } }));
      await page.reload();
      await expect(page.getByRole('heading', { name: routeName === 'members' ? 'Mitglieder konnten nicht geladen werden' : 'Skill-Verzeichnis konnte nicht geladen werden', exact: true })).toBeVisible();
      await capture(page, testInfo, `${routeName}-error-${theme}`);
      await page.unroute(endpoint);
    }
  }
});
