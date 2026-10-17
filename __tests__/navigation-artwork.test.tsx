import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { render } from '@testing-library/react';
import Link from 'next/link';
import { NavigationArtwork } from '@/components/navigation-artwork';
import { ForgeBrandMark } from '@/components/forge-brand-mark';
import { adminNavigation, moderationNavigation, navigationGroups, utilityNavigation } from '@/lib/navigation';
import { navigationArtwork, navigationArtworkSource } from '@/lib/navigation-artwork';

const menuItems = [...navigationGroups.flatMap(group => group.items), ...utilityNavigation, ...moderationNavigation, ...adminNavigation];

test('every existing role-specific menu entry has generated artwork, including aliases', () => {
  for (const item of menuItems) {
    expect(navigationArtworkSource(item.href)).toMatch(/^\/images\/navigation\/outline-v2\/[a-z-]+\.webp$/);
  }
  expect(navigationArtworkSource('/projects')).toBe(navigationArtworkSource('/showcases'));
  expect(navigationArtworkSource('/admin/learning-pathways')).toBe(navigationArtworkSource('/courses/pathways'));
  expect(navigationArtworkSource('/community/saved')).toContain('/saved.webp');
  expect(navigationArtworkSource('/community/unread')).toContain('/notifications.webp');
  expect(navigationArtworkSource('/future-section')).toBeUndefined();
  expect(navigationArtworkSource('toString')).toBeUndefined();
});

test('the generated subjects distinguish previously duplicated generic symbols', () => {
  expect(navigationArtworkSource('/community')).not.toBe(navigationArtworkSource('/members'));
  expect(navigationArtworkSource('/members')).not.toBe(navigationArtworkSource('/admin/users'));
  expect(navigationArtworkSource('/community/missions')).not.toBe(navigationArtworkSource('/moderation'));
  expect(navigationArtworkSource('/knowledgebase/drafts')).not.toBe(navigationArtworkSource('/community/saved'));
});

test('all shipped artwork is compact lossless WebP with alpha and fixed intrinsic dimensions', () => {
  const sources = [...new Set(Object.keys(navigationArtwork).map(href => navigationArtworkSource(href)!)), '/images/brand/forge-community-mark.webp'];
  let total = 0;
  for (const source of sources) {
    const bytes = readFileSync(path.join(process.cwd(), 'public', source));
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    expect(bytes.toString('ascii', 12, 16)).toBe('VP8L');
    expect(bytes[20]).toBe(0x2f);
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
    const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0xf) << 10));
    expect([width, height]).toEqual(source.includes('/brand/') ? [128, 128] : [96, 96]);
    expect(bytes[24] & 0x10).toBe(0x10);
    expect(bytes.length).toBeLessThan(12 * 1024);
    total += bytes.length;
  }
  expect(sources).toHaveLength(21);
  expect(total).toBeLessThan(180 * 1024);
});

test('generated outlines use a decorative current-color alpha mask', () => {
  const { container } = render(<NavigationArtwork href="/community" fallback={<span>Fallback</span>} />);
  const icon = container.querySelector('[data-navigation-icon]')!;
  expect(icon).toHaveAttribute('data-navigation-icon', '/images/navigation/outline-v2/community.webp');
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon).toHaveClass('fc-navigation-icon');
  expect(icon).toHaveStyle({ '--navigation-icon': 'url("/images/navigation/outline-v2/community.webp")' });
  expect(container.querySelector('img,svg')).toBeNull();
  expect(container).not.toHaveTextContent('Fallback');
});

test('a future unmapped item retains its supplied conventional fallback', () => {
  const { container } = render(<NavigationArtwork href="/future-section" fallback={<span>Fallback</span>} />);
  expect(container).toHaveTextContent('Fallback');
  expect(container.querySelector('img')).toBeNull();
});

test('the compact brand is decorative beside its separate readable wordmark', () => {
  const { container } = render(<Link href="/" aria-label="ForgeCommunity Startseite"><ForgeBrandMark />ForgeCommunity</Link>);
  const image = container.querySelector('img')!;
  expect(image).toHaveAttribute('src', '/images/brand/forge-community-mark.webp');
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('aria-hidden', 'true');
  expect(image).toHaveAttribute('width', '36');
  expect(image).toHaveAttribute('height', '36');
  expect(container.querySelector('a')).toHaveAccessibleName('ForgeCommunity Startseite');
  expect(container).toHaveTextContent('ForgeCommunity');
});


async function visibleBounds(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 8) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, canvasWidth: info.width, canvasHeight: info.height };
}

test('individual exports keep complete non-square silhouettes and a transparent safety gutter', async () => {
  for (const name of new Set(Object.values(navigationArtwork))) {
    const original = await visibleBounds(path.join(process.cwd(), 'assets/source/navigation-outline/individual', name + '.png'));
    const exported = await visibleBounds(path.join(process.cwd(), 'public/images/navigation/outline-v2', name + '.webp'));
    expect(original.width).toBeGreaterThan(0);
    expect(Math.min(original.left, original.top, original.canvasWidth - original.right - 1, original.canvasHeight - original.bottom - 1)).toBeGreaterThan(20);
    expect(Math.min(exported.left, exported.top, 95 - exported.right, 95 - exported.bottom)).toBeGreaterThanOrEqual(8);
    // A default square cover resize cuts the case and conversation bubbles.
    // Their visible proportions must survive the export, within pixel rounding.
    expect(Math.abs(Math.log((exported.width / exported.height) / (original.width / original.height)))).toBeLessThan(.08);
  }
});
