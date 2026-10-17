import { writeFile } from 'node:fs/promises';
import { createDeferredCaptureErrors } from './deferred-capture-errors';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Request, type Route, type TestInfo } from '@playwright/test';
import {
  missionInvitationAcknowledgment, missionInvitationConsent, missionInvitationFull, missionInvitationPreferencePrivacy,
  type MissionInvitationAcknowledgment, type MissionInvitationCandidates, type MissionInvitationList, type SendMissionInvitation,
} from '../types/space-mission-invitations';
import { createPrivateInvitationFixture, type InvitationAccount, type InvitationFixture, type InvitationScope } from './private-mission-invitations-fixture';

// SOURCE ONLY until regular guarded CI runs it. Do not launch Chromium in the
// reconstruction executor: its socket EPERM is an explicit no-retry boundary.
const preferenceApi = '/api/space-missions/invitation-preference';
const invitationListApi = '/api/space-missions/invitations';
const recipientConsent = 'Ich möchte freiwillig an dieser Mission teilnehmen.';
const retryName = 'Dieselbe Einladungsanfrage erneut prüfen';
const invitationRegion = (page: Page, kind: string) => page.locator(`[data-invitation-region="${kind}"]`);
const isResponse = (path: string, method = 'GET') => (response: { url: () => string; request: () => Request }) =>
  new URL(response.url()).pathname === path && response.request().method() === method;

async function activate(page: Page, control: Locator, timeout?: number) {
  await expect(control).toBeVisible({ timeout });
  await expect(control).toBeEnabled({ timeout });
  await control.focus({ timeout });
  await expect(control).toBeFocused({ timeout });
  await page.keyboard.press('Enter');
}

async function login(page: Page, account: InvitationAccount, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(account.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

async function createLearners(browser: Browser, fixture: InvitationFixture) {
  const contexts: BrowserContext[] = [];
  try {
    for (const account of [fixture.sender, fixture.recipient]) {
      const context = await browser.newContext({ baseURL: fixture.origin, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      contexts.push(context);
      // These are pre-existing device-local presentation choices, never private
      // recipients, selections or request bodies. No permissions are granted.
      await context.addInitScript(origin => {
        if (location.origin !== origin) return;
        localStorage.setItem('forge-journey-mascot-hidden', 'true');
        localStorage.setItem('forge-community-motion-off', 'true');
      }, fixture.origin);
      await login(await context.newPage(), account, fixture.password);
    }
    return { contexts, sender: contexts[0].pages()[0], recipient: contexts[1].pages()[0] };
  } catch (error) {
    const closes = await Promise.allSettled(contexts.map(context => Promise.resolve().then(() => context.close())));
    const failures = [error, ...closes.flatMap(result => result.status === 'rejected' ? [result.reason] : [])];
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, 'Invitation learner setup and context cleanup failed.');
  }
}

function recordMissionWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && /^\/api\/(?:space-missions(?:\/|$)|spaces\/[^/]+\/missions(?:\/|$))/.test(path)) {
      writes.push(`${request.method()} ${path}`);
    }
  });
  return writes;
}

async function mutationSilence(writes: string[], work: () => Promise<void>) {
  const before = writes.length;
  await work();
  // A finite observation window after the asserted fresh rendered state catches
  // queued effects/debounce writes; this does not accelerate the real poller.
  await new Promise<void>(resolve => setTimeout(resolve, 750));
  expect(writes.slice(before)).toEqual([]);
}

async function openOwnInvitations(page: Page) {
  await page.goto('/community/missions');
  await activate(page, page.getByRole('button', { name: 'Meine Einladungen', exact: true }));
  await expect(invitationRegion(page, 'preference')).toBeVisible();
}

async function enableReceiving(page: Page) {
  const preference = invitationRegion(page, 'preference');
  await expect(preference.getByText(missionInvitationPreferencePrivacy, { exact: true })).toBeVisible();
  const enable = preference.getByRole('button', { name: 'Einladungen einschalten', exact: true });
  await expect(enable).toBeDisabled();
  const consent = preference.getByRole('checkbox', { name: 'Ich möchte Missionseinladungen erhalten.', exact: true });
  await expect(consent).not.toBeChecked();
  await consent.check();
  const updated = page.waitForResponse(isResponse(preferenceApi, 'PUT'));
  await activate(page, enable);
  const response = await updated;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(await response.json()).toEqual({ enabled: true, revision: 1 });
  await expect(preference.getByRole('button', { name: 'Einladungen ausschalten', exact: true })).toBeVisible();
}

async function joinAsSender(page: Page, scope: InvitationScope) {
  await page.goto(scope.href);
  await expect(page.getByRole('heading', { level: 1, name: scope.title, exact: true })).toBeVisible();
  const joined = page.waitForResponse(isResponse(`${scope.api}/participation`, 'POST'));
  await activate(page, page.getByRole('button', { name: 'Freiwillig teilnehmen', exact: true }));
  expect((await joined).status()).toBe(200);
  await expect(invitationRegion(page, 'composer')).toBeVisible();
}

async function selectRecipient(page: Page, scope: InvitationScope, recipient: InvitationAccount) {
  const composer = invitationRegion(page, 'composer');
  await composer.getByRole('textbox', { name: 'Nach Namen suchen', exact: true }).fill(recipient.name);
  const searched = page.waitForResponse(isResponse(`${scope.api}/invitation-candidates`));
  await activate(page, composer.getByRole('button', { name: 'Person suchen', exact: true }));
  const response = await searched;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const candidates = await response.json() as MissionInvitationCandidates;
  const match = candidates.items.find(item => item.user.id === recipient.id);
  expect(match).toBeDefined();
  expect(Object.keys(match!.user).sort()).toEqual(['id', 'image', 'name']);
  expect(Object.keys(match!).sort()).toEqual(['selection', 'user']);
  // Candidate existence never reveals receiving consent or earlier outcomes.
  expect(Object.keys(candidates).sort()).toEqual(['items', 'senderAccessEpoch', 'senderEpoch']);
  await composer.getByRole('radio', { name: recipient.name, exact: true }).check();
  await expect(composer.getByRole('radio', { name: recipient.name, exact: true })).toBeChecked();
  return match!.selection;
}

async function processedAcknowledgment(page: Page, scope: InvitationScope) {
  const pending = page.waitForResponse(isResponse(`${scope.api}/invitations`, 'POST'));
  await activate(page, invitationRegion(page, 'composer').getByRole('button', { name: 'Einladung an ausgewählte Person anfragen', exact: true }));
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const acknowledgment = await response.json() as MissionInvitationAcknowledgment;
  expect(acknowledgment).toEqual({ requestId: expect.any(String), processed: true });
  expect(Object.keys(acknowledgment).sort()).toEqual(['processed', 'requestId']);
  await expect(invitationRegion(page, 'composer').getByText(missionInvitationAcknowledgment, { exact: true })).toBeVisible();
  await expect(invitationRegion(page, 'composer')).not.toContainText(/zugestellt|gelesen|angenommen|abgelehnt|Empfangsbestätigung/i);
  return { acknowledgment, body: response.request().postDataJSON() as SendMissionInvitation };
}

async function ownList(page: Page) {
  const response = await page.request.get(invitationListApi);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  return await response.json() as MissionInvitationList;
}

async function delayedCandidateAcrossScopeABA(page: Page, fixture: InvitationFixture, writes: string[]) {
  let release!: () => void; let arrived!: () => void; let handled!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const upstreamReady = new Promise<void>(resolve => { arrived = resolve; });
  const callbackDone = new Promise<void>(resolve => { handled = resolve; });
  const pattern = `**${fixture.primary.api}/invitation-candidates?*`;
  const delayActualRead = async (route: Route) => {
    // Keep the real server's actual GET response in flight while the old UI
    // scope is destroyed. Invite/decision endpoints are not intercepted here.
    const actual = await route.fetch();
    expect(actual.status()).toBe(200); arrived();
    await gate;
    try { await route.fulfill({ response: actual }); }
    catch (error) { if (!route.request().failure()) throw error; }
    finally { handled(); }
  };
  await page.route(pattern, delayActualRead);
  try {
    const composer = invitationRegion(page, 'composer');
    await composer.getByRole('textbox', { name: 'Nach Namen suchen', exact: true }).fill(fixture.recipient.name);
    await activate(page, composer.getByRole('button', { name: 'Person suchen', exact: true }));
    await upstreamReady;
    await mutationSilence(writes, async () => {
      await activate(page, page.getByRole('link', { name: 'Space-Missionen', exact: true }));
      await activate(page, page.getByRole('link', { name: fixture.alternate.title, exact: true }));
      await expect(composer.getByRole('textbox', { name: 'Nach Namen suchen', exact: true })).toHaveValue('');
      await expect(composer).not.toContainText(fixture.recipient.name);
      await activate(page, page.getByRole('link', { name: 'Space-Missionen', exact: true }));
      await activate(page, page.getByRole('link', { name: fixture.primary.title, exact: true }));
      await expect(composer.getByRole('textbox', { name: 'Nach Namen suchen', exact: true })).toHaveValue('');
      release(); await callbackDone;
      await expect(composer.getByRole('radio')).toHaveCount(0);
      await expect(composer).not.toContainText(fixture.recipient.name);
    });
    expect(fixture.snapshot(fixture.alternate).requests).toBe(0);
  } finally { release(); await page.unroute(pattern, delayActualRead); }
}

async function assertNoPrivatePersistence(page: Page, privateMarkers: string[], allowedInvitationId?: string) {
  const markers = privateMarkers.filter(Boolean);
  const navigation = new URL(page.url());
  // The server-built opaque invitation selector is the one approved navigation
  // field. Peer IDs, candidate tokens and serialized requests may never enter
  // the browser address/history URL, even in percent-encoded form.
  if (allowedInvitationId) {
    expect(navigation.searchParams.getAll('invitation')).toEqual([allowedInvitationId]);
    navigation.searchParams.delete('invitation');
  }
  const address = decodeURIComponent(navigation.href);
  expect(markers.filter(marker => address.includes(marker) || navigation.href.includes(encodeURIComponent(marker))).length).toBe(0);
  const matches = await page.evaluate(async needles => {
    const hasPrivate = (value: unknown) => {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      return typeof serialized === 'string' && needles.some(needle => serialized.includes(needle));
    };
    let local = 0; let session = 0; let indexed = 0; let caches = 0;
    for (const [storage, kind] of [[localStorage, 'local'], [sessionStorage, 'session']] as const) {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)!;
        if (hasPrivate(key) || hasPrivate(storage.getItem(key))) { if (kind === 'local') local++; else session++; }
      }
    }
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        for (const store of Array.from(database.objectStoreNames)) {
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const request = database.transaction(store, 'readonly').objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
          if (hasPrivate(info.name) || hasPrivate(store) || records.some(hasPrivate)) indexed++;
        }
      } finally { database.close(); }
    }
    for (const name of await window.caches.keys()) {
      const cache = await window.caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (hasPrivate(name) || hasPrivate(request.url) || hasPrivate(await response?.text())) caches++;
      }
    }
    return { local, session, indexed, caches };
  }, markers);
  expect(matches).toEqual({ local: 0, session: 0, indexed: 0, caches: 0 });
}

/** Fixed structural labels and numeric layout only. No DOM text, IDs, URLs,
 * arbitrary attributes, request bodies, account values or environment values. */
function readInvitationGeometry(element: Element) {
  const bounds = (node: Element) => {
    const rectangle = node.getBoundingClientRect();
    return { left: rectangle.left, right: rectangle.right, top: rectangle.top, bottom: rectangle.bottom,
      width: rectangle.width, height: rectangle.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop, scrollLeft: node.scrollLeft,
      leftOverflow: rectangle.left < -1, rightOverflow: rectangle.right > innerWidth + 1, scrollOverflow: node.scrollWidth > node.clientWidth + 1 };
  };
  const main = element.closest('main');
  if (!main || !element.isConnected) throw new Error('Invitation capture requires its connected real main.');
  const overflows = (box: ReturnType<typeof bounds>) => box.left < -1 || box.right > innerWidth + 1 || box.scrollWidth > box.clientWidth + 1;
  const violations: string[] = [];
  const surfaces = { document: bounds(document.documentElement), body: bounds(document.body), main: bounds(main), region: bounds(element) };
  for (const [name, box] of Object.entries(surfaces)) if (overflows(box)) violations.push(name);
  const descendants: { label: string; bounds: ReturnType<typeof bounds>; whiteSpace: string; minWidth: number | null; inRegion: boolean; ancestors: { label: string; bounds: ReturnType<typeof bounds> }[] }[] = [];
  const texts: { label: string; left: number; right: number; top: number; bottom: number }[] = [];
  let scannedDescendants = 0; let omittedDescendants = 0; let scannedTextRanges = 0; let omittedTextRanges = 0; let ancestorRows = 0; let omittedAncestorRows = 0;
  const selector = 'button,input,textarea,select,a,label,h1,h2,h3,p,li,[role="status"],[role="alert"]';
  for (const node of main.querySelectorAll(selector)) {
    const index = scannedDescendants++;
    if (!node.getClientRects().length || ['hidden', 'collapse'].includes(getComputedStyle(node).visibility)) continue;
    const box = bounds(node);
    const tag = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'LABEL', 'H1', 'H2', 'H3', 'P', 'LI'].includes(node.tagName) ? node.tagName.toLowerCase() : 'semantic';
    const label = `main-${tag}-${index}`;
    if (overflows(box)) violations.push(label);
    const style = getComputedStyle(node); const minimum = parseFloat(style.minWidth);
    const ancestors: { label: string; bounds: ReturnType<typeof bounds> }[] = [];
    if (overflows(box)) {
      let depth = 0;
      for (let parent = node.parentElement; parent && depth < 6; parent = parent.parentElement) {
        if (ancestorRows < 48) { ancestors.push({ label: `ancestor-${depth}`, bounds: bounds(parent) }); ancestorRows++; }
        else omittedAncestorRows++;
        depth++;
      }
    }
    const row = { label, bounds: box, ancestors,
      whiteSpace: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(style.whiteSpace) ? style.whiteSpace : 'other',
      minWidth: Number.isFinite(minimum) ? minimum : null, inRegion: element.contains(node) };
    if (descendants.length < 160) descendants.push(row);
    else {
      omittedDescendants++;
      // Keep later failing leaves ahead of redundant nonfailing rows.
      const replace = overflows(box) ? descendants.findLastIndex(row => !overflows(row.bounds)) : -1;
      if (replace >= 0) { descendants.splice(replace, 1); descendants.push(row); }
    }
  }
  const text = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  while (text.nextNode()) {
    const node = text.currentNode;
    // Read only to exclude empty nodes; never retain authored or private text.
    if (!node.textContent?.trim() || !node.parentElement?.getClientRects().length || ['hidden', 'collapse'].includes(getComputedStyle(node.parentElement).visibility)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const box of range.getClientRects()) {
      const index = scannedTextRanges++;
      if (box.left >= -1 && box.right <= innerWidth + 1) continue;
      const label = `main-text-${index}`; violations.push(label);
      if (texts.length < 80) texts.push({ label, left: box.left, right: box.right, top: box.top, bottom: box.bottom });
      else omittedTextRanges++;
    }
  }
  const active = main.getAnimations({ subtree: true }).filter(animation => animation.pending || animation.playState === 'running' || animation.playState === 'paused');
  const animations = active.slice(0, 80).map(animation => {
    const timing = animation.effect?.getTiming();
    return { pending: animation.pending, playState: animation.playState,
      iterations: timing?.iterations === Infinity ? 'infinite' : timing?.iterations ?? null,
      duration: typeof timing?.duration === 'number' ? timing.duration : 'auto' };
  });
  return { viewport: { width: innerWidth, height: innerHeight }, zoom: Number(getComputedStyle(document.documentElement).zoom),
    ...surfaces, descendants, texts, ancestorRows, omittedAncestorRows, scannedDescendants, omittedDescendants, scannedTextRanges, omittedTextRanges,
    violations: violations.slice(0, 256), omittedViolations: Math.max(0, violations.length - 256), animations, activeAnimations: active.length,
    omittedAnimations: Math.max(0, active.length - animations.length) };
}

// Observe actual fonts, mount/layout, mutations, native scroll and focus styles,
// including the whole real main. Style/layout reads precede getAnimations so
// newly generated reduced-motion transitions cannot hide behind quiet frames.
// Keep the existing 1000ms/60-frame budget. Three matching frames AND 150ms
// without motion/layout/mutation are required, never the first three frames.
function settleCaptureMotion(element: Element) {
  return new Promise<{ outcome: 'stable' | 'deadline' | 'frame-budget'; frames: number; quietFrames: number; quietMs: number;
    mutations: number; resizes: number; activeFrames: number; geometryChanges: number }>((resolve, reject) => {
    const main = element.closest('main');
    let frames = 0; let quietFrames = 0; let quietSince = performance.now(); let previous = '';
    let mutations = 0; let resizes = 0; let activeFrames = 0; let geometryChanges = 0; let done = false; let raf = 0;
    const changed = () => { quietFrames = 0; quietSince = performance.now(); };
    const mutation = new MutationObserver(() => { mutations++; changed(); });
    mutation.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const resize = new ResizeObserver(() => { resizes++; changed(); });
    for (const node of [document.documentElement, main, element]) if (node) resize.observe(node);
    const finish = (outcome: 'stable' | 'deadline' | 'frame-budget', error?: unknown) => {
      if (done) return;
      done = true; clearTimeout(timer); if (raf) cancelAnimationFrame(raf); mutation.disconnect(); resize.disconnect();
      if (error) { reject(error); return; }
      resolve({ outcome, frames, quietFrames, quietMs: Math.max(0, performance.now() - quietSince), mutations, resizes, activeFrames, geometryChanges });
    };
    const timer = setTimeout(() => finish('deadline'), 1000);
    const tick = () => {
      if (done) return;
      try {
      frames++;
      const nodes = [document.documentElement, main, element, document.activeElement];
      const geometry = JSON.stringify(nodes.map(node => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return [node.isConnected, box.left, box.top, box.width, box.height, node.scrollWidth, node.clientWidth,
          node.scrollHeight, node.clientHeight, node.scrollTop, node.scrollLeft, getComputedStyle(node).zoom];
      }));
      const active = !main || main.getAnimations({ subtree: true }).some(animation => animation.pending || animation.playState === 'running' || animation.playState === 'paused');
      if (active) activeFrames++;
      if (previous && previous !== geometry) geometryChanges++;
      const ready = element.isConnected && Boolean(main?.isConnected) && document.fonts.status === 'loaded' && !active;
      if (!ready || previous !== geometry) changed();
      quietFrames = ready ? quietFrames + 1 : 0; previous = geometry;
      if (quietFrames >= 3 && performance.now() - quietSince >= 150) finish('stable');
      else if (frames >= 60) finish('frame-budget');
      else raf = requestAnimationFrame(tick);
      } catch (error) { finish('deadline', error); }
    };
    raf = requestAnimationFrame(tick);
  });
}

type InvitationScreenshotMotion = { sampledFrames: number; activeFrames: number; started: number; initialActive: number; finalActive: number };
type InvitationCaptureWindow = Window & { __invitationScreenshotWatch?: { finish: () => InvitationScreenshotMotion } };

// Reader-style passive observation stays armed through the actual screenshot,
// including short transitions that could start and end between two evaluations.
function installInvitationScreenshotWatch(element: Element) {
  const main = element.closest('main'); const view = window as InvitationCaptureWindow;
  if (!main || !element.isConnected || view.__invitationScreenshotWatch) throw new Error('Invitation screenshot watch requires an unobserved connected main.');
  const active = () => {
    main.getBoundingClientRect(); // Flush actual layout before animation sampling.
    return main.getAnimations({ subtree: true }).filter(animation => animation.pending || animation.playState === 'running' || animation.playState === 'paused').length;
  };
  let sampledFrames = 0; let activeFrames = 0; let started = 0; let stopped = false; let raf = 0;
  const initialActive = active();
  const onStart = () => { started++; };
  const tick = () => { if (stopped) return; sampledFrames++; if (active()) activeFrames++; raf = requestAnimationFrame(tick); };
  main.addEventListener('animationstart', onStart, true); main.addEventListener('transitionrun', onStart, true);
  raf = requestAnimationFrame(tick);
  view.__invitationScreenshotWatch = { finish: () => {
    try { return { sampledFrames, activeFrames, started, initialActive, finalActive: active() }; }
    finally {
      stopped = true; if (raf) cancelAnimationFrame(raf);
      main.removeEventListener('animationstart', onStart, true); main.removeEventListener('transitionrun', onStart, true);
      delete view.__invitationScreenshotWatch;
    }
  } };
}

type CaptureState = 'pending-consent' | 'accepted-next-action' | 'full-no-reservation';
type CaptureErrors = ReturnType<typeof createDeferredCaptureErrors>;

async function writeInvitationEvidence(info: TestInfo, name: string, evidence: unknown) {
  const approved = /^private-invitation-(?:(?:pending-consent|accepted-next-action|full-no-reservation)-(?:Hell|Dunkel)-(?:1280-100|320-100|320-200)-geometry|real-journey-provenance|lifecycle-provenance)$/.exec(name);
  if (!approved || approved[0] !== name) {
    throw new Error('Invitation evidence requires a fixed approved technical filename.');
  }
  const json = JSON.stringify(evidence);
  if (Buffer.byteLength(json) > 192 * 1024) throw new Error('Invitation technical evidence exceeded its fixed 192KiB ceiling.');
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, json, { encoding: 'utf8', flag: 'wx' });
  await info.attach(name, { path, contentType: 'application/json' });
}

// Capture original viewport pixels only. A locator screenshot of an oversized
// region in a nested scrolling main can include unpainted space or site chrome.
// Native main scrolling provides explicit ordered originals, never a crop/stitch.
async function captureViewportSequence(page: Page, region: Locator, focus: Locator, prefix: string, info: TestInfo,
  frames: { index: number; top: number; left: number; regionTop: number; regionBottom: number; visibleStart: number; visibleEnd: number; regionHeight: number }[],
  screenshotMotion: InvitationScreenshotMotion[], deadline = Infinity) {
  const original = await region.evaluate(element => {
    const main = element.closest('main')!;
    return { top: main.scrollTop, left: main.scrollLeft };
  }, undefined, { timeout: 2000 });
  const failures: unknown[] = [];
  const save = async (name: string) => {
    const failures: unknown[] = [];
    if (Date.now() >= deadline) throw new Error('Invitation original capture exhausted its bounded state observation budget.');
    const path = info.outputPath(`${name}.png`);
    await region.evaluate(installInvitationScreenshotWatch, undefined, { timeout: 2000 });
    try {
      await page.screenshot({ path, timeout: 3000 });
      await info.attach(name, { path, contentType: 'image/png' });
    } catch (error) { failures.push(error); }
    finally {
      try {
        const motion = await page.evaluate(() => (window as InvitationCaptureWindow).__invitationScreenshotWatch!.finish());
        screenshotMotion.push(motion);
        expect(motion.initialActive).toBe(0); expect(motion.finalActive).toBe(0);
        expect(motion.activeFrames).toBe(0); expect(motion.started).toBe(0);
      } catch (error) { failures.push(error); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Invitation original screenshot and motion watch failed.');
  };
  try {
    await expect(focus).toBeFocused({ timeout: 2000 }); await expect(focus).toBeInViewport({ timeout: 2000 });
    await save(prefix);
    const needsSequence = await region.evaluate(element => {
      const main = element.closest('main')!; const pane = main.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return box.top < Math.max(0, pane.top) || box.bottom > Math.min(innerHeight, pane.bottom);
    }, undefined, { timeout: 2000 });
    if (needsSequence) {
      await region.evaluate(element => {
        const main = element.closest('main')!; const pane = main.getBoundingClientRect(); const box = element.getBoundingClientRect();
        const scale = pane.height / main.clientHeight;
        main.scrollTo({ top: main.scrollTop + (box.top - Math.max(0, pane.top)) / scale, left: main.scrollLeft, behavior: 'instant' });
      }, undefined, { timeout: 2000 });
      let covered = 0; let complete = false;
      for (let index = 1; index <= 8; index++) {
        const motion = await region.evaluate(settleCaptureMotion, undefined, { timeout: 2000 });
        expect(motion.outcome).toBe('stable');
        const frame = await region.evaluate((element, index) => {
          const main = element.closest('main')!; const pane = main.getBoundingClientRect(); const box = element.getBoundingClientRect();
          const top = Math.max(0, pane.top); const bottom = Math.min(innerHeight, pane.bottom);
          return { index, top: main.scrollTop, left: main.scrollLeft, regionTop: box.top, regionBottom: box.bottom,
            visibleStart: Math.max(0, top - box.top), visibleEnd: Math.min(box.height, bottom - box.top), regionHeight: box.height };
        }, index, { timeout: 2000 });
        expect(frame.visibleStart).toBeLessThanOrEqual(covered);
        expect(frame.visibleEnd).toBeGreaterThan(covered);
        frames.push(frame); await save(`${prefix}-sequence-${index}`); covered = frame.visibleEnd;
        if (covered >= frame.regionHeight) { complete = true; break; }
        await region.evaluate(element => {
          const main = element.closest('main')!; const pane = main.getBoundingClientRect(); const scale = pane.height / main.clientHeight;
          main.scrollBy({ top: (Math.min(innerHeight, pane.bottom) - Math.max(0, pane.top) - 32) / scale, behavior: 'instant' });
        }, undefined, { timeout: 2000 });
      }
      expect(complete, 'The bounded original viewport sequence must cover the entire actual region.').toBe(true);
    }
  } catch (error) { failures.push(error); }
  finally {
    const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { failures.push(error); } };
    await attempt(() => region.evaluate((element, original) => { element.closest('main')!.scrollTo({ top: original.top, left: original.left, behavior: 'instant' }); }, original, { timeout: 2000 }));
    await attempt(async () => { await expect(focus).toBeFocused({ timeout: 2000 }); });
    await attempt(async () => { await expect(focus).toBeInViewport({ timeout: 2000 }); });
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Invitation framing and restoration failed.');
}

async function captureState(page: Page, region: Locator, focus: Locator, state: CaptureState, info: TestInfo, errors: CaptureErrors) {
  let baseline: { zoom: string; viewport: { width: number; height: number } } | undefined;
  await errors.collect(`${state} capture setup`, async () => {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Invitation capture requires an explicit viewport.');
    baseline = { zoom: await page.evaluate(() => document.documentElement.style.zoom), viewport };
  }, async () => {});
  if (!baseline) return;
  // Per-state budget protects independent business assertions. Individual UI
  // operations have short native Playwright timeouts; no abandoned Promise.race.
  const deadline = Date.now() + 20_000;
  for (const theme of ['Hell', 'Dunkel']) {
    for (const { width, zoom } of [{ width: 1280, zoom: 1 }, { width: 320, zoom: 1 }, { width: 320, zoom: 2 }]) {
      const prefix = `private-invitation-${state}-${theme}-${width}-${zoom * 100}`;
      let phase: 'budget' | 'setup' | 'focus' | 'settle' | 'geometry' | 'screenshot' | 'complete' = 'setup';
      let settling: Awaited<ReturnType<typeof settleCaptureMotion>> | null = null;
      let geometry: ReturnType<typeof readInvitationGeometry> | null = null;
      let afterScreenshot: Pick<ReturnType<typeof readInvitationGeometry>, 'viewport' | 'zoom' | 'main' | 'region' | 'violations' | 'omittedViolations' | 'activeAnimations' | 'animations'> | null = null;
      const frames: Parameters<typeof captureViewportSequence>[5] = [];
      const screenshotMotion: InvitationScreenshotMotion[] = [];
      await errors.collect(prefix, async () => {
        phase = 'budget';
        if (Date.now() >= deadline) throw new Error('Invitation capture exceeded its bounded 20s state observation budget.');
        phase = 'setup';
        await page.evaluate(() => { document.documentElement.style.zoom = ''; });
        await page.setViewportSize({ width: 1280, height: 900 });
        const themeTrigger = page.getByRole('button', { name: 'Farbschema auswählen', exact: true });
        await activate(page, themeTrigger, 2000);
        await page.getByRole('menuitem', { name: theme, exact: true }).click({ timeout: 2000 });
        // Observe actual Radix exit/unmount and asynchronous focus restoration.
        await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0, { timeout: 2000 });
        await expect(themeTrigger).toBeFocused({ timeout: 2000 });
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        phase = 'focus'; await focus.scrollIntoViewIfNeeded({ timeout: 2000 }); await focus.focus({ timeout: 2000 });
        await expect(focus).toBeFocused({ timeout: 2000 }); await expect(focus).toBeInViewport({ timeout: 2000 });
        phase = 'settle'; settling = await region.evaluate(settleCaptureMotion, undefined, { timeout: 2000 });
        phase = 'geometry'; geometry = await region.evaluate(readInvitationGeometry, undefined, { timeout: 2000 });
        expect(settling.outcome).toBe('stable');
        await expect(focus).toBeFocused({ timeout: 2000 }); await expect(focus).toBeInViewport({ timeout: 2000 });
        expect(geometry.violations).toEqual([]); expect(geometry.omittedViolations).toBe(0);
        expect(geometry.zoom).toBe(zoom); expect(geometry.activeAnimations).toBe(0); expect(geometry.animations).toEqual([]);
        expect(await page.evaluate(() => localStorage.getItem('forge-journey-mascot-hidden'))).toBe('true');
        phase = 'screenshot'; await captureViewportSequence(page, region, focus, prefix, info, frames, screenshotMotion, deadline);
        const after = await region.evaluate(readInvitationGeometry, undefined, { timeout: 2000 });
        afterScreenshot = { viewport: after.viewport, zoom: after.zoom, main: after.main, region: after.region, violations: after.violations,
          omittedViolations: after.omittedViolations, activeAnimations: after.activeAnimations, animations: after.animations };
        expect(afterScreenshot.violations).toEqual([]); expect(afterScreenshot.omittedViolations).toBe(0);
        expect(afterScreenshot.activeAnimations).toBe(0); expect(afterScreenshot.animations).toEqual([]);
        phase = 'complete';
      }, async () => {
        // Every independent cleanup is attempted. Keep original errors internally,
        // while disk JSON contains only the fixed phase and bounded technical data.
        const failures: unknown[] = [];
        const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { failures.push(error); } };
        await attempt(() => page.evaluate(() => (window as InvitationCaptureWindow).__invitationScreenshotWatch?.finish()));
        await attempt(async () => { if (!geometry) geometry = await region.evaluate(readInvitationGeometry, undefined, { timeout: 2000 }); });
        await attempt(() => writeInvitationEvidence(info, `${prefix}-geometry`, { schema: 1, phase, settling, geometry, afterScreenshot, frames, screenshotMotion }));
        await attempt(async () => {
          if (await page.getByRole('menu', { includeHidden: true }).count()) {
            await page.keyboard.press('Escape');
            await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0, { timeout: 2000 });
          }
        });
        await attempt(() => page.evaluate(zoom => { document.documentElement.style.zoom = zoom; }, baseline!.zoom));
        await attempt(() => page.setViewportSize(baseline!.viewport));
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, 'Invitation capture cleanup failed.');
      });
    }
  }
}

// Every context close settles before fixture teardown. Cleanup must never
// replace an already retained original core/capture error.
async function finishInvitationJourney(learners: Awaited<ReturnType<typeof createLearners>> | undefined,
  fixture: InvitationFixture, original?: { error: unknown }) {
  const failures: unknown[] = original ? [original.error] : [];
  try {
    if (learners) {
      const closes = await Promise.allSettled(learners.contexts.map(context => Promise.resolve().then(() => context.close())));
      for (const result of closes) if (result.status === 'rejected') failures.push(result.reason);
    }
  } catch (error) { failures.push(error); }
  finally {
    try { await fixture.cleanup(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Invitation journey and cleanup failed.');
}

test('two USER learners deliberately invite, consent and share in an existing private mission', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'One isolated journey explicitly checks desktop, 320px, 200% zoom and both themes.');
  test.setTimeout(240_000);
  const fixture = await createPrivateInvitationFixture(request);
  let learners: Awaited<ReturnType<typeof createLearners>> | undefined;
  const captureErrors = createDeferredCaptureErrors();
  let original: { error: unknown } | undefined;
  try {
    await captureErrors.finishWith(async () => {
      learners = await createLearners(browser, fixture);
      const { sender, recipient } = learners;
      const errors: string[] = [];
      for (const page of [sender, recipient]) page.on('pageerror', error => errors.push(error.message));
      const senderWrites = recordMissionWrites(sender); const recipientWrites = recordMissionWrites(recipient);
      await openOwnInvitations(recipient);
      const initial = await recipient.request.get(preferenceApi);
      expect(initial.status()).toBe(200);
      expect(await initial.json()).toEqual({ enabled: false, revision: 0 });
      expect(recipientWrites).toEqual([]);
      expect(fixture.snapshot()).toMatchObject({ participants: 0, recipientParticipations: 0, invitations: 0 });
      await joinAsSender(sender, fixture.primary);

      // Default-off is quiet, yet the same named same-Space USER remains searchable.
      await selectRecipient(sender, fixture.primary, fixture.recipient);
      const quiet = await processedAcknowledgment(sender, fixture.primary);
      expect(fixture.snapshot()).toMatchObject({ participants: 1, recipientParticipations: 0, invitations: 0, requests: 1, recipientNotices: 0 });
      expect((await ownList(recipient)).items).toEqual([]);
      await mutationSilence(recipientWrites, async () => {
        await recipient.reload();
        await activate(recipient, recipient.getByRole('button', { name: 'Meine Einladungen', exact: true }));
        await expect(invitationRegion(recipient, 'preference').getByRole('checkbox', { name: 'Ich möchte Missionseinladungen erhalten.', exact: true })).not.toBeChecked();
        await expect(invitationRegion(recipient, 'preference').getByRole('button', { name: 'Einladungen einschalten', exact: true })).toBeDisabled();
      });
      await enableReceiving(recipient);
      await recipient.goto('/notifications');
      await expect(recipient.getByRole('heading', { name: 'Noch keine Benachrichtigungen', exact: true })).toBeVisible();
      await selectRecipient(sender, fixture.primary, fixture.recipient);
      const sent = await processedAcknowledgment(sender, fixture.primary);
      expect(Object.keys(sent.acknowledgment)).toEqual(Object.keys(quiet.acknowledgment));
      expect(sent.acknowledgment.processed).toBe(quiet.acknowledgment.processed);
      expect(sent.body.recipientId).toBe(fixture.recipient.id);
      expect(fixture.snapshot()).toMatchObject({ participants: 1, recipientParticipations: 0, invitations: 1, requests: 2, recipientNotices: 1 });
      await assertNoPrivatePersistence(sender, [fixture.recipient.id, fixture.recipient.name, sent.body.requestId, ...Object.values(sent.body.selection)]);

      // Reuse the unmodified shared inbox/poller and its authenticated open action.
      await recipient.bringToFront();
      await recipient.evaluate(() => window.dispatchEvent(new Event('focus')));
      const notice = recipient.getByRole('article').filter({ hasText: 'Du hast eine Einladung zu einer Space-Mission.' });
      await expect(notice).toBeVisible();
      await expect(notice).not.toContainText(fixture.sender.name); await expect(notice).not.toContainText(fixture.primary.title);
      await activate(recipient, notice.getByRole('button', { name: 'Als gelesen markieren', exact: true }));
      expect(fixture.snapshot().recipientParticipations).toBe(0);
      await activate(recipient, notice.getByRole('button', { name: 'Einladung ansehen', exact: true }));
      const invitations = (await ownList(recipient)).items;
      expect(invitations).toHaveLength(1);
      const invitationId = invitations[0].id;
      const detailApi = `${fixture.primary.api}/invitations/${invitationId}`;
      await expect(recipient).toHaveURL(`${fixture.origin}${fixture.primary.href}?invitation=${invitationId}#mission-invitation`);
      const decision = invitationRegion(recipient, 'decision');
      await expect(decision.getByText(missionInvitationConsent, { exact: true })).toBeVisible();
      await expect(decision).toContainText(fixture.sender.name);
      await expect(decision.getByRole('button', { name: 'Einladung annehmen', exact: true })).toBeDisabled();
      expect(fixture.snapshot()).toMatchObject({ participants: 1, recipientParticipations: 0, recipientContributions: 0 });
      const forbidden = await sender.request.get(detailApi);
      expect(forbidden.status()).toBe(404);
      const forbiddenBody = await forbidden.text();
      expect(forbiddenBody).not.toContain(fixture.recipient.id);
      expect(forbiddenBody).not.toContain(fixture.primary.title);
      expect(forbiddenBody).not.toContain('ACCEPTED');
      expect((await ownList(sender)).items).toEqual([]);

      // Actual hard reload is read-only and forgets unchecked/checked local consent.
      await decision.getByRole('checkbox', { name: recipientConsent, exact: true }).check();
      await mutationSilence(recipientWrites, async () => {
        await recipient.reload();
        await expect(decision.getByRole('checkbox', { name: recipientConsent, exact: true })).not.toBeChecked();
      });
      expect(fixture.snapshot()).toMatchObject({ participants: 1, recipientParticipations: 0 });
      await captureState(recipient, decision, decision.getByRole('checkbox', { name: recipientConsent, exact: true }), 'pending-consent', info, captureErrors);

      // Existing bookmarks remain self-only intent and never reserve participation.
      await activate(recipient, recipient.getByRole('button', { name: `Für später merken: ${fixture.primary.title}`, exact: true }));
      const saved = recipient.getByRole('button', { name: `Nicht mehr merken: ${fixture.primary.title}`, exact: true });
      await expect(saved).toHaveAttribute('aria-pressed', 'true'); await expect(saved).toBeFocused();
      expect(fixture.snapshot().recipientParticipations).toBe(0);
      await decision.getByRole('checkbox', { name: recipientConsent, exact: true }).check();
      const accepted = recipient.waitForResponse(isResponse(`${detailApi}/decision`, 'POST'));
      await activate(recipient, decision.getByRole('button', { name: 'Einladung annehmen', exact: true }));
      const response = await accepted;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toEqual({ decision: 'ACCEPT', expectedRevision: invitations[0].revision });
      const result = await response.json();
      expect(result).toMatchObject({ invitation: { id: invitationId, state: 'ACCEPTED' }, mission: {
        id: fixture.primary.missionId, participation: { active: true, epoch: 1 }, myNextAction: { kind: 'SHARE_INSIGHT' }, ownBookmark: { saved: true },
      } });
      expect(result.mission).not.toHaveProperty('mission');
      expect(fixture.snapshot()).toMatchObject({ participants: 2, recipientParticipations: 1, recipientContributions: 0 });
      const next = invitationRegion(recipient, 'next-action');
      await expect(next.getByRole('heading', { name: 'Dein nächster Schritt', exact: true })).toHaveAttribute('id', 'mission-next-action');
      const action = next.getByRole('link', { name: 'Teile eine eigene Erkenntnis.', exact: true });
      await expect(action).toHaveAttribute('href', '#mission-contributions-composer');
      await captureState(recipient, next, action, 'accepted-next-action', info, captureErrors);
      await activate(recipient, action);
      await expect(recipient.locator('#mission-contributions-composer')).toBeFocused();
      const insight = 'Ein konkretes Beispiel macht die Erklärung für die anderen im Space nachvollziehbar.';
      await recipient.getByLabel('Deine Erkenntnis', { exact: true }).fill(insight);
      const shared = recipient.waitForResponse(isResponse(`${fixture.primary.api}/contributions`, 'POST'));
      await activate(recipient, recipient.getByRole('button', { name: 'Im Space teilen', exact: true }));
      const contribution = await shared;
      expect(contribution.status()).toBe(201);
      expect(contribution.request().postDataJSON()).toMatchObject({ kind: 'INSIGHT', content: insight, epoch: 1, targetContributionId: null });
      await expect(recipient.getByText('Dein Beitrag ist im Space sichtbar.', { exact: true })).toBeVisible();
      const mission = await (await recipient.request.get(fixture.primary.api)).json();
      expect(mission.myNextAction).toEqual({ kind: 'WAIT_FOR_PEER' });
      const own = mission.ownContributions.find((contribution: { kind: string }) => contribution.kind === 'INSIGHT');
      expect(own).toBeDefined();
      await expect(recipient.locator(`#mission-contribution-${own.id}`)).toContainText(insight);
      await expect(recipient.getByRole('region', { name: 'Erkenntnisse und Gedanken', exact: true })).toContainText(insight);
      expect(fixture.snapshot()).toMatchObject({ participants: 2, recipientParticipations: 1, recipientContributions: 1, recipientNotices: 0 });
      await expect(saved).toHaveAttribute('aria-pressed', 'true');
      await recipient.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(recipient.getByRole('button', { name: 'Animationen einschalten', exact: true })).toHaveAttribute('aria-pressed', 'false');
      expect(await recipient.getByText('Dein Beitrag ist im Space sichtbar.', { exact: true }).evaluate(element => getComputedStyle(element).animationName)).toBe('none');
      await recipient.emulateMedia({ reducedMotion: 'reduce' });
      expect((await ownList(recipient)).items).toEqual([]);
      await mutationSilence(senderWrites, async () => { await sender.reload(); await expect(invitationRegion(sender, 'composer')).toBeVisible(); });
      const senderNotices = await (await sender.request.get('/api/notifications')).json();
      // A sender receipt might omit the raw invitation ID in the inbox DTO.
      // This isolated new sender must receive no invitation outcome notice at all.
      expect(Array.isArray(senderNotices) ? senderNotices : senderNotices.items).toEqual([]);
      await expect(invitationRegion(sender, 'composer')).not.toContainText(/zugestellt|gelesen|angenommen|abgelehnt|Empfangsbestätigung/i);
      await assertNoPrivatePersistence(recipient, [invitationId, fixture.sender.id, sent.body.requestId, ...Object.values(sent.body.selection)], invitationId);
      expect(errors).toEqual([]);
      await writeInvitationEvidence(info, 'private-invitation-real-journey-provenance', {
        schema: 1, syntheticRegisteredUserAccounts: 2, existingPrivateMission: true, realNotificationInbox: true,
        realInviteAcceptShareEndpoints: true, noReservation: true, accepted: true, contributionShared: true,
      });
    });
  } catch (error) { original = { error }; }
  finally { await finishInvitationJourney(learners, fixture, original); }
});

test('uncertain requests require explicit retry; reload, scope/account changes and full/closed privacy fail safely', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'One bounded isolated lifecycle journey; visual matrix is covered by the paired-user journey.');
  test.setTimeout(180_000);
  const fixture = await createPrivateInvitationFixture(request);
  let learners: Awaited<ReturnType<typeof createLearners>> | undefined;
  const captureErrors = createDeferredCaptureErrors();
  let original: { error: unknown } | undefined;
  try {
    await captureErrors.finishWith(async () => {
      learners = await createLearners(browser, fixture);
      const { sender, recipient } = learners;
      const writes = recordMissionWrites(sender); const recipientWrites = recordMissionWrites(recipient);
      await openOwnInvitations(recipient); await enableReceiving(recipient);
      await joinAsSender(sender, fixture.alternate);
      await joinAsSender(sender, fixture.primary);
      await selectRecipient(sender, fixture.primary, fixture.recipient);
      let original: SendMissionInvitation | undefined;
      let loseResponse = true;
      const invitationApi = `${fixture.primary.api}/invitations`;
      const loseCommittedResponse = async (route: Route) => {
        if (route.request().method() !== 'POST' || !loseResponse) { await route.continue(); return; }
        loseResponse = false;
        original = route.request().postDataJSON() as SendMissionInvitation;
        // This is fault injection AFTER a real server commit, never a mocked
        // invitation/decision response or an alternative acceptance endpoint.
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ requestId: original.requestId, processed: true });
        await route.abort('failed');
      };
      await sender.route(`**${invitationApi}`, loseCommittedResponse);
      await activate(sender, invitationRegion(sender, 'composer').getByRole('button', { name: 'Einladung an ausgewählte Person anfragen', exact: true }));
      await expect(invitationRegion(sender, 'composer').getByRole('button', { name: retryName, exact: true })).toBeVisible();
      expect(original).toBeDefined();
      expect(fixture.snapshot()).toMatchObject({ participants: 1, recipientParticipations: 0, invitations: 1, requests: 1, recipientNotices: 1 });
      await sender.unroute(`**${invitationApi}`, loseCommittedResponse);
      await assertNoPrivatePersistence(sender, [fixture.recipient.id, original!.requestId, ...Object.values(original!.selection)]);
      await mutationSilence(writes, async () => {
        await recipient.bringToFront(); await sender.bringToFront();
        await sender.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(invitationRegion(sender, 'composer').getByRole('button', { name: retryName, exact: true })).toBeVisible();
      });
      // Client navigation really unmounts/remounts the composer without a reload.
      await mutationSilence(writes, async () => {
        await activate(sender, sender.getByRole('link', { name: 'Space-Missionen', exact: true }));
        await expect(sender).toHaveURL(`${fixture.origin}/community/missions`);
        await activate(sender, sender.getByRole('link', { name: fixture.primary.title, exact: true }));
        await expect(invitationRegion(sender, 'composer').getByRole('button', { name: retryName, exact: true })).toBeVisible();
      });
      const retried = sender.waitForResponse(isResponse(invitationApi, 'POST'));
      await activate(sender, invitationRegion(sender, 'composer').getByRole('button', { name: retryName, exact: true }));
      const replay = await retried;
      expect(replay.status()).toBe(200);
      expect(replay.request().postDataJSON()).toEqual(original);
      expect(await replay.json()).toEqual({ requestId: original!.requestId, processed: true });
      expect(fixture.snapshot()).toMatchObject({ invitations: 1, requests: 1, recipientNotices: 1, recipientParticipations: 0 });

      // A selected private peer must not follow the caller into another mission.
      await selectRecipient(sender, fixture.primary, fixture.recipient);
      await mutationSilence(writes, async () => {
        await activate(sender, sender.getByRole('link', { name: 'Space-Missionen', exact: true }));
        await activate(sender, sender.getByRole('link', { name: fixture.alternate.title, exact: true }));
        const composer = invitationRegion(sender, 'composer');
        await expect(composer.getByRole('textbox', { name: 'Nach Namen suchen', exact: true })).toHaveValue('');
        await expect(composer.getByRole('radio')).toHaveCount(0);
        await expect(composer).not.toContainText(fixture.recipient.name);
        await expect(composer.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen', exact: true })).toHaveCount(0);
      });
      expect(fixture.snapshot(fixture.alternate).requests).toBe(0);
      await activate(sender, sender.getByRole('link', { name: 'Space-Missionen', exact: true }));
      await activate(sender, sender.getByRole('link', { name: fixture.primary.title, exact: true }));
      await delayedCandidateAcrossScopeABA(sender, fixture, writes);
      await selectRecipient(sender, fixture.primary, fixture.recipient);
      loseResponse = true;
      await sender.route(`**${invitationApi}`, loseCommittedResponse);
      await activate(sender, invitationRegion(sender, 'composer').getByRole('button', { name: 'Einladung an ausgewählte Person anfragen', exact: true }));
      await expect(invitationRegion(sender, 'composer').getByRole('button', { name: retryName, exact: true })).toBeVisible();
      await sender.unroute(`**${invitationApi}`, loseCommittedResponse);
      expect(fixture.snapshot().requests).toBe(2);
      await mutationSilence(writes, async () => {
        await sender.reload();
        await expect(invitationRegion(sender, 'composer').getByRole('textbox', { name: 'Nach Namen suchen', exact: true })).toHaveValue('');
        await expect(invitationRegion(sender, 'composer').getByRole('button', { name: retryName, exact: true })).toHaveCount(0);
        await expect(invitationRegion(sender, 'composer').getByRole('radio')).toHaveCount(0);
      });
      expect(fixture.snapshot().requests).toBe(2);
      await assertNoPrivatePersistence(sender, [fixture.recipient.id, original!.requestId, ...Object.values(original!.selection)]);
      await selectRecipient(sender, fixture.primary, fixture.recipient);
      await mutationSilence(writes, async () => {
        await activate(sender, sender.getByRole('button', { name: 'Benutzermenü öffnen', exact: true }));
        await sender.getByRole('menuitem', { name: 'Abmelden', exact: true }).click();
        await expect(sender).toHaveURL(/\/login$/);
        await login(sender, fixture.recipient, fixture.password);
        await sender.goto(fixture.primary.href);
        await expect(sender.getByRole('button', { name: 'Freiwillig teilnehmen', exact: true })).toBeVisible();
        await expect(invitationRegion(sender, 'composer')).toHaveCount(0);
        await expect(sender.getByRole('button', { name: retryName, exact: true })).toHaveCount(0);
      });
      expect(fixture.snapshot()).toMatchObject({ requests: 2, recipientParticipations: 0 });

      await openOwnInvitations(recipient);
      const inbox = invitationRegion(recipient, 'inbox');
      await activate(recipient, inbox.getByRole('link', { name: fixture.primary.title, exact: true }));
      const decision = invitationRegion(recipient, 'decision');
      await expect(decision.getByText(missionInvitationConsent, { exact: true })).toBeVisible();
      fixture.fillPrimaryCapacity();
      await mutationSilence(recipientWrites, async () => {
        await activate(recipient, decision.getByRole('button', { name: 'Einladung aktualisieren', exact: true }));
        await expect(decision.getByText(missionInvitationFull, { exact: true })).toBeVisible();
      });
      await mutationSilence(recipientWrites, async () => {
        await recipient.reload();
        await expect(decision.getByText(missionInvitationFull, { exact: true })).toBeVisible();
      });
      await expect(decision.getByRole('checkbox', { name: recipientConsent, exact: true })).toBeDisabled();
      await expect(decision.getByRole('button', { name: 'Einladung annehmen', exact: true })).toBeDisabled();
      await expect(decision.getByRole('button', { name: 'Einladung ablehnen', exact: true })).toBeEnabled();
      expect(fixture.snapshot()).toMatchObject({ participants: 5, recipientParticipations: 0, recipientContributions: 0 });
      await captureState(recipient, decision, decision.getByRole('button', { name: 'Einladung ablehnen', exact: true }), 'full-no-reservation', info, captureErrors);
      fixture.closePrimary();
      await mutationSilence(recipientWrites, async () => {
        await recipient.reload();
        await expect(decision.getByRole('checkbox', { name: recipientConsent, exact: true })).toHaveCount(0);
        await expect(decision).not.toContainText(fixture.sender.name);
        await expect(decision).not.toContainText(fixture.primary.title);
      });
      expect((await ownList(recipient)).items).toEqual([]);
      fixture.removeRecipientMembership();
      await mutationSilence(recipientWrites, async () => {
        await recipient.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(recipient.getByRole('heading', { level: 2, name: 'Mission nicht verfügbar', exact: true })).toBeVisible();
        await expect(recipient.getByRole('heading', { name: fixture.primary.title, exact: true })).toHaveCount(0);
        await expect(recipient.getByRole('checkbox', { name: recipientConsent, exact: true })).toHaveCount(0);
        await expect(recipient.getByRole('button', { name: 'Einladung annehmen', exact: true })).toHaveCount(0);
      });
      const revoked = await recipient.request.get(fixture.primary.api);
      expect(revoked.status()).toBe(404);
      expect(fixture.snapshot().recipientParticipations).toBe(0);
      await writeInvitationEvidence(info, 'private-invitation-lifecycle-provenance', {
        schema: 1, committedResponseLoss: true, explicitIdempotentRetry: true, remountReload: true, scopeAccountReset: true,
        fullWithoutReservation: true, closedPrivateContentRemoved: true, revokedAccessNotFound: true,
      });
    });
  } catch (error) { original = { error }; }
  finally { await finishInvitationJourney(learners, fixture, original); }
});
