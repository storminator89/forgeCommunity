/** @jest-environment node */
const { audit, composite, contrast, hslToRgb, luminance, resolveColor, utilityColor } = require('../scripts/check-color-contrast.js');

describe('WCAG sRGB contrast arithmetic', () => {
  it('matches the black/white extrema and the sRGB transfer-function threshold', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([1, 1, 1])).toBe(1);
    expect(contrast([0, 0, 0], [1, 1, 1])).toBe(21);
    expect(contrast([1, 1, 1], [0, 0, 0])).toBe(21);
    expect(contrast([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toBe(1);
    expect(luminance([0.04045, 0.04045, 0.04045])).toBeCloseTo(0.04045 / 12.92, 10);
  });

  it('converts token HSL and composites translucent backgrounds in sRGB', () => {
    expect(hslToRgb('0 0% 100%')).toEqual([1, 1, 1]);
    expect(hslToRgb('120 100% 50%')).toEqual([0, 1, 0]);
    expect(hslToRgb('240 100% 50%')).toEqual([0, 0, 1]);
    expect(composite([1, 0, 0], [0, 0, 1], 0.25)).toEqual([0.25, 0, 0.75]);
  });

  it('uses installed Tailwind colors and mode-specific text utilities', () => {
    expect(resolveColor('white', {})).toEqual([1, 1, 1]);
    expect(resolveColor('red-500', {})).toEqual([239 / 255, 68 / 255, 68 / 255]);
    expect(utilityColor('text-sm text-green-700 dark:text-green-400', 'text', 'light')).toBe('green-700');
    expect(utilityColor('text-sm text-green-700 dark:text-green-400', 'text', 'dark')).toBe('green-400');
  });

  it('detects the previous light input boundary failure without rounding up', () => {
    const ratio = contrast(hslToRgb('42 12% 55%'), hslToRgb('42 31% 97%'));
    expect(ratio).toBeCloseTo(2.9277, 3);
    expect(ratio).toBeLessThan(3);
  });
});

describe('measured shared tokens and visible component color pairings', () => {
  const results = audit();
  test.each(results)('$mode $name: $foreground against $background', ({ ratio, minimum }) => {
    expect(ratio).toBeGreaterThanOrEqual(minimum);
  });

  test.each(results.filter(result => result.name.startsWith('input boundary')))('$mode $name retains the design-system 3.2:1 reserve', ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(3.2);
  });

  it('covers both themes with the same curated source pairings', () => {
    expect(results.filter(result => result.mode === 'light').map(result => result.name))
      .toEqual(results.filter(result => result.mode === 'dark').map(result => result.name));
    expect(results).toHaveLength(52);
  });
});
