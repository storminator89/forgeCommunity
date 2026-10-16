import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

test('Skills workbench persists real own CRUD, discovers people and preserves profile/settings handoffs', async ({ page, request }, testInfo) => {
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Skills workbench QA requires a loopback server and its explicitly disposable SQLite fixture database.');
  }

  const id = randomUUID();
  const email = `skills-workbench-${id}@example.test`;
  const password = `SkillsWorkbenchA1!${id}`;
  const memberName = `Skills Fixture ${id}`;
  const skillName = `Moderation-${id}`;
  const created = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: memberName, email, password },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { userId } = await created.json() as { userId: string };
  await page.goto('/login?callbackUrl=%2Fskills');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/skills$/);
  await expect(page.getByRole('heading', { name: 'Skill-Verzeichnis', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const communityTab = page.getByRole('tab', { name: 'Community', exact: true });
  const ownTab = page.getByRole('tab', { name: 'Meine Fähigkeiten', exact: true });
  await communityTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ownTab).toBeFocused();
  await expect(page).toHaveURL(/view=mine/);
  await expect(ownTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Womit kennst du dich aus?', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Fähigkeit hinzufügen', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Fähigkeit hinzufügen', exact: true });
  await dialog.getByRole('button', { name: 'Neu erstellen', exact: true }).click();
  await dialog.getByLabel('Name der Fähigkeit', { exact: true }).fill(skillName);
  await dialog.getByLabel('Kategorie', { exact: true }).fill('Zusammenarbeit');
  await dialog.getByLabel('Selbsteinschätzung (0–100%)', { exact: true }).fill('81');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: skillName, exact: true }) });
  await expect(row).toContainText('Selbsteinschätzung 81%');
  let ownResponse = await page.request.get(`${origin}/api/user/skills`);
  expect(ownResponse.headers()['cache-control']).toBe('private, no-store');
  const ownRows = await ownResponse.json() as { id: string; skillId: string; level: number; skill: { name: string } }[];
  const owned = ownRows.find(entry => entry.skill.name === skillName)!;
  expect(owned.level).toBe(81);

  await row.getByRole('button', { name: `${skillName} bearbeiten`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Fähigkeit bearbeiten', exact: true });
  await expect(dialog.getByLabel('Selbsteinschätzung (0–100%)', { exact: true })).toHaveValue('81');
  await dialog.getByLabel('Selbsteinschätzung (0–100%)', { exact: true }).fill('82');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Selbsteinschätzung 82%');
  await page.reload();
  await expect(ownTab).toHaveAttribute('aria-selected', 'true');
  await expect(row).toContainText('Selbsteinschätzung 82%');
  ownResponse = await page.request.get(`${origin}/api/user/skills`);
  expect((await ownResponse.json() as { id: string; level: number }[]).find(entry => entry.id === owned.id)?.level).toBe(82);

  // A cancelled edit writes nothing and restores the initiating control.
  await row.getByRole('button', { name: `${skillName} bearbeiten`, exact: true }).click();
  await page.getByLabel('Selbsteinschätzung (0–100%)', { exact: true }).fill('10');
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: `${skillName} bearbeiten`, exact: true })).toBeFocused();
  await expect(row).toContainText('Selbsteinschätzung 82%');

  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme);
    await page.reload();
    await expect(row).toContainText('Selbsteinschätzung 82%');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const controls = [ownTab, page.getByRole('button', { name: 'Fähigkeit hinzufügen', exact: true })];
    for (const control of controls) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`skills-own-${theme}.png`), fullPage: true });
  }

  await communityTab.click();
  await page.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen', exact: true }).fill(skillName);
  const catalogSummary = page.locator('summary').filter({ hasText: 'Fähigkeiten entdecken' });
  await catalogSummary.focus(); await page.keyboard.press('Enter');
  const discover = page.getByRole('button', { name: `${skillName}: 1 Mitglied finden`, exact: true });
  await expect(discover).toBeVisible();
  await discover.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen', exact: true })).toBeFocused();
  await catalogSummary.click();
  const member = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: memberName, exact: true }) });
  await expect(member).toContainText('82%');
  await member.getByRole('button', { name: 'Details anzeigen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: memberName, exact: true })).toContainText('Selbsteinschätzungen');
  await page.keyboard.press('Escape');
  await expect(member.getByRole('button', { name: 'Details anzeigen', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('skills-community.png'), fullPage: true });

  await member.getByRole('link', { name: memberName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${userId}$`));
  const profileSkills = page.getByRole('region', { name: 'Skills', exact: true });
  await expect(profileSkills).toContainText(skillName);
  await expect(profileSkills).toContainText('Selbsteinschätzung 82%');
  await page.goto('/settings?tab=skills');
  await page.getByRole('link', { name: 'Im Skills-Bereich verwalten', exact: true }).click();
  await expect(ownTab).toHaveAttribute('aria-selected', 'true');
  await expect(row).toContainText('Selbsteinschätzung 82%');
  await expect(page.getByRole('link', { name: 'Kurse entdecken', exact: true })).toHaveAttribute('href', '/courses');
  await expect(page.getByRole('link', { name: 'Meine Zertifikate', exact: true })).toHaveAttribute('href', '/settings?tab=certificates');

  await row.getByRole('button', { name: `${skillName} entfernen`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Fähigkeit entfernen?', exact: true });
  await expect(dialog).toContainText('Skill-Empfehlungen gehen verloren');
  await dialog.getByRole('button', { name: 'Behalten', exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `${skillName} entfernen`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Fähigkeit entfernen', exact: true }).click();
  await expect(row).toHaveCount(0);
  const finalRows = await (await page.request.get(`${origin}/api/user/skills`)).json() as { id: string }[];
  expect(finalRows.some(entry => entry.id === owned.id)).toBe(false);
});
