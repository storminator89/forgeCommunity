import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

test('profile and skills links open skill settings by keyboard with working tab history', async ({ page, request }) => {
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db') {
    throw new Error('Skill handoff QA requires its disposable SQLite fixture database.');
  }

  const id = randomUUID();
  const email = `skill-handoff-${id}@example.test`;
  const password = `SkillHandoffA1!${id}`;
  const name = `Skill Handoff ${id}`;
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name, email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const { userId } = await registration.json() as { userId: string };

  await page.goto('/login?callbackUrl=%2Fsettings%3Ftab%3Dskills');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/settings\?tab=skills$/);
  await expect(page.getByRole('heading', { name: 'Neue Fähigkeit hinzufügen' })).toBeVisible();

  const writes: string[] = [];
  page.on('request', entry => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method())) writes.push(entry.url());
  });
  await page.goto(`/profile/${userId}`);
  const profileLink = page.getByRole('link', { name: 'Fähigkeiten ergänzen', exact: true });
  await expect(profileLink).toBeVisible();
  await profileLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\?tab=skills$/);
  await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true })).toBeVisible();

  await page.goto('/skills');
  const directoryLink = page.getByRole('link', { name: 'Eigene Fähigkeiten ergänzen' });
  await expect(directoryLink).toBeVisible();
  await directoryLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\?tab=skills$/);
  const skillsTab = page.getByRole('tab', { name: 'Fähigkeiten', exact: true });
  await expect(skillsTab).toHaveAttribute('aria-selected', 'true');
  await skillsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Zertifikate', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/settings\?tab=certificates$/);
  await page.goBack();
  await expect(skillsTab).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page.getByRole('tab', { name: 'Zertifikate', exact: true })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Konto', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unsaved handoff edit');
  await skillsTab.click();
  await page.goBack();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved handoff edit');
  expect(writes).toEqual([]);
});
