/** @jest-environment node */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, type AnyNode, type Rule } from 'postcss';

const root = path.resolve(__dirname, '..');
const stylesheet = parse(readFileSync(path.join(root, 'app/globals.css'), 'utf8'));
const selectors = [
  'progress.accent-progress',
  'progress.accent-progress::-webkit-progress-bar',
  'progress.accent-progress::-webkit-progress-value',
  'progress.accent-progress::-moz-progress-bar',
];

function mediaQueries(rule: Rule): string[] {
  const queries: string[] = [];
  for (let parent: AnyNode | undefined = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'media') queries.push(parent.params.replace(/\s/g, ''));
  }
  return queries;
}

function nativeRule(selector: string, mode: 'none' | 'active' = 'none'): Rule {
  const matches: Rule[] = [];
  stylesheet.walkRules((rule) => {
    if (rule.selector === selector && mediaQueries(rule).join() === `(forced-colors:${mode})`) matches.push(rule);
  });
  expect(matches).toHaveLength(1);
  return matches[0];
}

function declarations(rule: Rule): Record<string, string> {
  const values: Record<string, string> = {};
  rule.walkDecls((declaration) => {
    expect(declaration.important).toBeFalsy();
    values[declaration.prop] = declaration.value;
  });
  expect(rule.nodes.filter(node => node.type === 'decl')).toHaveLength(Object.keys(values).length);
  return values;
}

describe('native progress palette source contract', () => {
  // Source/compile assertions cannot establish native raster colors. Real
  // Chromium captures remain the visual verification gate. The separate
  // Firefox/WebKit smoke journeys do not run these forced-color native cases.
  it('opts only semantic native progress out of the default painted appearance', () => {
    expect(declarations(nativeRule(selectors[0]))).toEqual({
      '-webkit-appearance': 'none',
      appearance: 'none',
      'background-color': 'hsl(var(--muted))',
      color: 'hsl(var(--progress))',
    });
  });

  it('uses a quiet semantic track and petrol fill in separate engine rules', () => {
    expect(declarations(nativeRule(selectors[1]))).toEqual({ 'background-color': 'hsl(var(--muted))' });
    for (const selector of selectors.slice(2)) {
      expect(declarations(nativeRule(selector))).toEqual({ 'background-color': 'hsl(var(--progress))' });
    }
  });

  it('uses a user-adjustable Canvas/CanvasText pair and an inset empty-track contour', () => {
    expect(declarations(nativeRule(selectors[0], 'active'))).toEqual({
      '-webkit-appearance': 'none',
      appearance: 'none',
      'forced-color-adjust': 'auto',
      'background-color': 'Canvas',
      color: 'CanvasText',
      outline: '1px solid CanvasText',
      'outline-offset': '-1px',
    });
    expect(declarations(nativeRule(selectors[1], 'active'))).toEqual({ 'background-color': 'Canvas' });
    for (const selector of selectors.slice(2)) {
      expect(declarations(nativeRule(selector, 'active'))).toEqual({ 'background-color': 'CanvasText' });
    }
  });

  it('limits both branches to exact semantic native selectors without dimension or motion overrides', () => {
    const nativeSelectors: string[] = [];
    stylesheet.walkRules((rule) => {
      if (!rule.selector.includes('progress')) return;
      const queries = mediaQueries(rule);
      expect(queries).toHaveLength(1);
      expect(['(forced-colors:none)', '(forced-colors:active)']).toContain(queries[0]);
      nativeSelectors.push(`${queries[0]} ${rule.selector}`);
      const allowedProperties = queries[0] === '(forced-colors:active)' ? [
        '-webkit-appearance', 'appearance', 'forced-color-adjust', 'background-color', 'color', 'outline', 'outline-offset',
      ] : ['-webkit-appearance', 'appearance', 'background-color', 'color'];
      expect(Object.keys(declarations(rule)).every(property => allowedProperties.includes(property))).toBe(true);
    });
    expect(nativeSelectors.sort()).toEqual(['none', 'active'].flatMap(mode => selectors.map(selector => `(forced-colors:${mode}) ${selector}`)).sort());
  });

  it('does not opt the document, containers or native surfaces out of user color adjustment', () => {
    const adjustments: string[] = [];
    stylesheet.walkDecls('forced-color-adjust', declaration => {
      if (declaration.parent?.type === 'rule' && declaration.parent.selector === '.fc-navigation-icon::before') {
        // A monochrome mask needs paint; only its system-ink glyph opts out.
        expect(mediaQueries(declaration.parent)).toEqual(['(forced-colors:active)']);
        expect(declarations(declaration.parent)).toEqual({ 'forced-color-adjust': 'none', 'background-color': 'CanvasText' });
        return;
      }
      expect(declaration.value).toBe('auto');
      expect(declaration.parent).toBe(nativeRule(selectors[0], 'active'));
      adjustments.push(declaration.value);
    });
    expect(adjustments).toEqual(['auto']);
  });

  it.each([
    ['app/courses/pathways/PathwaysClient.tsx', 'h-3'],
    ['app/courses/journey/JourneyClient.tsx', 'h-2'],
    ['app/courses/goals/CourseGoalsClient.tsx', 'h-3'],
    ['components/community/StatsCard.tsx', 'h-2'],
    ['components/community/ContributionMilestonesCard.tsx', 'h-2'],
  ])('keeps %s connected to the native semantic rule', (file, height) => {
    const source = readFileSync(path.join(root, file), 'utf8');
    const progressElements = [...source.matchAll(/<progress\b[\s\S]*?<\/progress>/g)];
    expect(progressElements).toHaveLength(1);
    const progress = progressElements[0][0];
    expect(progress).toMatch(/\bvalue=\{/);
    expect(progress).toMatch(/\bmax=\{/);
    expect(progress).toMatch(/\baria-label=\{/);
    expect(progress).toMatch(new RegExp(`className="[^"]*\\b${height}\\b[^"\\n]*\\bw-full\\b[^"\\n]*\\baccent-progress\\b[^"\\n]*"`));
  });
});
