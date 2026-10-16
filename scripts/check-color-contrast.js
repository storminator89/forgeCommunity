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
  const match = /^\s*([-+\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(value);
  if (!match) throw new Error(`Unsupported HSL color ${value}`);
  const [hue, saturation, lightness] = match.slice(1).map(Number);
  if (![hue, saturation, lightness].every(Number.isFinite) || saturation > 100 || lightness > 100) {
    throw new Error(`Invalid HSL color ${value}`);
  }
  const h = ((hue % 360) + 360) % 360 / 60;
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const segments = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  return segments[Math.floor(h) % 6].map((channel) => channel + m);
}

// Tailwind v4's public colors export uses OKLCH instead of v3's hex palette.
// Convert to sRGB for the source-level WCAG luminance check below. Out-of-gamut
// channels are clipped, not perceptually gamut-mapped; browser rendering is a
// separate check. The semantic HSL tokens themselves are all in-gamut sRGB.
function oklchToRgb(value) {
  const match = /^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([-+\d.]+)\s*\)$/i.exec(value);
  if (!match) throw new Error(`Unsupported OKLCH color ${value}`);
  const lightness = Number(match[1]) / (match[2] ? 100 : 1);
  const chroma = Number(match[3]);
  const hue = Number(match[4]) * Math.PI / 180;
  if (![lightness, chroma, hue].every(Number.isFinite) || lightness < 0 || lightness > 1) {
    throw new Error(`Invalid OKLCH color ${value}`);
  }
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return linear.map((channel) => {
    const bounded = Math.max(0, Math.min(1, channel));
    return bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055;
  });
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
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`Invalid opacity ${opacity}`);
  return foreground.map((channel, index) => channel * opacity + background[index] * (1 - opacity));
}

function hexToRgb(value) {
  if (/^#[0-9a-f]{3}$/i.test(value)) value = '#' + [...value.slice(1)].map((digit) => digit + digit).join('');
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Unsupported hex color ${value}`);
  return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
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
  if (name.startsWith('#')) return hexToRgb(name);
  const [family, shade] = name.split('-');
  let hex = shade ? colors[family]?.[shade] : colors[family];
  if (typeof hex === 'string' && hex.startsWith('oklch(')) return oklchToRgb(hex);
  if (typeof hex !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(hex)) throw new Error(`Unsupported color ${name}`);
  return hexToRgb(hex);
}

function utilityColor(classes, property, mode) {
  const candidates = classes.split(/\s+/).filter((value) => {
    const unprefixed = value.replace(/^dark:/, '');
    return (value.startsWith(`${property}-`) || (mode === 'dark' && value.startsWith(`dark:${property}-`))) &&
      !(property === 'text' && /^text-(?:xs|sm|base|lg|xl|\d+xl|left|center|right|justify|start|end)(?:\/.*)?$/.test(unprefixed));
  });
  const dark = candidates.filter((value) => value.startsWith('dark:'));
  const applicable = [...new Set(dark.length ? dark : candidates)];
  // Class attribute order does not determine the Tailwind cascade. Ambiguous
  // same-scope utilities need a source review, not an invented last-one-wins.
  if (applicable.length > 1) throw new Error(`Ambiguous ${property} colors in ${classes}`);
  const selected = applicable[0];
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
      // A /50 backdrop denotes the actual muted footer over its opaque card,
      // not an ungrounded transparent color treated as a white/black surface.
      const [backdropColor, backdropAlpha = '100'] = backdrop.split('/');
      const opaqueBackdrop = composite(resolveColor(backdropColor, tokens), resolveColor('card', tokens), Number(backdropAlpha) / 100);
      const bg = composite(resolveColor(background, tokens), opaqueBackdrop, opacity);
      const [foregroundColor, foregroundAlpha = '100'] = foreground.split('/');
      const fg = composite(resolveColor(foregroundColor, tokens), bg, Number(foregroundAlpha) / 100);
      const ratio = contrast(fg, bg);
      results.push({ mode, name, foreground, background: `${background}${opacity < 1 ? `/${opacity * 100} over ${backdrop}${backdrop.includes('/') ? ' over card' : ''}` : ''}`, minimum, ratio, pass: ratio >= minimum, source });
    };
    // Actual shared component pairings; normal-size text requires 4.5:1.
    for (const surface of ['background', 'card', 'popover', 'secondary', 'muted', 'accent', 'primary', 'destructive', 'progress', 'coral', 'coral-highlight', 'reward', 'info', 'warning', 'success']) {
      const foreground = surface === 'background' ? 'foreground' : `${surface}-foreground`;
      add(`${surface} text`, foreground, surface, 4.5, 'app/globals.css');
    }
    for (const surface of ['background', 'card', 'muted', 'popover', 'accent', 'secondary']) {
      add(`muted text on ${surface}`, 'muted-foreground', surface, 4.5, 'app/globals.css');
    }
    for (const surface of ['background', 'card', 'popover', 'muted', 'accent', 'secondary']) {
      add(`input boundary on ${surface}`, 'input', surface, 3, 'components/ui/input.tsx');
      add(`focus ring on ${surface}`, 'ring', surface, 3, 'components/ui/button.tsx');
      add(`link text on ${surface}`, 'primary', surface, 4.5, 'components/ui/button.tsx');
      add(`reward ink on ${surface}`, 'reward-ink', surface, 4.5, 'components/community/StatsCard.tsx');
    }
    for (const surface of ['background', 'card', 'popover', 'muted']) {
      for (const status of ['success', 'destructive', 'info', 'warning', 'coral']) {
        // Info/warning are reserved semantic roles, not proof of an existing
        // rendered status component. Solid accent/secondary are deliberately
        // excluded: some dark status foregrounds do not qualify there.
        add(`${status} text on ${surface}`, status, surface, 4.5, 'app/globals.css');
      }
      add(`progress indicator on ${surface}`, 'progress', surface, 3, 'app/globals.css');
    }
    for (const surface of ['background', 'card']) {
      for (let index = 1; index <= 5; index++) {
        // Reserved chart stroke tokens; no data-series consumer exists yet.
        add(`chart ${index} stroke on ${surface}`, `chart-${index}`, surface, 3, 'app/globals.css');
      }
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
        for (const backdrop of ['background', 'muted', 'accent', 'secondary']) {
          add(`${surface} ${component} hover on ${backdrop}`, utilityColor(classes, 'text', mode), background, 4.5, file, Number(alpha) / 100, backdrop);
        }
      }
    }
    const sidebar = 'components/Sidebar.tsx';
    if (!read(sidebar).includes('bg-accent/70 font-semibold text-foreground')) throw new Error('Review selected navigation pairing');
    add('selected navigation text', 'foreground', 'accent', 4.5, sidebar, 0.7);
    add('selected navigation icon', 'primary', 'accent', 3, sidebar, 0.7);
    const tabs = 'components/ui/tabs.tsx';
    if (!read(tabs).includes('data-[state=active]:bg-background data-[state=active]:text-foreground')) throw new Error('Review selected tab pairing');
    add('selected tab text', 'foreground', 'background', 4.5, tabs);
    const post = 'components/community/PostCard.tsx';
    if (!read(post).includes('hover:bg-coral/10') || !read(post).includes('hover:text-coral')) throw new Error('Review social hover pairing');
    add('post like hover on muted footer', 'coral', 'coral', 4.5, post, 0.1, 'muted/50');
    const comment = 'components/community/CommentSection.tsx';
    if (!read(comment).includes('bg-card') || !read(comment).includes('hover:bg-coral/15')) throw new Error('Review selected comment hover pairing');
    add('selected comment like text', 'coral', 'coral', 4.5, comment, 0.1);
    add('selected comment like hover', 'coral', 'coral', 4.5, comment, 0.15);
    add('comment body translucent text', 'foreground/90', 'card', 4.5, comment);
    const userNav = 'components/user-nav.tsx';
    if (!read(userNav).includes('focus:bg-destructive/10') || !read(userNav).includes('focus:text-destructive')) throw new Error('Review logout focus pairing');
    add('logout destructive focus text', 'destructive', 'destructive', 4.5, userNav, 0.1, 'popover');
    const notificationPage = 'app/notifications/page.tsx';
    if (!read(notificationPage).includes('text-muted-foreground hover:text-destructive hover:bg-destructive/10')) throw new Error('Review notification deletion hover pairing');
    add('notification deletion hover text', 'destructive', 'destructive', 4.5, notificationPage, 0.1, 'background');
    const button = 'components/ui/button.tsx';
    for (const stateClass of ['disabled:opacity-100', 'disabled:bg-muted', 'disabled:text-muted-foreground', 'data-[state=loading]:opacity-100']) {
      if (!read(button).includes(stateClass)) throw new Error(`Review readable button state ${stateClass}`);
    }
    // Inactive controls are exempt from normative text contrast. This is an
    // intentional readability design target, not a new WCAG requirement.
    add('disabled button text (voluntary inactive target)', 'muted-foreground', 'muted', 4.5, button);
    add('loading button text', 'primary-foreground', 'primary', 4.5, button);
    const profile = 'components/profile/ProfileEditForm.tsx';
    const profileClasses = matched(profile, /errors\.name && \([\s\S]*?<p className="([^"]+)"/);
    add('profile validation message', utilityColor(profileClasses, 'text', mode), 'card', 4.5, profile);
    const quiz = 'app/courses/[courseId]/contents/QuizRenderer.tsx';
    const quizClasses = matched(quiz, /<p className=\{isAnswerCorrect\(index\) \? "([^"]+)"/);
    add('correct quiz answer', utilityColor(quizClasses, 'text', mode), 'card', 4.5, quiz);
    const incorrectQuizClasses = matched(quiz, /<p className=\{isAnswerCorrect\(index\) \? "[^"]+" : "([^"]+)"/);
    add('incorrect quiz answer', utilityColor(incorrectQuizClasses, 'text', mode), 'card', 4.5, quiz);
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

module.exports = { audit, composite, contrast, hexToRgb, hslToRgb, oklchToRgb, luminance, resolveColor, themes, utilityColor };
if (require.main === module) {
  const results = audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.mode} ${result.name}: ${result.foreground} / ${result.background} = ${result.ratio.toFixed(3)}:1 (minimum ${result.minimum}:1) [${result.source}]`);
  process.exitCode = results.every((result) => result.pass) ? 0 : 1;
}
