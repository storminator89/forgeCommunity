import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext, type APIResponse, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { crossEngineFixtureOrigin } from './cross-engine-fixture';
import { waitlistEventFixture } from './events-waitlist-fixture';

type Account = { id: string; name: string; email: string };
type Participation = {
  registrationState: 'NONE' | 'WAITLISTED' | 'REGISTERED' | 'CONFIRMED' | 'ATTENDED';
  isAttending: boolean;
  isWaitlisted: boolean;
  canCancelRsvp: boolean;
  canLeaveWaitlist: boolean;
  attendeeCount: number;
  waitlistCount: number;
  waitlistPosition: number | null;
  maxAttendees: number | null;
  registrationClosed: boolean;
};

test.use({ reducedMotion: 'reduce', timezoneId: 'UTC' });

test.beforeEach(() => {
  // Reuse the fail-closed guard: HTTP loopback only, explicit opt-in, SQLite,
  // absolute forge-browser-qa.db, regular file, and no symlink components.
  // Validate before any navigation, registration, or database mutation.
  crossEngineFixtureOrigin();
});

async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return await response.json() as T;
}

async function register(request: APIRequestContext, origin: string, name: string, password: string): Promise<Account> {
  const email = `event-waitlist-${randomUUID()}@example.test`;
  const result = await json<{ userId: string }>(await request.post(`${origin}/api/register`, {
    maxRedirects: 0, headers: { origin }, data: { name, email, password },
  }), 201);
  return { id: result.userId, name, email };
}

async function login(page: Page, account: Account, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(account.email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

function panel(page: Page, id: string) {
  return page.getByRole('dialog').locator(`[id="event-${encodeURIComponent(id)}"]`);
}

async function openEvent(page: Page, id: string) {
  await page.goto(`/events#event-${encodeURIComponent(id)}`);
  await expect(panel(page, id)).toBeVisible();
  return panel(page, id);
}

async function activate(page: Page, button: Locator) {
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
}

async function checkReflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth))
    .toBeLessThanOrEqual(1);
  const clipped = await page.locator('[role="dialog"] button:visible').evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 ? [] : [element.getAttribute('aria-label') || element.textContent];
  }));
  expect(clipped).toEqual([]);
}

async function openPromotion(page: Page, id: string) {
  // Reloading the actual inbox reads this account's server-created EVENT row.
  // No notification, participation, or event response is mocked in this journey.
  await page.goto('/notifications');
  const notice = page.getByRole('article').filter({ hasText: 'Ein Platz ist frei geworden. Du bist jetzt für das Event angemeldet.' });
  await expect(notice).toHaveCount(1);
  const opened = page.waitForResponse(response => /\/api\/notifications\/[^/]+\/open$/.test(new URL(response.url()).pathname) &&
    response.request().method() === 'POST');
  await activate(page, notice.getByRole('button', { name: 'Event ansehen', exact: true }));
  expect(await (await opened).json()).toEqual({ href: `/events#event-${encodeURIComponent(id)}`, label: 'Event ansehen' });
  await expect(page).toHaveURL(url => url.pathname === '/events' && url.hash === `#event-${encodeURIComponent(id)}`);
  await expect(panel(page, id).getByText('Du bist angemeldet', { exact: true })).toBeVisible();
}

test('real FIFO opt-in, leave/rejoin and seat promotions reach the existing inbox event link', async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One real database journey also checks narrow viewports.');
  test.setTimeout(240_000);
  const origin = crossEngineFixtureOrigin();
  const nonce = randomUUID();
  const password = `EventWaitlistQa1!${nonce}`;
  const admin = await register(request, origin, 'Waitlist QA Admin', password);
  const alice = await register(request, origin, 'Waitlist QA Alice', password);
  const bob = await register(request, origin, 'Waitlist QA Bob', password);
  // The only direct DB write is this freshly registered fixture's role. The
  // service APIs create the event, queue tickets, attendance, and notifications.
  crossEngineFixtureOrigin();
  const db = new DatabaseSync(process.env.DATABASE_URL!.slice('file:'.length));
  try {
    expect(db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ? AND "email" = ?')
      .run('ADMIN', admin.id, admin.email).changes).toBe(1);
  } finally { db.close(); }

  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  try {
    const pages: Page[] = [];
    for (const account of [admin, alice, bob]) {
      const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await login(page, account, password);
      pages.push(page);
    }
    const [adminPage, alicePage, bobPage] = pages;
    const event = { ...waitlistEventFixture(nonce), title: `Offene Lernwerkstatt ${nonce.slice(0, 4)}`,
      description: '<p>Eine Stunde für Fragen, Ideen und gemeinsames Ausprobieren.</p>', location: 'Online · Community-Werkstatt' };
    const created = await json<{ id: string }>(await contexts[0].request.post('/api/events', { headers: { origin }, data: event }), 201);
    const id = created.id;
    const rsvp = `/api/events/${encodeURIComponent(id)}/rsvp`;

    const adminPanel = await openEvent(adminPage, id);
    const directJoin = adminPage.waitForResponse(response => new URL(response.url()).pathname === rsvp && response.request().method() === 'POST');
    await activate(adminPage, adminPanel.getByRole('button', { name: 'Teilnehmen', exact: true }));
    const directResponse = await directJoin;
    expect(directResponse.request().postData()).toBeNull();
    expect(directResponse.status()).toBe(201);
    await expect(adminPanel.getByText('Du bist angemeldet', { exact: true })).toBeVisible();

    // Calendar/upcoming previews do not read private RSVP state until a panel
    // mounts. A full event never opts this account in just by being viewed.
    let aliceReads = 0;
    let aliceWrites = 0;
    alicePage.on('request', req => {
      if (new URL(req.url()).pathname !== rsvp) return;
      if (req.method() === 'GET') aliceReads++;
      else aliceWrites++;
    });
    await alicePage.goto('/events');
    await alicePage.getByRole('searchbox', { name: 'Events durchsuchen' }).fill(event.title);
    const trigger = alicePage.getByRole('button', { name: new RegExp(`^Details öffnen: ${event.title}`) });
    await expect(trigger).toBeVisible();
    expect(aliceReads).toBe(0);
    await activate(alicePage, trigger);
    const alicePanel = panel(alicePage, id);
    const participationPanel = alicePanel.getByRole('region', { name: `Teilnahme: ${event.title}`, exact: true });
    await alicePage.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(participationPanel.getByRole('button', { name: 'Animationen ausschalten', exact: true })).toBeEnabled();
    await alicePage.evaluate(() => {
      const state = window as typeof window & { friendlyAnimations: string[] };
      state.friendlyAnimations = [];
      document.addEventListener('animationstart', event => { if (event.target instanceof Element && event.target.closest('[role="region"][aria-label^="Teilnahme:"]')) state.friendlyAnimations.push((event as AnimationEvent).animationName); });
    });
    const optIn = alicePanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true });
    await expect(optIn).toBeEnabled();
    await expect(alicePanel).toContainText(/automatisch/i);
    expect(aliceWrites).toBe(0);
    expect(await json<Participation>(await contexts[1].request.get(rsvp))).toMatchObject({ registrationState: 'NONE', waitlistCount: 0 });
    const queuedResponse = alicePage.waitForResponse(response => new URL(response.url()).pathname === rsvp && response.request().method() === 'POST');
    await activate(alicePage, optIn);
    const queued = await queuedResponse;
    expect(queued.request().postDataJSON()).toEqual({ waitlist: true });
    expect(queued.status()).toBe(201);
    await expect(alicePanel.getByText('Warteliste · Platz 1', { exact: true })).toBeVisible();
    await expect.poll(() => alicePage.evaluate(() => (window as typeof window & { friendlyAnimations: string[] }).friendlyAnimations.length > 0)).toBe(true);
    await participationPanel.getByRole('button', { name: 'Animationen ausschalten', exact: true }).click();
    expect(await alicePage.evaluate(() => localStorage.getItem('forge-community-motion-off'))).toBe('true');
    await alicePage.emulateMedia({ reducedMotion: 'reduce' });
    await expect(participationPanel.getByRole('button', { name: 'Animationen durch Systemeinstellung ausgeschaltet', exact: true })).toBeDisabled();
    expect(await json<Participation>(await contexts[1].request.get(rsvp))).toMatchObject({ isAttending: false, attendeeCount: 1, waitlistPosition: 1 });
    await expect(alicePanel.getByText(bob.name, { exact: true })).toHaveCount(0);

    for (const theme of ['Hell', 'Dunkel']) {
      await alicePage.keyboard.press('Escape');
      await alicePage.getByRole('button', { name: 'Farbschema auswählen' }).click();
      await alicePage.getByRole('menuitem', { name: theme, exact: true }).click();
      await activate(alicePage, trigger);
      await expect(alicePanel.getByText('Warteliste · Platz 1', { exact: true })).toBeVisible();
      await expect(alicePanel.getByText(/12:00.*13:00.*Europe\/Berlin/)).toBeVisible();
      for (const width of [320, 375, 414, 768, 1280]) {
        await alicePage.setViewportSize({ width, height: 900 });
        await checkReflow(alicePage);
        await alicePage.getByRole('dialog').screenshot({ path: testInfo.outputPath(`waitlist-queue-${theme}-${width}.png`), animations: 'disabled' });
        expect(await participationPanel.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
      }
    }
    await alicePage.keyboard.press('Escape');
    await expect(alicePage.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
    await alicePage.keyboard.press('Enter');
    await expect(alicePanel.getByText('Warteliste · Platz 1', { exact: true })).toBeVisible();

    const bobPanel = await openEvent(bobPage, id);
    await bobPanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true }).click();
    await expect(bobPanel.getByText('Warteliste · Platz 2', { exact: true })).toBeVisible();
    await alicePage.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(participationPanel.getByRole('button', { name: 'Animationen einschalten', exact: true })).toBeEnabled();
    await alicePage.evaluate(() => { (window as typeof window & { friendlyAnimations: string[] }).friendlyAnimations = []; });
    await alicePanel.getByRole('button', { name: 'Warteliste verlassen', exact: true }).click();
    await expect(alicePanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true })).toBeEnabled();
    await bobPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(bobPanel.getByText('Warteliste · Platz 1', { exact: true })).toBeVisible();
    await alicePanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true }).click();
    await expect(alicePanel.getByText('Warteliste · Platz 2', { exact: true })).toBeVisible();
    await expect(participationPanel.locator('[data-confirmed]')).toHaveCount(0);
    expect(await alicePage.evaluate(() => (window as typeof window & { friendlyAnimations: string[] }).friendlyAnimations)).toEqual([]);

    // The old seat-holder cancels through the existing UI; the oldest remaining
    // ticket is promoted by the server, not by a client-side optimistic guess.
    await adminPanel.getByRole('button', { name: 'Zusage zurücknehmen', exact: true }).click();
    await expect(adminPanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true })).toBeEnabled();
    await bobPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(bobPanel.getByText('Du bist angemeldet', { exact: true })).toBeVisible();
    await expect(bobPanel.getByRole('button', { name: 'Warteliste verlassen', exact: true })).toHaveCount(0);
    await openPromotion(bobPage, id);

    // A real admin capacity edit promotes the next ticket. Visibility refresh
    // observes that change without reloading or resubmitting a participation.
    await json(await contexts[0].request.put(`/api/events/${encodeURIComponent(id)}`, { headers: { origin }, data: { ...event, maxAttendees: 2 } }));
    await alicePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(alicePanel.getByText('Du bist angemeldet', { exact: true })).toBeVisible();
    expect(await json<Participation>(await contexts[1].request.get(rsvp))).toMatchObject({
      registrationState: 'REGISTERED', attendeeCount: 2, waitlistCount: 0, waitlistPosition: null,
    });
    await openPromotion(alicePage, id);
    // Keep the deliberately long text case separate from the primary demo.
    const longTitle = 'GemeinsamLernenUndErfahrungenTeilen'.repeat(5);
    await json(await contexts[0].request.put(`/api/events/${encodeURIComponent(id)}`, { headers: { origin }, data: {
      ...event, maxAttendees: 2, title: longTitle,
      description: `<p>${'Gemeinsam können wir komplexe Fragen verständlich machen. '.repeat(5)}</p>`,
      location: 'OnlineCommunityWerkstattMitOffenemAustausch'.repeat(2),
    } }));
    await openEvent(alicePage, id);
    await expect(alicePanel.getByRole('heading', { name: longTitle, exact: true })).toBeVisible();
    for (const width of [320, 768]) {
      await alicePage.setViewportSize({ width, height: 900 }); await checkReflow(alicePage);
      await alicePage.getByRole('dialog').screenshot({ path: testInfo.outputPath(`waitlist-long-content-${width}.png`), animations: 'disabled' });
    }
    await alicePage.setViewportSize({ width: 1280, height: 900 });
    await alicePage.evaluate(() => { document.documentElement.style.zoom = '2'; }); await checkReflow(alicePage);
    await alicePage.evaluate(() => { document.documentElement.style.zoom = ''; });
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});

function participation(overrides: Partial<Participation> = {}): Participation {
  return { registrationState: 'NONE', isAttending: false, isWaitlisted: false, canCancelRsvp: false, canLeaveWaitlist: false,
    attendeeCount: 0, waitlistCount: 0, waitlistPosition: null, maxAttendees: 1, registrationClosed: false, ...overrides };
}

function syntheticEvent(id: string, title: string) {
  return { id, title, date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    description: '<p>Synthetic browser response fixture; no real event is changed.</p>', location: 'Online QA',
    startTime: '12:00', endTime: '13:00', timezone: 'UTC', category: 'Workshop',
    maxAttendees: 1, attendeeCount: 0, isAttending: false, canCancelRsvp: false };
}

test('response fixture: a stale full conflict requires deliberate queue consent and rapid clicks send one mutation', async ({ page, request }) => {
  // Only this test's isolated synthetic event responses are mocked. The real
  // journey above and the paired backend DB suites establish API correctness.
  const origin = crossEngineFixtureOrigin();
  const password = `WaitlistConflictQa1!${randomUUID()}`;
  const account = await register(request, origin, 'Waitlist conflict fixture', password);
  const event = syntheticEvent(`waitlist-conflict-${randomUUID()}`, 'Synthetic stale-full event');
  const rsvp = `/api/events/${event.id}/rsvp`;
  let current = participation();
  let readStatus = 200;
  let reads = 0;
  const bodies: (string | null)[] = [];
  let releaseMutation!: () => void;
  const mutationGate = new Promise<void>(resolve => { releaseMutation = resolve; });
  await page.route('**/api/events', route => route.fulfill({ json: [event] }));
  await page.route(`**${rsvp}`, async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      reads++;
      await route.fulfill({ status: readStatus, json: readStatus === 200 ? current : { error: 'Synthetic unavailable read' } });
      return;
    }
    expect(req.method()).toBe('POST');
    bodies.push(req.postData());
    if (bodies.length === 1) {
      current = participation({ attendeeCount: 1 });
      await route.fulfill({ status: 409, json: { error: 'Event is full' } });
      return;
    }
    expect(req.postDataJSON()).toEqual({ waitlist: true });
    await mutationGate;
    current = participation({ registrationState: 'WAITLISTED', isWaitlisted: true, canLeaveWaitlist: true,
      attendeeCount: 1, waitlistCount: 1, waitlistPosition: 1 });
    await route.fulfill({ status: 201, json: current });
  });
  await login(page, account, password);
  const eventPanel = await openEvent(page, event.id);
  await eventPanel.getByRole('button', { name: 'Teilnehmen', exact: true }).click();
  const optIn = eventPanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true });
  await expect(optIn).toBeEnabled();
  expect(bodies).toEqual([null]);
  expect(reads).toBeGreaterThanOrEqual(2);
  await expect(eventPanel.getByRole('status').filter({ hasText: 'Die Änderung konnte nicht bestätigt werden. Bitte prüfe den aktuellen Status und versuche es erneut.' })).toBeVisible();
  await expect(eventPanel.getByText(/^Warteliste · Platz/)).toHaveCount(0);
  await expect(eventPanel).toContainText(/automatisch/i);

  // A retryable read failure disables all participation writes. Recovery must
  // preserve the full/nonqueued state and still require the separate opt-in.
  readStatus = 500;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const retry = eventPanel.getByRole('button', { name: 'Teilnahmestatus erneut laden', exact: true });
  await expect(retry).toBeEnabled();
  await expect(eventPanel.locator('button:enabled').filter({ hasText: /^(Teilnehmen|Auf Warteliste setzen|Warteliste verlassen|Zusage zurücknehmen)$/ })).toHaveCount(0);
  readStatus = 200;
  await retry.click();
  await expect(optIn).toBeEnabled();
  expect(bodies).toEqual([null]);

  // Two same-task native activations exercise the handler's synchronous guard,
  // rather than waiting for disabled styling between Playwright clicks.
  await optIn.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => bodies.length).toBe(2);
  await expect(eventPanel.getByRole('button', { name: /Wird verarbeitet/ })).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  releaseMutation();
  await expect(eventPanel.getByText('Warteliste · Platz 1', { exact: true })).toBeVisible();
  expect(bodies).toEqual([null, JSON.stringify({ waitlist: true })]);
  await expect(eventPanel.getByText('Du bist angemeldet', { exact: true })).toHaveCount(0);
  await checkReflow(page);
});

test('response fixture: private queue state clears on unavailable reads and late responses after closing are ignored', async ({ page, request }) => {
  const origin = crossEngineFixtureOrigin();
  const password = `WaitlistPrivateQa1!${randomUUID()}`;
  const account = await register(request, origin, 'Waitlist private-state fixture', password);
  const event = syntheticEvent(`waitlist-private-${randomUUID()}`, 'Synthetic private queue event');
  const rsvp = `/api/events/${event.id}/rsvp`;
  let readStatus = 200;
  let current = participation({ registrationState: 'WAITLISTED', isWaitlisted: true, canLeaveWaitlist: true,
    attendeeCount: 1, waitlistCount: 3, waitlistPosition: 3 });
  let holdNextRead = false;
  let heldReadStarted = false;
  let releaseRead!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  let writes = 0;
  await page.route('**/api/events', route => route.fulfill({ json: [{ ...event, isAttending: true, canCancelRsvp: true }] }));
  await page.route(`**${rsvp}`, async route => {
    if (route.request().method() !== 'GET') {
      writes++;
      await route.fulfill({ status: 500, json: { error: 'This read-only scenario must not mutate' } });
      return;
    }
    const snapshot = current;
    if (holdNextRead) {
      holdNextRead = false;
      heldReadStarted = true;
      await readGate;
      // Closing aborts the browser request; fulfilling the route is best-effort.
      await route.fulfill({ json: snapshot }).catch(() => {});
      return;
    }
    await route.fulfill({ status: readStatus, json: readStatus === 200 ? current : { error: readStatus === 401 ? 'Unauthorized' : 'Event not found' } });
  });
  await login(page, account, password);
  const eventPanel = await openEvent(page, event.id);
  // The attendance-only list's contradictory flag is never treated as private
  // participation truth; this panel uses the caller's authoritative GET.
  await expect(eventPanel.getByText('Warteliste · Platz 3', { exact: true })).toBeVisible();
  await expect(eventPanel.getByText('Du bist angemeldet', { exact: true })).toHaveCount(0);
  for (const status of [401, 404]) {
    readStatus = status;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(eventPanel.getByRole('alert')).toBeVisible();
    await expect(eventPanel.getByText(/^Warteliste · Platz/)).toHaveCount(0);
    await expect(eventPanel.getByRole('button', { name: 'Warteliste verlassen', exact: true })).toHaveCount(0);
    await expect(eventPanel).toContainText(status === 401 ? /anmelden|Anmeldung|eingeloggt/i : /verfügbar|gefunden/i);
    readStatus = 200;
    if (status === 401) {
      await expect(eventPanel.getByRole('link', { name: 'Erneut anmelden', exact: true })).toHaveAttribute('href', '/login');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    } else {
      await eventPanel.getByRole('button', { name: 'Teilnahmestatus erneut laden', exact: true }).click();
    }
    await expect(eventPanel.getByText('Warteliste · Platz 3', { exact: true })).toBeVisible();
  }

  holdNextRead = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => heldReadStarted).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  current = participation({ attendeeCount: 1 });
  await page.getByRole('button', { name: /^Details öffnen: Synthetic private queue event/ }).click();
  await expect(eventPanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true })).toBeEnabled();
  releaseRead();
  // Revalidation after the canceled old request confirms that its queued
  // snapshot cannot repopulate the newly mounted panel.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(eventPanel.getByRole('button', { name: 'Auf Warteliste setzen', exact: true })).toBeEnabled();
  await expect(eventPanel.getByText('Warteliste · Platz 3', { exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});
