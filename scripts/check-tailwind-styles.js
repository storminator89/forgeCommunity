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

  // Shared header reflow is explicit geometry, not an overflow-hidden fix.
  // Keep this separate from the existing topic-filter and palette contracts;
  // real browser title/control rectangles remain the acceptance evidence.
  const headerDeclarations = {
    '.app-header-layout': { display: 'flex', 'flex-wrap': 'wrap' },
    '.app-header-row': { display: 'contents' },
    '.app-header-leading': { display: 'contents' },
    '.app-header-title': { flex: '1 1 6rem', 'min-inline-size': 'min(100%, 6rem)', 'max-inline-size': '100%', 'overflow-wrap': 'anywhere' },
    '.app-header-actions': { display: 'flex', 'flex-wrap': 'wrap', 'min-inline-size': '0', 'max-inline-size': '100%' },
    '.app-header .fc-button': { 'min-inline-size': '44px', 'min-block-size': '44px' },
    '.app-menu': { flex: 'none' },
  };
  for (const [selector, declarations] of Object.entries(headerDeclarations)) {
    const matches = rules.filter(rule => rule.selector.split(',').map(part => part.trim()).includes(selector) && mediaQueries(rule).length === 0);
    assert.equal(matches.length, 1, `Missing or ambiguous compiled shared-header slot ${selector}`);
    for (const [property, value] of Object.entries(declarations)) {
      assert.ok(matches[0].nodes.some(node => node.type === 'decl' && node.prop === property && node.value.replace(/\s/g, '') === value.replace(/\s/g, '') && !node.important), `Missing compiled reflow declaration ${selector}: ${property}: ${value}`);
    }
  }
  for (const rule of rules.filter(rule => /\.app-header|\.app-menu/.test(rule.selector))) {
    assert.ok(!/\.app-header\s*>\s*div/.test(rule.selector), 'Header geometry must not depend on arbitrary nested divs');
    rule.walkDecls(declaration => {
      if (['overflow', 'overflow-x', 'overflow-y'].includes(declaration.prop)) assert.ok(!/hidden|clip/.test(declaration.value), `Header must reflow instead of clipping: ${rule.selector}`);
      if (rule.selector === '.app-menu') assert.ok(!(declaration.prop === 'position' && declaration.value === 'absolute'), 'The mobile menu must participate in header reflow');
    });
  }
  // Real absolute sr-only nodes belong to main's inner scrollport. A root
  // overflow clamp or native-scroll override would hide this focus regression.
  const mainContainingBlocks = rules.filter(rule => rule.selector === '.app-shell #page-content' && mediaQueries(rule).length === 0);
  assert.equal(mainContainingBlocks.length, 1, 'Missing or ambiguous scoped main containing block');
  const mainDeclarations = mainContainingBlocks[0].nodes.filter(node => node.type === 'decl');
  assert.equal(mainDeclarations.length, 1, 'Main containment must remain a position-only rule');
  assert.ok(mainDeclarations[0].prop === 'position' && mainDeclarations[0].value === 'relative' && !mainDeclarations[0].important, 'Main must contain absolute descendants without changing overflow, native scrolling or focus');

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
  // invalidate another engine's rule. System colors stay user-adjustable;
  // source/compile checks cannot establish the native painted fill's pixels.
  const nativeProgressStyles = {
    'progress.accent-progress': { '-webkit-appearance': 'none', appearance: 'none', 'background-color': 'hsl(var(--muted))', color: 'hsl(var(--progress))' },
    'progress.accent-progress::-webkit-progress-bar': { 'background-color': 'hsl(var(--muted))' },
    'progress.accent-progress::-webkit-progress-value': { 'background-color': 'hsl(var(--progress))' },
    'progress.accent-progress::-moz-progress-bar': { 'background-color': 'hsl(var(--progress))' },
  };
  const forcedNativeProgressStyles = {
    'progress.accent-progress': { '-webkit-appearance': 'none', appearance: 'none', 'forced-color-adjust': 'auto', 'background-color': 'Canvas', color: 'CanvasText', outline: '1px solid CanvasText', 'outline-offset': '-1px' },
    'progress.accent-progress::-webkit-progress-bar': { 'background-color': 'Canvas' },
    'progress.accent-progress::-webkit-progress-value': { 'background-color': 'CanvasText' },
    'progress.accent-progress::-moz-progress-bar': { 'background-color': 'CanvasText' },
  };
  function mediaQueries(rule) {
    const queries = [];
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'media') queries.push(parent.params.replace(/\s/g, ''));
    }
    return queries;
  }
  for (const [mode, styles] of [['none', nativeProgressStyles], ['active', forcedNativeProgressStyles]]) {
    for (const [selector, declarations] of Object.entries(styles)) {
      const matchingRules = rules.filter((rule) => rule.selector === selector && mediaQueries(rule).join() === `(forced-colors:${mode})`);
      assert.equal(matchingRules.length, 1, `Missing or ambiguous compiled native progress rule ${mode}: ${selector}`);
      const compiled = matchingRules[0].nodes.filter(node => node.type === 'decl');
      assert.equal(compiled.length, Object.keys(declarations).length, `Unexpected compiled native declarations ${mode}: ${selector}`);
      assert.ok(compiled.every(node => !node.important), `Native declarations must not force priority ${mode}: ${selector}`);
      for (const [property, value] of Object.entries(declarations)) {
        assert.ok(compiled.some(node => node.prop === property && node.value === value), `Missing compiled ${property}: ${value} in ${mode}: ${selector}`);
      }
    }
  }
  // Do not permit unscoped, grouped or extra progress overrides to bypass the
  // query-specific assertions, nor a root/container forced-color opt-out.
  const sourceNativeRules = [];
  postcss.parse(input).walkRules(rule => { if (rule.selector.includes('progress')) sourceNativeRules.push(rule); });
  assert.equal(sourceNativeRules.length, 8, 'Source native progress must remain limited to the two scoped branches');
  for (const rule of sourceNativeRules) {
    assert.ok(Object.hasOwn(nativeProgressStyles, rule.selector), `Unexpected source progress override ${rule.selector}`);
    assert.ok(['(forced-colors:none)', '(forced-colors:active)'].includes(mediaQueries(rule).join()), `Unscoped source progress override ${rule.selector}`);
  }
  // Tailwind's existing preflight progress { vertical-align: baseline } is
  // unrelated to painting; require only our exact semantic selectors here.
  const nativeRules = rules.filter(rule => rule.selector.includes('progress.accent-progress'));
  assert.equal(nativeRules.length, 8, 'Native progress must have exactly four separate selectors in each color mode');
  for (const rule of nativeRules) {
    assert.ok(Object.hasOwn(nativeProgressStyles, rule.selector), `Unexpected compiled progress override ${rule.selector}`);
    assert.ok(['(forced-colors:none)', '(forced-colors:active)'].includes(mediaQueries(rule).join()), `Unscoped compiled progress override ${rule.selector}`);
  }
  result.root.walkDecls('forced-color-adjust', declaration => {
    const rule = declaration.parent;
    assert.equal(rule.type, 'rule', 'Color adjustment must be scoped to native progress or a decorative icon');
    assert.equal(mediaQueries(rule).join(), '(forced-colors:active)', 'Color adjustment must be forced-color-specific');
    if (rule.selector === '.fc-navigation-icon::before') {
      // Background paint normally becomes Canvas in forced colors and would
      // erase alpha-mask icons. Only the glyph opts out, using system ink.
      assert.equal(declaration.value, 'none');
      assert.ok(rule.nodes.some(node => node.prop === 'background-color' && node.value === 'CanvasText'), 'Masked icons must follow the user-selected system ink');
    } else {
      assert.equal(declaration.value, 'auto', 'User color adjustment must remain enabled');
      assert.equal(rule.selector, 'progress.accent-progress', 'No document or container color-adjust override');
    }
  });
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
  console.log('Tailwind v4 utility, token, shared-header reflow, native-progress, dark-mode, focus, animation, and transition checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
