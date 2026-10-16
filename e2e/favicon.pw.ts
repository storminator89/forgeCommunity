import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const expectedIcon = readFileSync(path.resolve(__dirname, '../app/icon.svg'), 'utf8');

for (const colorScheme of ['light', 'dark'] as const) {
  test(`serves one scalable ForgeCommunity favicon in ${colorScheme} mode`, async ({ page, request }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');

    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute('type', 'image/svg+xml');
    await expect(icon).toHaveAttribute('sizes', 'any');
    const href = await icon.getAttribute('href');
    expect(href).toBeTruthy();
    const iconURL = new URL(href!, page.url());
    expect(iconURL.origin).toBe(new URL(page.url()).origin);
    expect(iconURL.pathname).toBe('/icon.svg');

    // Fetch the actual generated metadata href, including Next's cache key.
    const response = await request.get(iconURL.href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\/svg\+xml(?:;|$)/i);
    const markup = await response.text();
    expect(markup).toBe(expectedIcon);
    const svg = await page.evaluate((source) => {
      const document = new DOMParser().parseFromString(source, 'image/svg+xml');
      const icon = document.documentElement;
      return {
        parserError: Boolean(document.querySelector('parsererror')),
        name: icon.localName,
        viewBox: icon.getAttribute('viewBox'),
        width: icon.getAttribute('width'),
        height: icon.getAttribute('height'),
        title: icon.querySelector('title')?.textContent,
        shapes: icon.querySelectorAll('path').length,
        activeContent: icon.querySelectorAll('script, foreignObject, image, use, style, animate, animateTransform, set').length,
      };
    }, markup);
    expect(svg).toEqual({
      parserError: false,
      name: 'svg',
      viewBox: '0 0 32 32',
      width: '32',
      height: '32',
      title: 'ForgeCommunity',
      shapes: 3,
      activeContent: 0,
    });

    // Browser tabs are outside Playwright's page screenshot. Instead render
    // the real served asset at native 16/32px on the two app canvas colors.
    await page.setContent('<main aria-label="Favicon at native sizes"></main>');
    await page.locator('main').evaluate((element, { href, colorScheme }) => {
      const panel = element as HTMLElement;
      panel.style.cssText = `display:flex;gap:24px;align-items:center;padding:24px;background:${colorScheme === 'dark' ? '#08252F' : '#EFF8F6'};width:max-content`;
      for (const size of [16, 32]) {
        const image = document.createElement('img');
        image.src = href;
        image.alt = `ForgeCommunity ${size}px`;
        image.width = size;
        image.height = size;
        panel.append(image);
      }
    }, { href: iconURL.href, colorScheme });
    for (const image of await page.locator('main img').all()) {
      await expect.poll(() => image.evaluate(element => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth === 32 && image.naturalHeight === 32;
      })).toBe(true);
    }
    await testInfo.attach(`favicon-native-sizes-${colorScheme}`, {
      body: await page.locator('main').screenshot(),
      contentType: 'image/png',
    });
  });
}
