/** @jest-environment node */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = (name: string) => readFileSync(path.join(process.cwd(), name), 'utf8');
const css = source('app/home.module.css');
const illustration = source('components/landing/ForgeWorkbench.tsx');

it('uses the frozen semantic palette, paired art fills, scoped focus and flexible narrow-screen layout', () => {
  expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(\s*\d/gi);
  expect(css).not.toMatch(/gradient|@import|font-family|overflow(?:-x)?:\s*hidden|white-space:\s*nowrap/i);
  for (const token of ['background', 'foreground', 'primary', 'primary-foreground', 'coral-highlight', 'coral-highlight-foreground', 'reward', 'reward-foreground']) {
    expect(css).toContain(`var(--${token})`);
  }
  expect(css).toContain('.page a:focus-visible');
  expect(css).toContain('outline: 3px solid hsl(var(--ring))');
  expect(css).toContain('overflow-wrap: anywhere');
  expect(css).toContain('flex-wrap: wrap');
  expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  expect(css).toContain('@media (forced-colors: active)');
});

it('has only one finite, opt-in motion and no external illustration dependency', () => {
  expect(css.match(/animation:/g)).toHaveLength(1);
  expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.sparkPlaying\s*\{[^}]*animation: forgeSpark 850ms ease-out 1/);
  expect(css).not.toMatch(/infinite|transition:|scroll-behavior:/);
  expect(illustration).toContain('useState(0)');
  expect(illustration).toContain('disabled={reducedMotion}');
  expect(illustration).not.toMatch(/<image\b|<foreignObject\b|https?:|<animate\b|<script\b/);
});

it('adds real CI screenshots alongside the exact accessible landing heading contracts', () => {
  const browser = source('e2e/landing-home.pw.ts');
  expect(browser).toContain("['light', 'dark']");
  expect(browser).toContain("['guest', 'member']");
  expect(browser).toContain("fontSize = '200%'");
  expect(browser).toContain('fullPage: true');
  expect(browser).toContain("reducedMotion: 'reduce'");
  expect(browser).toContain("request.post(`${origin}/api/register`");
  expect(browser).not.toContain("page.route('**/api/auth/session'");
  // Playwright inserts spaces for BR in accessible names; textContent does not.
  const heading = 'Lernen. Machen. Weitergeben.';
  expect(source('e2e/route-sweep-manifest.ts')).toContain(`heading: '${heading}'`);
  for (const name of ['e2e/browser-qa.pw.ts', 'e2e/cross-engine.smoke.ts']) {
    expect(source(name)).toContain(`name: '${heading}', exact: true`);
  }
});
