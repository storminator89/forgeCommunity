import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import { crossEngineFixtureOrigin } from './cross-engine-fixture';

async function expectArtwork(image: Locator, size: number, naturalSize: number) {
  await expect(image).toHaveCount(1);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(element => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  })).toBe(true);
  await expect(image).toHaveAttribute('alt', '');
  await expect(image).toHaveAttribute('aria-hidden', 'true');
  const pixels = await image.evaluate(element => {
    const image = element as HTMLImageElement;
    const rect = image.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const alpha = [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]]
      .map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
    return { width: rect.width, height: rect.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, alpha };
  });
  expect(pixels).toEqual({ width: size, height: size, naturalWidth: naturalSize, naturalHeight: naturalSize, alpha: [0, 0, 0, 0] });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`generated brand and navigation remain legible, labelled and usable in ${colorScheme} mode`, async ({ page, request }, testInfo) => {
    // Validate the real isolated loopback/disposable fixture before any account request.
    const origin = crossEngineFixtureOrigin();
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const route of ['/', '/login', '/register']) {
      await page.goto(route);
      const brand = page.getByRole('link', { name: 'ForgeCommunity Startseite', exact: true });
      await expect(brand).toContainText('ForgeCommunity');
      await expectArtwork(brand.locator('img'), 36, 128);
      await testInfo.attach(`brand-${route === '/' ? 'landing' : route.slice(1)}-${colorScheme}`, { body: await brand.screenshot(), contentType: 'image/png' });
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

    const mobile = testInfo.project.name.startsWith('mobile-');
    const menu = page.getByRole('button', { name: 'Navigation öffnen', exact: true });
    if (mobile) await menu.click();
    const shell = mobile ? page.getByRole('dialog', { name: 'Navigation', exact: true }) : page.locator('#app-navigation-rail');
    const navigation = shell.getByRole('navigation', { name: 'Hauptnavigation' });
    await expectArtwork(shell.getByRole('link', { name: 'ForgeCommunity Start', exact: true }).locator('img'), 36, 128);
    for (const link of await navigation.getByRole('link').all()) {
      await expect(link).toHaveAccessibleName(/\S/);
      await expectArtwork(link.locator('img'), 28, 96);
      expect(await link.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await expect(navigation.getByRole('link', { name: 'Community', exact: true })).toHaveAttribute('aria-current', 'page');
    await testInfo.attach(`sidebar-expanded-${colorScheme}`, { body: await shell.screenshot(), contentType: 'image/png' });

    if (!mobile) {
      await shell.getByRole('button', { name: 'Navigation einklappen' }).click();
      await expect(shell).toHaveCSS('width', '88px');
      await expect(navigation.getByRole('link', { name: 'Community', exact: true })).toHaveAttribute('aria-label', 'Community');
      await expectArtwork(navigation.getByRole('link', { name: 'Community', exact: true }).locator('img'), 28, 96);
      await testInfo.attach(`sidebar-collapsed-${colorScheme}`, { body: await shell.screenshot(), contentType: 'image/png' });
      await shell.getByRole('button', { name: 'Navigation erweitern' }).click();
      await expect(shell).toHaveCSS('width', '252px');
    }

    const search = shell.getByRole('button', { name: 'Schnellsuche öffnen' });
    await expectArtwork(search.locator('img'), 28, 96);
    await search.click();
    const dialog = page.getByRole('dialog', { name: 'Schnell zum Ziel', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' })).toBeFocused();
    await expectArtwork(dialog.getByRole('button', { name: 'Community', exact: true }).locator('img'), 28, 96);
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
