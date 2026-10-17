import { expect, type Page } from '@playwright/test';

/** Change the real browser-local preference through its single Settings UI. */
export async function setSparkInSettings(page: Page, visible: boolean) {
  await page.goto('/settings?tab=account');
  const control = page.getByRole('switch', { name: 'Spark anzeigen', exact: true });
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute('aria-checked', /^(true|false)$/);
  if (await control.getAttribute('aria-checked') !== String(visible)) {
    await control.focus();
    await page.keyboard.press('Space');
    await expect(control).toBeFocused();
  }
  await expect(control).toHaveAttribute('aria-checked', String(visible));
}
