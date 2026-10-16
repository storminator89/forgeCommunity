#!/usr/bin/env node
// Verify the v4 compiler still emits the design-system and interaction classes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');

const root = path.resolve(__dirname, '..');
const from = path.join(root, 'app/globals.css');

async function main() {
  const input = fs.readFileSync(from, 'utf8');
  const chartSource = fs.readFileSync(path.join(root, 'components/ui/chart.tsx'), 'utf8');
  assert.ok(chartSource.includes('border-(--color-border) bg-(--color-bg)'), 'Chart tooltip indicators must use v4 CSS variable syntax');
  const buttonSource = fs.readFileSync(path.join(root, 'components/ui/button.tsx'), 'utf8');
  assert.ok(buttonSource.includes('cursor-pointer') && buttonSource.includes('disabled:cursor-not-allowed'), 'Shared buttons must preserve active and disabled cursor states');
  const dialogSource = fs.readFileSync(path.join(root, 'components/ui/dialog.tsx'), 'utf8');
  assert.ok(dialogSource.includes('backdrop-blur-xs'), 'Dialog backdrop must preserve the v3 blur amount');
  const semanticRoles = ['progress', 'coral', 'coral-highlight', 'reward', 'info', 'warning', 'success'];
  for (const role of semanticRoles) {
    for (const token of [role, `${role}-foreground`]) {
      assert.ok(input.includes(`--color-${token}: hsl(var(--${token}));`), `Missing public semantic mapping ${token}`);
    }
  }
  assert.ok(input.includes('--color-reward-ink: hsl(var(--reward-ink));'), 'Small reward text/icons need their dedicated text-only role');
  // Compile reserved roles as an explicit test input too. This creates no
  // production classes/page or claim that an app warning/chart consumer exists.
  const roleUtilities = [...semanticRoles.flatMap(role => [`bg-${role}`, `text-${role}-foreground`]), 'text-reward-ink', 'text-success', 'text-destructive', ...[1, 2, 3, 4, 5].map(index => `stroke-chart-${index}`)];
  const result = await postcss([tailwind()]).process(`${input}\n@source inline("${roleUtilities.join(' ')}");`, { from });
  const rules = [];
  result.root.walkRules((rule) => rules.push(rule));

  function expectClass(className, property, value) {
    const escaped = className.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
    const rule = rules.find((candidate) => candidate.selector.includes(`.${escaped}`));
    assert.ok(rule, `Missing compiled utility ${className}`);
    if (property) {
      let found = false;
      rule.walkDecls(property, (decl) => {
        if (!value || decl.value.includes(value)) found = true;
      });
      assert.ok(found, `Missing ${property}: ${value || '*'} in ${className}`);
    }
    return rule;
  }

  expectClass('bg-background', 'background-color', 'hsl(var(--background))');
  expectClass('text-foreground', 'color', 'hsl(var(--foreground))');
  expectClass('bg-white', 'background-color');
  expectClass('[color-scheme:light]', 'color-scheme', 'light');
  expectClass('bg-primary/10', 'background-color', 'color-mix');
  expectClass('bg-(--color-bg)', 'background-color', 'var(--color-bg)');
  expectClass('border-(--color-border)', 'border-color', 'var(--color-border)');
  expectClass('backdrop-blur-xs', '--tw-backdrop-blur', 'blur(var(--blur-xs))');
  let blurSizeFound = false;
  result.root.walkDecls('--blur-xs', (decl) => { if (decl.value === '4px') blurSizeFound = true; });
  assert.ok(blurSizeFound, 'backdrop-blur-xs must preserve the 4px v3 backdrop blur');
  expectClass('cursor-pointer', 'cursor', 'pointer');
  expectClass('disabled:cursor-not-allowed', 'cursor', 'not-allowed');
  expectClass('rounded-sm', 'border-radius', 'calc(var(--radius) - 4px)');
  expectClass('shadow-xs', 'box-shadow');
  expectClass('ring-offset-background', '--tw-ring-offset-color', 'hsl(var(--background))');
  expectClass('outline-hidden', 'outline-style', 'none');
  expectClass('focus-visible:ring-2', '--tw-ring-shadow');
  expectClass('focus-visible:ring-ring', '--tw-ring-color', 'hsl(var(--ring))');
  expectClass('focus-visible:ring-offset-2', '--tw-ring-offset-width', '2px');
  assert.ok(input.includes('outline-offset: 3px'), 'Global keyboard outlines must keep their real external 3px offset');
  for (const role of semanticRoles) {
    expectClass(`bg-${role}`, 'background-color', `hsl(var(--${role}))`);
    expectClass(`text-${role}-foreground`, 'color', `hsl(var(--${role}-foreground))`);
  }
  // accent-color alone does not prove that the native painted bar is themed.
  // Keep each engine's pseudo-element separate so unknown selectors cannot
  // invalidate another engine's rule; leave forced-color native painting alone.
  const nativeProgressStyles = {
    'progress.accent-progress': { '-webkit-appearance': 'none', appearance: 'none', 'background-color': 'hsl(var(--muted))', color: 'hsl(var(--progress))' },
    'progress.accent-progress::-webkit-progress-bar': { 'background-color': 'hsl(var(--muted))' },
    'progress.accent-progress::-webkit-progress-value': { 'background-color': 'hsl(var(--progress))' },
    'progress.accent-progress::-moz-progress-bar': { 'background-color': 'hsl(var(--progress))' },
  };
  for (const [selector, declarations] of Object.entries(nativeProgressStyles)) {
    const matchingRules = rules.filter((rule) => rule.selector === selector);
    assert.equal(matchingRules.length, 1, `Missing or ambiguous compiled native progress rule ${selector}`);
    const rule = matchingRules[0];
    let unforcedOnly = false;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'media' && parent.params.replace(/\s/g, '') === '(forced-colors:none)') unforcedOnly = true;
    }
    assert.ok(unforcedOnly, `Native progress theming must not override forced colors: ${selector}`);
    for (const [property, value] of Object.entries(declarations)) {
      assert.ok(rule.nodes.some((node) => node.type === 'decl' && node.prop === property && node.value === value), `Missing compiled ${property}: ${value} in ${selector}`);
    }
  }
  expectClass('text-success', 'color', 'hsl(var(--success))');
  expectClass('text-destructive', 'color', 'hsl(var(--destructive))');
  expectClass('text-reward-ink', 'color', 'hsl(var(--reward-ink))');
  for (let index = 1; index <= 5; index++) expectClass(`stroke-chart-${index}`, 'stroke', `hsl(var(--chart-${index}))`);
  expectClass('animate-caret-blink', 'animation');
  expectClass('data-[state=open]:animate-accordion-down', 'animation');
  expectClass('data-[state=open]:animate-in', 'animation');
  expectClass('data-[motion=from-start]:slide-in-from-left-52', '--tw-enter-translate-x');
  expectClass('data-[state=open]:zoom-in-95', '--tw-enter-scale');
  const buttonTransition = expectClass('transition-[color,background-color,border-color,box-shadow,translate,transform]', 'transition-property');
  assert.ok(buttonTransition.toString().includes('translate'), 'Button active translation must animate');
  const darkRule = expectClass('dark:scale-0', 'scale');
  assert.ok(darkRule.selector.includes('.dark'), 'Dark mode must follow the .dark class');
  console.log('Tailwind v4 utility, token, native-progress, dark-mode, focus, animation, and transition checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
