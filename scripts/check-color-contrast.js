#!/usr/bin/env node
// Source-level regression check, not a browser audit or WCAG conformance claim.
// Criteria/formula: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
// Non-text controls: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const colors = require('tailwindcss/colors');

const root = path.resolve(__dirname, '..');
const referenceIndex = process.argv.indexOf('--ref');
const reference = referenceIndex < 0 ? undefined : process.argv[referenceIndex + 1];
if (referenceIndex >= 0 && !reference) throw new Error('--ref requires a Git revision');
const read = (file) => reference
  ? execFileSync('git', ['show', `${reference}:${file}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');

function hslToRgb(value) {
  const [hue, saturation, lightness] = value.split(/\s+/).map(parseFloat);
  const h = hue / 60;
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const segments = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  return segments[Math.floor(h) % 6].map((channel) => channel + m);
}

function luminance(rgb) {
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function composite(foreground, background, opacity) {
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity));
}

function themes() {
  const css = read('app/globals.css');
  return Object.fromEntries([['light', ':root'], ['dark', '.dark']].map(([mode, selector]) => {
    const start = css.indexOf(`${selector} {`);
    const block = css.slice(start, css.indexOf('}', start));
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([\d.]+ [\d.]+% [\d.]+%);/g)].map((match) => [match[1], hslToRgb(match[2])]));
    if (!tokens.background) throw new Error(`Missing ${mode} theme`);
    return [mode, tokens];
  }));
}

function resolveColor(name, tokens) {
  if (tokens[name]) return tokens[name];
  const [family, shade] = name.split('-');
  let hex = shade ? colors[family]?.[shade] : colors[family];
  if (typeof hex === 'string' && /^#[0-9a-f]{3}$/i.test(hex)) hex = '#' + [...hex.slice(1)].map((digit) => digit + digit).join('');
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Unsupported color ${name}`);
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function utilityColor(classes, property, mode) {
  const candidates = classes.split(/\s+/).filter((value) => value.startsWith(`${property}-`) || (mode === 'dark' && value.startsWith(`dark:${property}-`)));
  const selected = candidates.findLast((value) => !/^(text-(xs|sm|base|lg|xl|left|center|right))$/.test(value));
  if (!selected) throw new Error(`Missing ${property} color in ${classes}`);
  return selected.replace(/^dark:/, '').slice(property.length + 1);
}

function matched(file, expression) {
  const match = read(file).match(expression);
  if (!match) throw new Error(`Pairing changed; review contrast coverage in ${file}`);
  return match[1];
}

function audit() {
  const results = [];
  for (const [mode, tokens] of Object.entries(themes())) {
    const add = (name, foreground, background, minimum, source, opacity = 1, backdrop = 'card') => {
      const bg = composite(resolveColor(background, tokens), resolveColor(backdrop, tokens), opacity);
      const [foregroundColor, foregroundAlpha = '100'] = foreground.split('/');
      const fg = composite(resolveColor(foregroundColor, tokens), bg, Number(foregroundAlpha) / 100);
      const ratio = contrast(fg, bg);
      results.push({ mode, name, foreground, background: `${background}${opacity < 1 ? `/${opacity * 100} over ${backdrop}` : ''}`, minimum, ratio, pass: ratio >= minimum, source });
    };
    // Actual shared component pairings; normal-size text requires 4.5:1.
    for (const surface of ['background', 'card', 'popover', 'secondary', 'muted', 'accent', 'primary', 'destructive']) {
      const foreground = surface === 'background' ? 'foreground' : `${surface}-foreground`;
      add(`${surface} text`, foreground, surface, 4.5, 'app/globals.css');
    }
    for (const surface of ['background', 'card', 'muted']) {
      add(`muted text on ${surface}`, 'muted-foreground', surface, 4.5, 'app/globals.css');
    }
    for (const surface of ['background', 'card']) {
      add(`input boundary on ${surface}`, 'input', surface, 3, 'components/ui/input.tsx');
      add(`focus ring on ${surface}`, 'ring', surface, 3, 'components/ui/button.tsx');
    }
    for (const surface of ['primary', 'destructive']) {
      for (const component of ['button', 'badge']) {
        const file = `components/ui/${component}.tsx`;
        const variant = surface === 'primary' ? 'default' : surface;
        const classes = matched(file, new RegExp(`${variant}:\\s*'([^']+)'`));
        const hover = classes.split(/\s+/).find((value) => value.startsWith('hover:bg-'));
        if (!hover) throw new Error(`Review ${component} hover pairing`);
        const [background, alpha = '100'] = hover.slice('hover:bg-'.length).split('/');
        add(`${surface} ${component} hover`, utilityColor(classes, 'text', mode), background, 4.5, file, Number(alpha) / 100);
      }
    }
    const profile = 'components/profile/ProfileEditForm.tsx';
    const profileClasses = matched(profile, /errors\.name && \([\s\S]*?<p className="([^"]+)"/);
    add('profile validation message', utilityColor(profileClasses, 'text', mode), 'card', 4.5, profile);
    const quiz = 'app/courses/[courseId]/contents/QuizRenderer.tsx';
    const quizClasses = matched(quiz, /<p className=\{isAnswerCorrect\(index\) \? "([^"]+)"/);
    add('correct quiz answer', utilityColor(quizClasses, 'text', mode), 'card', 4.5, quiz);
    const notification = 'components/notification-badge.tsx';
    const notificationClasses = read(notification).includes('variant="destructive"')
      ? matched('components/ui/badge.tsx', /destructive:\s*'([^']+)'/)
      : matched(notification, /className=\{`([^`]+)`\}/);
    add('notification count', utilityColor(notificationClasses, 'text', mode), utilityColor(notificationClasses, 'bg', mode), 4.5, notification);
    const toast = 'components/ui/toast.tsx';
    const closeClasses = matched(toast, /'([^']*absolute right-2 top-2[^']*)'/);
    add('toast close icon', utilityColor(closeClasses, 'text', mode), 'background', 3, toast);
    const destructiveClose = closeClasses.split(/\s+/).find((value) => value.startsWith('group-[.destructive]:text-'));
    if (!destructiveClose) throw new Error('Review destructive toast close pairing');
    add('destructive toast close icon', destructiveClose.slice('group-[.destructive]:text-'.length), 'destructive', 3, toast);
    const destructiveHover = closeClasses.split(/\s+/).find((value) => value.startsWith('group-[.destructive]:hover:text-'));
    if (!destructiveHover) throw new Error('Review destructive toast hover pairing');
    add('destructive toast close hover icon', destructiveHover.slice('group-[.destructive]:hover:text-'.length), 'destructive', 3, toast);
    const destructiveFocus = closeClasses.split(/\s+/).find((value) => value.startsWith('group-[.destructive]:focus:ring-') && !value.includes('ring-offset-'));
    if (!destructiveFocus) throw new Error('Review destructive toast focus pairing');
    add('destructive toast close focus ring', destructiveFocus.slice('group-[.destructive]:focus:ring-'.length), 'destructive', 3, toast);
  }
  return results;
}

module.exports = { audit, composite, contrast, hslToRgb, luminance, resolveColor, themes, utilityColor };
if (require.main === module) {
  const results = audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.mode} ${result.name}: ${result.foreground} / ${result.background} = ${result.ratio.toFixed(3)}:1 (minimum ${result.minimum}:1) [${result.source}]`);
  process.exitCode = results.every((result) => result.pass) ? 0 : 1;
}
