/** @jest-environment node */
'use strict';

// Execute the actual serialized browser functions. These synthetic DOM/frame
// regressions do not substitute for the required real CI viewport originals.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const source = readFileSync(path.join(root, 'e2e/private-mission-invitations.pw.ts'), 'utf8');
const parsed = ts.createSourceFile('capture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const evaluate = (name, globals, transform = text => text) => {
  const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node);
  const compiled = ts.transpileModule(transform(node.getText(parsed)), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(`${compiled}; ${name}`, globals);
};
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(width = 1280) {
  const make = (tagName, left = 0, size = width, style = {}) => {
    const node = { tagName, isConnected: true, parentElement: null, children: [], interactions: [],
      scrollWidth: Math.round(size), clientWidth: Math.round(size), scrollHeight: 100, clientHeight: 100, scrollLeft: 0, scrollTop: 0,
      rectangle: { left, right: left + size, top: 0, bottom: 100, width: size, height: 100 },
      style: { zoom: '1', visibility: 'visible', width: `${size}px`, minWidth: '0px', whiteSpace: 'normal',
        display: 'block', flexDirection: 'row', position: 'static', overflowX: 'visible', textOverflow: 'clip', ...style },
      after: { content: 'none', display: 'inline', position: 'static', left: 'auto', width: 'auto', height: 'auto' },
      getBoundingClientRect() { return this.rectangle; }, getClientRects() { return [this.rectangle]; },
      get lastElementChild() { return this.children.at(-1); },
      getAttribute() { assert.fail('No private attributes may be read'); },
      querySelectorAll() { return this.interactions; },
      closest(selector) {
        for (let node = this; node; node = node.parentElement) {
          if (selector === 'main' && node.tagName === 'MAIN') return node;
          if (selector === 'nav[aria-label="Pfad"]' && node.tagName === 'NAV' && node.breadcrumb) return node;
        }
        return null;
      },
    };
    return node;
  };
  const html = make('HTML'), body = make('BODY'), main = make('MAIN'), region = make('SECTION');
  body.parentElement = html; main.parentElement = body; region.parentElement = main;
  const leaves = []; const texts = [];
  main.querySelectorAll = () => leaves; main.getAnimations = () => [];
  region.contains = node => node === region;
  let selected, index = -1;
  const globals = { innerWidth: width, innerHeight: 900, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: (node, pseudo) => pseudo ? node.after : node.style,
    document: { documentElement: html, body,
      createTreeWalker: () => ({ nextNode: () => ++index < texts.length, get currentNode() { return texts[index]; } }),
      createRange: () => ({ selectNodeContents(node) { selected = node; }, getClientRects: () => selected.rectangles }),
    },
  };
  return { make, html, body, main, region, leaves, texts, globals,
    read: () => plain(evaluate('readInvitationGeometry', globals)(region)) };
}
function goalFixture(column = 276.656, listWidth = 846, viewport = 1280) {
  const f = fixture(viewport); const left = viewport === 1280 ? 309 : 33;
  const list = f.make('OL', left, listWidth, { display: 'grid' }); list.parentElement = f.main;
  const items = Array.from({ length: 3 }, (_, index) => {
    const item = f.make('LI', left + index * (column + 8), column,
      { display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'visible' });
    item.parentElement = list;
    item.children = ['SPAN', 'H3', 'SPAN'].map(tag => {
      const child = f.make(tag, item.rectangle.left + (column - 54) / 2, 54); child.parentElement = item; return child;
    });
    if (index < 2) {
      item.after = { content: '""', display: 'block', position: 'absolute', left: `${column / 2 + 31}px`, width: `${column - 54}px`, height: '1px' };
      item.scrollWidth = Math.round(column * 1.5 - 23);
    }
    return item;
  });
  list.children = items; f.leaves.push(items[0]);
  return { ...f, list, items, item: items[0] };
}
function assertGoalRejected(mutate) {
  const f = goalFixture(); mutate(f);
  assert.ok(f.read().violations.includes('main-li-0'));
}

test('actual desktop GoalTrail connector paint is contained in its clean OL/main, with all child bounds retained', () => {
  const f = goalFixture(); const result = f.read();
  assert.deepEqual(result.violations, []);
  assert.equal(result.descendants[0].intentionalOverflow, 'goal-trail-connector');
  assert.equal(result.descendants[0].bounds.clientWidth, 277); assert.equal(result.descendants[0].bounds.scrollWidth, 392);
  assert.equal(result.descendants[0].ancestors[0].bounds.scrollWidth, 846);
  assert.equal(result.main.scrollWidth, result.main.clientWidth);
});
test('actual normal320px GoalTrail connector remains contained without a broader LI exemption', () => {
  const f = goalFixture(79.328, 254, 320); const result = f.read();
  assert.deepEqual(result.violations, []); assert.equal(result.descendants[0].bounds.scrollWidth, 96);
  assert.equal(result.descendants[0].bounds.clientWidth, 79);
});
test('another LI context cannot receive the connector classification', () => assertGoalRejected(f => { f.list.tagName = 'UL'; }));
test('a different goal-list shape cannot receive the connector classification', () => assertGoalRejected(f => { f.list.children.pop(); }));
test('connector paint outside its OL remains a failure', () => assertGoalRejected(f => { f.list.rectangle.right = f.list.rectangle.left + 300; f.list.rectangle.width = 300; f.list.clientWidth = f.list.scrollWidth = 300; }));
test('an overflowing OL remains a failure', () => assertGoalRejected(f => { f.list.scrollWidth += 5; }));
test('actual main horizontal scroll is never excused by a connector', () => assertGoalRejected(f => { f.main.scrollWidth += 5; }));
test('interactive descendants cannot be classified as pure connector decoration', () => assertGoalRejected(f => { f.item.interactions.push(f.make('BUTTON')); }));
test('overflowing authored child content remains a failure', () => assertGoalRejected(f => { f.item.children[1].scrollWidth += 5; }));
test('overlapping54px icons in an actual26px column remain a failure', () => {
  const f = goalFixture(26, 94, 320); f.item.scrollWidth = 40;
  assert.ok(f.read().violations.includes('main-li-0'));
});
test('nonempty generated content is not the reviewed decorative connector', () => assertGoalRejected(f => { f.item.after.content = '"unexpected"'; }));
test('an unexplained extra scroll extent is not excused by an existing connector', () => assertGoalRejected(f => { f.item.scrollWidth += 5; }));
test('a real LI scroll container stays strict', () => assertGoalRejected(f => { f.item.style.overflowX = 'auto'; }));

function breadcrumbFixture() {
  const f = fixture(320); const nav = f.make('NAV', 32, 256); nav.breadcrumb = true; nav.parentElement = f.main;
  const link = f.make('A', 32, 256, { overflowX: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  link.clientWidth = 128; link.scrollWidth = 191; link.parentElement = nav; f.leaves.push(link);
  nav.children = [f.make('A'), f.make('SPAN'), link, f.make('SPAN')];
  for (const child of nav.children) child.parentElement = nav;
  f.texts.push({ textContent: 'PRIVATE-NAME-TOKEN-REQUEST', parentElement: link,
    rectangles: [{ left: 32, right: 414, top: 0, bottom: 34 }] });
  return { ...f, nav, link };
}
test('only the existing breadcrumb ellipsis uses visible clipping bounds and retains raw numeric diagnostics', () => {
  const result = breadcrumbFixture().read(); assert.deepEqual(result.violations, []);
  assert.equal(result.descendants[0].intentionalOverflow, 'breadcrumb-ellipsis');
  assert.deepEqual(result.clippedTexts, [{ label: 'main-text-0', left: 32, right: 414, top: 0, bottom: 34, visibleLeft: 32, visibleRight: 288, reason: 'breadcrumb-ellipsis' }]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-NAME-TOKEN-REQUEST'));
});
test('an ellipsized link outside the exact breadcrumb stays strict', () => {
  const f = breadcrumbFixture(); f.nav.breadcrumb = false; const result = f.read();
  assert.ok(result.violations.includes('main-a-0')); assert.ok(result.violations.includes('main-text-0'));
});
test('only the second of exactly two direct breadcrumb links can use the existing ellipsis', () => {
  for (const kind of ['first-link', 'extra-direct-link']) {
    const f = breadcrumbFixture();
    if (kind === 'first-link') f.nav.children = [f.link, f.make('SPAN'), f.make('A'), f.make('SPAN')];
    else f.nav.children.push(f.make('A'));
    const result = f.read();
    assert.ok(result.violations.includes('main-a-0')); assert.ok(result.violations.includes('main-text-0'));
  }
});
test('a nested ellipsized link is never mistaken for the source Space-name breadcrumb', () => {
  const f = breadcrumbFixture(); const wrapper = f.make('SPAN'); wrapper.parentElement = f.nav;
  f.link.parentElement = wrapper; f.nav.children[2] = wrapper;
  const result = f.read();
  assert.ok(result.violations.includes('main-a-0')); assert.ok(result.violations.includes('main-text-0'));
});
test('a clipped interactive button or necessary paragraph is never treated as a breadcrumb', () => {
  for (const tag of ['BUTTON', 'P']) {
    const f = breadcrumbFixture(); f.link.tagName = tag; const result = f.read();
    assert.ok(result.violations.includes(`main-${tag.toLowerCase()}-0`)); assert.ok(result.violations.includes('main-text-0'));
  }
});
test('a breadcrumb with an overflowing control box stays strict', () => {
  const f = breadcrumbFixture(); f.link.rectangle.right = 380; const result = f.read();
  assert.ok(result.violations.includes('main-a-0')); assert.ok(result.violations.includes('main-text-0'));
});
test('breadcrumb clipping cannot hide an overflowing navigation ancestor', () => {
  const f = breadcrumbFixture(); f.nav.scrollWidth += 5;
  assert.ok(f.read().violations.includes('main-a-0'));
});
test('actual nowrap join/share viewport overflow and long paragraph overflow remain failures', () => {
  for (const [tag, right] of [['BUTTON', 377], ['BUTTON', 385], ['P', 254]]) {
    const f = fixture(320); const leaf = f.make(tag, 32, right - 32, { whiteSpace: tag === 'BUTTON' ? 'nowrap' : 'normal' });
    if (tag === 'P') { leaf.scrollWidth = 112; leaf.clientWidth = 94; }
    leaf.parentElement = f.main; f.leaves.push(leaf);
    assert.ok(f.read().violations.includes(`main-${tag.toLowerCase()}-0`));
  }
});

async function settle({ permanent = false, descendantStyleAt = 4 } = {}) {
  let now = 0, frame = 0, id = 0, started = false, descendantReads = 0, disconnected = 0;
  const tasks = new Map();
  const node = { tagName: 'DIV', isConnected: true, scrollWidth: 320, clientWidth: 320, scrollHeight: 800, clientHeight: 800, scrollTop: 0, scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 800 }) };
  const leaf = { ...node, tagName: 'BUTTON' };
  const animation = { pending: true, playState: 'running', effect: { getTiming: () => ({ iterations: 1, duration: 0.01 }) },
    cancel() { assert.fail('Animation cancellation forbidden'); }, finish() { assert.fail('Animation finishing forbidden'); }, pause() { assert.fail('Animation pausing forbidden'); } };
  const main = { ...node, querySelectorAll: () => [leaf], getAnimations: () => started && (permanent || frame <= descendantStyleAt + 3) ? [animation] : [] };
  const element = { ...node, closest: () => main };
  const globals = { performance: { now: () => now },
    getComputedStyle: target => { if (target === leaf) { descendantReads++; if (frame >= descendantStyleAt) started = true; } return { zoom: '1', visibility: 'visible', whiteSpace: 'normal', minWidth: '0px' }; },
    document: { documentElement: node, activeElement: element, fonts: { status: 'loaded' } },
    MutationObserver: class { observe() {} disconnect() { disconnected++; } }, ResizeObserver: class { observe() {} disconnect() { disconnected++; } },
    setTimeout(callback, delay) { const key = ++id; tasks.set(key, { at: now + delay, callback }); return key; },
    clearTimeout: key => tasks.delete(key), cancelAnimationFrame: key => tasks.delete(key),
    requestAnimationFrame(callback) { const key = ++id; tasks.set(key, { at: now + 16, callback, frame: true }); return key; },
  };
  let done = false, result, failure;
  evaluate('settleCaptureMotion', globals)(element).then(value => { result = plain(value); done = true; }, error => { failure = error; done = true; });
  for (let step = 0; !done && step < 100; step++) {
    const [key, task] = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0] || [];
    assert.ok(task, 'Unchanged finite deadline stays armed'); tasks.delete(key); now = task.at;
    if (task.frame) frame++; task.callback(); await Promise.resolve();
  }
  assert.ok(done); if (failure) throw failure;
  assert.equal(tasks.size, 0); assert.equal(disconnected, 2);
  return { ...result, frame, now, descendantReads };
}
test('late descendant style reads instantiate finite0.01ms motion before the unchanged natural null guard', async () => {
  const result = await settle(); assert.equal(result.outcome, 'stable'); assert.equal(result.activeFrames, 4);
  assert.ok(result.frames >= 17); assert.ok(result.quietMs >= 150); assert.ok(result.descendantReads >= result.frames); assert.ok(result.now < 1000);
});
test('permanent motion after descendant reads still fails the original60frame budget', async () => {
  const result = await settle({ permanent: true }); assert.equal(result.outcome, 'frame-budget'); assert.equal(result.frames, 60); assert.ok(result.now < 1000);
});
test('static descendant inspection still observes150ms and never accepts the first quiet frame', async () => {
  const result = await settle({ descendantStyleAt: 1000 }); assert.equal(result.outcome, 'stable'); assert.equal(result.activeFrames, 0); assert.ok(result.frames > 3); assert.ok(result.quietMs >= 150);
});

test('reflow overrides belong only to the detail container and preserve the normal goal layout', () => {
  const css = postcss.parse(readFileSync(path.join(root, 'components/spaces/friendly-missions.module.css'), 'utf8'));
  const value = (rule, property) => rule.nodes.find(node => node.type === 'decl' && node.prop === property)?.value;
  const find = selector => css.nodes.find(node => node.type === 'rule' && node.selector === selector);
  assert.equal(value(find('.goalTrail'), 'grid-template-columns'), 'repeat(3, minmax(0, 1fr))');
  assert.equal(value(find('.goalTrail li:not(:last-child)::after'), 'left'), 'calc(50% + 31px)');
  assert.equal(value(find('.detail'), 'container-type'), 'inline-size');
  assert.equal(value(find('.detail p'), 'overflow-wrap'), 'anywhere');
  assert.equal(value(find('.detail button'), 'white-space'), 'normal'); assert.equal(value(find('.detail button'), 'max-width'), '100%');
  assert.equal(value(find('.detail button'), 'height'), undefined, 'Normal desktop small-button sizing stays untouched');
  const query = css.nodes.find(node => node.type === 'atrule' && node.name === 'container');
  assert.equal(query.params, '(width < 240px)');
  assert.ok(query.nodes.every(node => node.type === 'rule' && node.selector.startsWith('.detail ')));
  assert.equal(value(query.nodes.find(node => node.selector === '.detail button'), 'height'), 'auto');
  assert.equal(value(query.nodes.find(node => node.selector === '.detail button'), 'min-height'), '44px');
  assert.equal(value(query.nodes.find(node => node.selector === '.detail .goalTrail'), 'grid-template-columns'), 'minmax(0, 1fr)');
  assert.equal(value(query.nodes.find(node => node.selector.endsWith('::after')), 'display'), 'none');
});

// The measured full/320 first alignment requested591.5 native scroll pixels.
// Model integer scroll rounding without changing the actual coverage assertions.
function nativeSequence({ target = 591.5, scale = 1, height = 612.125, noop = false,
  throwScroll = false, extraStep = 0, oldRounding = false } = {}) {
  const frames = [], motion = [], requests = [], screenshots = [], focusChecks = [];
  const original = 693; let firstAlignment = true; let savedError;
  const pane = { top: 77, bottom: 900, height: 823 };
  const main = { scrollTop: original, scrollLeft: 0, clientHeight: pane.height / scale,
    getBoundingClientRect: () => pane,
    scrollTo(options) {
      requests.push({ kind: 'to', ...options });
      if (firstAlignment) {
        firstAlignment = false;
        if (throwScroll) { savedError = new Error('Synthetic native scroll failure'); throw savedError; }
        if (noop) return;
      }
      main.scrollTop = Math.max(0, Math.round(options.top));
    },
    scrollBy(options) {
      requests.push({ kind: 'by', ...options });
      main.scrollTop = Math.max(0, Math.round(main.scrollTop + options.top + extraStep));
    },
  };
  const region = { closest: () => main,
    getBoundingClientRect: () => {
      const top = pane.top + scale * (target - main.scrollTop);
      return { top, bottom: top + height, height };
    },
  };
  const focus = {}; const window = {};
  const installInvitationScreenshotWatch = () => {};
  const settleCaptureMotion = () => {};
  region.evaluate = async (fn, argument) => {
    if (fn === settleCaptureMotion) return { outcome: 'stable' };
    if (fn === installInvitationScreenshotWatch) {
      window.__invitationScreenshotWatch = { finish: () => ({ sampledFrames: 2, activeFrames: 0,
        started: 0, initialActive: 0, finalActive: 0 }) };
      return;
    }
    return fn(region, argument);
  };
  const globals = { innerHeight: 900, window, Date, installInvitationScreenshotWatch, settleCaptureMotion,
    expect: value => value === focus ? {
      toBeFocused: async () => { focusChecks.push('focused'); },
      toBeInViewport: async () => { focusChecks.push('visible'); },
    } : expect(value),
  };
  const page = { screenshot: async options => { screenshots.push(options.path); }, evaluate: async fn => fn() };
  const info = { outputPath: name => name, attach: async () => {} };
  const alignment = 'Math.floor(main.scrollTop + (box.top - Math.max(0, pane.top)) / scale)';
  const transform = text => {
    if (!oldRounding) return text;
    assert.equal(text.split(alignment).length, 2);
    return text.replace(alignment, 'main.scrollTop + (box.top - Math.max(0, pane.top)) / scale');
  };
  const run = () => evaluate('captureViewportSequence', globals, transform)(page, region, focus,
    'private-invitation-full-no-reservation-Hell-320-100', info, frames, motion);
  return { run, main, frames, motion, requests, screenshots, focusChecks, original, get savedError() { return savedError; } };
}

test('actual native sequence floors measured591.5 instead of rounding to592 and covers the entire region', async () => {
  const f = nativeSequence(); await f.run();
  assert.equal(f.requests[0].top, 591); assert.equal(f.frames.length, 1);
  assert.equal(f.frames[0].top, 591); assert.equal(f.frames[0].regionTop, 77.5);
  assert.equal(f.frames[0].visibleStart, 0); assert.equal(f.frames[0].visibleEnd, 612.125);
  assert.equal(f.screenshots.length, 2); assert.equal(f.motion.length, 2);
  assert.equal(f.main.scrollTop, f.original); assert.deepEqual(f.focusChecks, ['focused', 'visible', 'focused', 'visible']);
});
test('literal old alignment exposes the measured0.5 first-frame gap and preserves failing bounds', async () => {
  const f = nativeSequence({ oldRounding: true }); await expect(f.run()).rejects.toThrow();
  assert.equal(f.requests[0].top, 591.5); assert.equal(f.frames[0].top, 592);
  assert.equal(f.frames[0].regionTop, 76.5); assert.equal(f.frames[0].visibleStart, 0.5);
  assert.equal(f.frames[0].index, 1); assert.equal(f.screenshots.length, 1);
  assert.equal(f.main.scrollTop, f.original);
});
test.each([591.1, 591.9, 592, 0.5])('fractional alignment%s remains strictly gap-free without an epsilon', async target => {
  const f = nativeSequence({ target }); await f.run();
  assert.equal(f.requests[0].top, Math.floor(target)); assert.equal(f.frames[0].visibleStart, 0);
  assert.equal(f.frames[0].visibleEnd, f.frames[0].regionHeight);
});
test('scaled native sequence preserves strict overlapping originals and complete coverage', async () => {
  const f = nativeSequence({ scale: 2, height: 1224.25 }); await f.run();
  assert.equal(f.frames.length, 2); assert.equal(f.frames[0].visibleStart, 0);
  assert.ok(f.frames[1].visibleStart <= f.frames[0].visibleEnd);
  assert.equal(f.frames[1].visibleEnd, 1224.25); assert.equal(f.main.scrollTop, f.original);
});
test('a no-op native alignment still fails strict coverage and retains first-frame bounds', async () => {
  const f = nativeSequence({ noop: true }); await expect(f.run()).rejects.toThrow();
  assert.equal(f.frames[0].top, 693); assert.equal(f.frames[0].visibleStart, 101.5);
  assert.equal(f.screenshots.length, 1); assert.equal(f.requests.at(-1).top, f.original);
});
test('a genuine later scroll gap still fails and retains both measured frames', async () => {
  const f = nativeSequence({ height: 1600, extraStep: 100 }); await expect(f.run()).rejects.toThrow();
  assert.equal(f.frames.length, 2); assert.ok(f.frames[1].visibleStart > f.frames[0].visibleEnd);
  assert.equal(f.screenshots.length, 2); assert.equal(f.main.scrollTop, f.original);
});
test('unsuccessful native scroll preserves the original error and still restores focus and position', async () => {
  const f = nativeSequence({ throwScroll: true }); let error;
  try { await f.run(); } catch (caught) { error = caught; }
  assert.ok(error); assert.equal(error, f.savedError);
  assert.equal(f.frames.length, 0); assert.equal(f.requests.at(-1).top, f.original);
  assert.deepEqual(f.focusChecks, ['focused', 'visible', 'focused', 'visible']);
});
test('native sequence still fails after the unchanged eight-frame coverage limit', async () => {
  const f = nativeSequence({ height: 10000 }); await expect(f.run()).rejects.toThrow();
  assert.equal(f.frames.length, 8); assert.equal(f.screenshots.length, 9);
  assert.equal(f.main.scrollTop, f.original);
});
