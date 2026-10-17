import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import Link from 'next/link';
import { NavigationArtwork } from '@/components/navigation-artwork';
import { ForgeBrandMark } from '@/components/forge-brand-mark';
import { adminNavigation, moderationNavigation, navigationGroups, utilityNavigation } from '@/lib/navigation';
import { navigationArtwork, navigationArtworkSource } from '@/lib/navigation-artwork';

const menuItems = [...navigationGroups.flatMap(group => group.items), ...utilityNavigation, ...moderationNavigation, ...adminNavigation];

test('every existing role-specific menu entry has generated artwork, including aliases', () => {
  for (const item of menuItems) {
    expect(navigationArtworkSource(item.href)).toMatch(/^\/images\/navigation\/[a-z-]+\.webp$/);
  }
  expect(navigationArtworkSource('/projects')).toBe(navigationArtworkSource('/showcases'));
  expect(navigationArtworkSource('/admin/learning-pathways')).toBe(navigationArtworkSource('/courses/pathways'));
  expect(navigationArtworkSource('/community/saved')).toContain('/saved.webp');
  expect(navigationArtworkSource('/community/unread')).toContain('/unread.webp');
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
  expect(sources).toHaveLength(22);
  expect(total).toBeLessThan(180 * 1024);
});

test('navigation artwork is decorative and occupies a stable 28px box', () => {
  const { container } = render(<NavigationArtwork href="/community" fallback={<span>Fallback</span>} />);
  const image = container.querySelector('img')!;
  expect(image).toHaveAttribute('src', '/images/navigation/community.webp');
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('aria-hidden', 'true');
  expect(image).toHaveAttribute('width', '28');
  expect(image).toHaveAttribute('height', '28');
  expect(image).toHaveClass('h-7', 'w-7', 'shrink-0');
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
