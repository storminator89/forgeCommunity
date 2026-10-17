import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type TestInfo } from '@playwright/test';
import { crossEngineFixtureOrigin } from './cross-engine-fixture';

async function expectArtwork(image: Locator, size: number, _naturalSize: number) {
  await expect(image).toHaveCount(1);
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute('aria-hidden', 'true');
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBe(size);
  expect(box!.height).toBe(size);
}

async function captureArtwork(target: Locator, testInfo: TestInfo, name: string) {
  // The workflow uploads output-directory PNGs; body-only attachments are not files there.
  const path = testInfo.outputPath(`${name}.png`);
  await target.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`original brand and custom outline navigation remain legible, labelled and usable in ${colorScheme} mode`, async ({ page, request }, testInfo) => {
    // Validate the real isolated loopback/disposable fixture before any account request.
    const origin = crossEngineFixtureOrigin();
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const route of ['/', '/login', '/register']) {
      await page.goto(route);
      const brand = page.getByRole('link', { name: 'ForgeCommunity Startseite', exact: true });
      await expect(brand).toContainText('ForgeCommunity');
      await expectArtwork(brand.locator('img'), 36, 128);
      await captureArtwork(brand, testInfo, `brand-${route === '/' ? 'landing' : route.slice(1)}-${colorScheme}`);
    }

    const id = randomUUID();
    const email = `sidebar-artwork-${id}@example.test`;
    const password = `SidebarArtwork1!${id}`;
    const registered = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Sidebar Artwork QA', email, password } });
    expect(registered.status(), await registered.text()).toBe(201);
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByLabel('Passwort', { exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/community$/);

    // Community first mounts a loading shell, then replaces it when the session resolves.
    // Require the real loaded feed and its signed-in sidebar before touching either shell.
    const main = page.locator('#page-content');
    await expect(main.getByRole('heading', { name: 'Aktuelle Beiträge', exact: true })).toBeVisible();
    await expect(main.getByText(/^\d+ (?:Beitrag|Beiträge) geladen$/)).toBeVisible();
    await expect(page.locator('#app-navigation-rail').getByText('Sidebar Artwork QA', { exact: true })).toHaveCount(1);

    const mobile = testInfo.project.name.startsWith('mobile-');
    const menu = page.getByRole('button', { name: 'Navigation öffnen', exact: true });
    if (mobile) await menu.click();
    const shell = mobile ? page.getByRole('dialog', { name: 'Navigation', exact: true }) : page.locator('#app-navigation-rail');
    const navigation = shell.getByRole('navigation', { name: 'Hauptnavigation' });
    await expectArtwork(shell.getByRole('link', { name: 'ForgeCommunity Start', exact: true }).locator('img'), 36, 128);
    for (const link of await navigation.getByRole('link').all()) {
      await expect(link).toHaveAccessibleName(/\S/);
      await expectArtwork(link.locator('[data-navigation-icon]'), 22, 96);
      expect(await link.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await expect(navigation.getByRole('link', { name: 'Community', exact: true })).toHaveAttribute('aria-current', 'page');
    await captureArtwork(shell, testInfo, `sidebar-expanded-${colorScheme}`);

    if (!mobile) {
      await shell.getByRole('button', { name: 'Navigation einklappen' }).click();
      await expect(shell).toHaveCSS('width', '88px');
      await expect(navigation.getByRole('link', { name: 'Community', exact: true })).toHaveAttribute('aria-label', 'Community');
      await expectArtwork(navigation.getByRole('link', { name: 'Community', exact: true }).locator('[data-navigation-icon]'), 22, 96);
      await captureArtwork(shell, testInfo, `sidebar-collapsed-${colorScheme}`);
      await shell.getByRole('button', { name: 'Navigation erweitern' }).click();
      await expect(shell).toHaveCSS('width', '264px');
    }

    const search = shell.getByRole('button', { name: 'Schnellsuche öffnen' });
    await expectArtwork(search.locator('[data-navigation-icon]'), 16, 96);
    await search.click();
    const dialog = page.getByRole('dialog', { name: 'Schnell zum Ziel', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' })).toBeFocused();
    await expectArtwork(dialog.getByRole('button', { name: 'Community', exact: true }).locator('[data-navigation-icon]'), 16, 96);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(search).toBeFocused();
    if (mobile) {
      await page.keyboard.press('Escape');
      await expect(shell).toBeHidden();
      await expect(menu).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
