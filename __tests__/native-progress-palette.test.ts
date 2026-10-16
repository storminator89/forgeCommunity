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

function nativeRule(selector: string): Rule {
  const matches: Rule[] = [];
  stylesheet.walkRules((rule) => {
    if (rule.selector === selector) matches.push(rule);
  });
  expect(matches).toHaveLength(1);
  return matches[0];
}

function declarations(rule: Rule): Record<string, string> {
  const values: Record<string, string> = {};
  rule.walkDecls((declaration) => {
    values[declaration.prop] = declaration.value;
  });
  return values;
}

describe('native progress palette source contract', () => {
  // Source/compile assertions cannot establish native raster colors. Real
  // Chromium/WebKit/Firefox captures remain the visual verification gate.
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

  it('leaves forced-color native painting and existing dimensions and motion alone', () => {
    const nativeSelectors: string[] = [];
    stylesheet.walkRules((rule) => {
      if (!rule.selector.includes('progress')) return;
      nativeSelectors.push(rule.selector);
      let unforcedOnly = false;
      for (let parent: AnyNode | undefined = rule.parent; parent; parent = parent.parent) {
        if (parent.type === 'atrule' && parent.name === 'media' && parent.params.replace(/\s/g, '') === '(forced-colors:none)') unforcedOnly = true;
      }
      expect(unforcedOnly).toBe(true);
      expect(Object.keys(declarations(rule)).every((property) => [
        '-webkit-appearance', 'appearance', 'background-color', 'color',
      ].includes(property))).toBe(true);
    });
    expect(nativeSelectors.sort()).toEqual([...selectors].sort());
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
