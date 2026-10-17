/** @jest-environment node */
const { audit, composite, contrast, hexToRgb, hslToRgb, oklchToRgb, luminance, resolveColor, themes, utilityColor } = require('../scripts/check-color-contrast.js');

// Revision 2 of the agreed sRGB palette. Numeric HSL storage may round to three
// decimals, so assert channels to four decimal places, not textual HSL spelling.
const paletteHex = {
  light: {
    background: '#F6FAFB', foreground: '#142E3B', card: '#FFFFFF', 'card-foreground': '#142E3B', popover: '#FFFFFF', 'popover-foreground': '#142E3B',
    primary: '#075B63', 'primary-foreground': '#FFFFFF', progress: '#075B63', 'progress-foreground': '#FFFFFF', ring: '#075B63',
    secondary: '#F4F8FA', 'secondary-foreground': '#243F50', accent: '#E2F3F1', 'accent-foreground': '#075B63', muted: '#F0F5F8', 'muted-foreground': '#53697B',
    input: '#63868A', border: '#DDE9ED', coral: '#A54130', 'coral-foreground': '#FFFFFF', 'coral-highlight': '#EF8D75', 'coral-highlight-foreground': '#14343D',
    reward: '#F2C75C', 'reward-foreground': '#14343D', 'reward-ink': '#846112', info: '#126A7A', 'info-foreground': '#FFFFFF',
    warning: '#8B5A0A', 'warning-foreground': '#FFFFFF', success: '#1E7257', 'success-foreground': '#FFFFFF', destructive: '#B72E4A', 'destructive-foreground': '#FFFFFF',
    'chart-1': '#075B63', 'chart-2': '#A54130', 'chart-3': '#8B6A0C', 'chart-4': '#357D73', 'chart-5': '#52616B',
  },
  dark: {
    background: '#08252F', foreground: '#E8F5F2', card: '#10333D', 'card-foreground': '#E8F5F2', popover: '#10333D', 'popover-foreground': '#E8F5F2',
    primary: '#72D0CC', 'primary-foreground': '#08252F', progress: '#72D0CC', 'progress-foreground': '#08252F', ring: '#72D0CC',
    secondary: '#183E47', 'secondary-foreground': '#E8F5F2', accent: '#164B55', 'accent-foreground': '#A7E7E0', muted: '#183E47', 'muted-foreground': '#ADC8CA',
    input: '#83A7AB', border: '#365E68', coral: '#F3A18D', 'coral-foreground': '#08252F', 'coral-highlight': '#F3A18D', 'coral-highlight-foreground': '#08252F',
    reward: '#F2C75C', 'reward-foreground': '#08252F', 'reward-ink': '#F2C75C', info: '#82D5E4', 'info-foreground': '#08252F',
    warning: '#F0C270', 'warning-foreground': '#08252F', success: '#8BD8AF', 'success-foreground': '#08252F', destructive: '#FF8AA4', 'destructive-foreground': '#08252F',
    'chart-1': '#72D0CC', 'chart-2': '#F3A18D', 'chart-3': '#F2C75C', 'chart-4': '#9BC8B0', 'chart-5': '#B7C6D3',
  },
};

// Explicit inventory is independent of audit()'s emitted results. Removing a
// pair from the script cannot turn its missing coverage into a passing test.
const expectedPairNames = [
  ...['background', 'card', 'popover', 'secondary', 'muted', 'accent', 'primary', 'destructive', 'progress', 'coral', 'coral-highlight', 'reward', 'info', 'warning', 'success'].map(role => `${role} text`),
  ...['background', 'card', 'muted', 'popover', 'accent', 'secondary'].map(surface => `muted text on ${surface}`),
  ...['background', 'card', 'popover', 'muted', 'accent', 'secondary'].flatMap(surface => ['input boundary', 'focus ring', 'link text', 'reward ink'].map(role => `${role} on ${surface}`)),
  ...['background', 'card', 'popover', 'muted'].flatMap(surface => [...['success', 'destructive', 'info', 'warning', 'coral'].map(role => `${role} text on ${surface}`), `progress indicator on ${surface}`]),
  ...['background', 'card'].flatMap(surface => [1, 2, 3, 4, 5].map(index => `chart ${index} stroke on ${surface}`)),
  ...['primary', 'destructive'].flatMap(role => ['button', 'badge'].flatMap(component => [`${role} ${component} hover`, ...['background', 'muted', 'accent', 'secondary'].map(surface => `${role} ${component} hover on ${surface}`)])),
  'selected navigation text', 'selected navigation icon', 'selected tab text', 'post like hover on muted footer', 'selected comment like text', 'selected comment like hover', 'comment body translucent text', 'logout destructive focus text',
  'disabled button text (voluntary inactive target)', 'loading button text', 'notification deletion hover text',
  'profile validation message', 'correct quiz answer', 'incorrect quiz answer', 'notification count', 'toast close icon', 'destructive toast close icon', 'destructive toast close hover icon', 'destructive toast close focus ring',
];

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
    const red500 = resolveColor('red-500', {});
    [0.98266, 0.17180, 0.21307].forEach((channel, index) => {
      expect(red500[index]).toBeCloseTo(channel, 4);
    });
    oklchToRgb('oklch(0% 0 0)').forEach((channel) => expect(channel).toBeCloseTo(0, 7));
    oklchToRgb('oklch(100% 0 0)').forEach((channel) => expect(channel).toBeCloseTo(1, 7));
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
    expect(expectedPairNames).toHaveLength(118);
    for (const mode of ['light', 'dark']) {
      const names = results.filter(result => result.mode === mode).map(result => result.name);
      expect(new Set(names).size).toBe(names.length);
      expect(names.sort()).toEqual([...expectedPairNames].sort());
    }
    expect(results).toHaveLength(236);
  });

  it('retains the exact agreed theme-specific sRGB roles, including text-only reward ink', () => {
    const tokens = themes();
    for (const mode of ['light', 'dark']) {
      for (const [role, hex] of Object.entries(paletteHex[mode])) {
        expect(tokens[mode]).toHaveProperty(role);
        hexToRgb(hex).forEach((channel, index) => {
          expect(tokens[mode][role][index]).toBeCloseTo(channel, 4);
        });
      }
      expect(tokens[mode].progress).toEqual(tokens[mode].primary);
      expect(tokens[mode]['progress-foreground']).toEqual(tokens[mode]['primary-foreground']);
      expect(tokens[mode].warning).not.toEqual(tokens[mode].reward);
      expect(tokens[mode].coral).not.toEqual(tokens[mode].destructive);
    }
  });
});
