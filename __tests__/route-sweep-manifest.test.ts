import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { routeSweepCases } from '../e2e/route-sweep-manifest';

function pages(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name === 'page.tsx' ? [relative(process.cwd(), path).split(sep).join('/')] : [];
  });
}

describe('route-by-route browser review inventory', () => {
  it('accounts for every page.tsx independently', () => {
    const sources = routeSweepCases.map(item => item.source);
    expect(sources).toHaveLength(34);
    expect(sources).not.toContain('app/projects/[id]test/page.tsx');
    expect(new Set(sources).size).toBe(sources.length);
    expect(sources.sort()).toEqual(pages(join(process.cwd(), 'app')).sort());
  });

  it('distinguishes rendered pages from redirects and synthetic API fixtures', () => {
    expect(new Set(routeSweepCases.map(item => item.url)).size).toBe(routeSweepCases.length);
    for (const item of routeSweepCases) {
      expect(item.url).toMatch(/^\//);
      if (item.outcome === 'redirect') {
        expect(item.evidence).toBe('redirect-only');
        expect(item.redirectTo).toMatch(/^\//);
        expect(item.heading).toBeUndefined();
      } else {
        expect(item.heading).toBeTruthy();
        expect(item.redirectTo).toBeUndefined();
      }
      if (item.url.includes('qa-route-') && item.outcome === 'render') {
        expect(['synthetic-api', 'disposable-db']).toContain(item.evidence);
      }
      if (item.evidence === 'shared-disposable-db') {
        expect(item.settledApi).toMatch(/^\/api\//);
        expect(item.loadingText).toBeTruthy();
      }
    }
  });
});
