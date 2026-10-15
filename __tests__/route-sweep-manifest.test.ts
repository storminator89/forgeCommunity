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
    expect(sources).toHaveLength(42);
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
        expect(routeSweepCases.some(candidate =>
          candidate.outcome === 'render' && candidate.url === item.redirectTo
        )).toBe(true);
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

  it('checks the private author list as a real rendered page', () => {
    expect(routeSweepCases.find(item => item.url === '/courses/authoring')).toMatchObject({
      source: 'app/courses/authoring/page.tsx', persona: 'member', outcome: 'render',
      heading: 'Meine Kursentwürfe', evidence: 'account-empty-disposable-db',
      settledText: 'Noch keine Kursentwürfe',
    });
  });

  it('keeps the static pathway directory separate from the dynamic course and pathway routes', () => {
    expect(routeSweepCases.find(item => item.url === '/courses/pathways')).toMatchObject({
      source: 'app/courses/pathways/page.tsx', persona: 'member', outcome: 'render',
      heading: 'Lernpfade', evidence: 'shared-disposable-db', settledApi: '/api/learning-pathways/me',
      settledText: 'Verfügbare Lernpfade',
    });
    expect(routeSweepCases.find(item => item.url === '/admin/learning-pathways')).toMatchObject({
      source: 'app/admin/learning-pathways/page.tsx', persona: 'admin', outcome: 'render',
      heading: 'Lernpfade verwalten', evidence: 'shared-disposable-db', settledApi: '/api/admin/learning-pathways',
      settledText: 'Bestehende Lernpfade',
    });
    expect(routeSweepCases.find(item => item.url === '/courses/pathways/qa-route-pathway')).toMatchObject({
      source: 'app/courses/pathways/[pathwayId]/page.tsx', persona: 'member', outcome: 'render',
      heading: 'Mein Lernpfad', evidence: 'synthetic-api',
    });
  });
});
