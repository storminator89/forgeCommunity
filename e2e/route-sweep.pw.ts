import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { routeSweepCases, type RouteSweepCase } from './route-sweep-manifest';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
type Persona = RouteSweepCase['persona'];
type StoredSession = Awaited<ReturnType<BrowserContext['storageState']>>;
const sessions: Partial<Record<Exclude<Persona, 'anonymous'>, StoredSession>> = {};
let memberId = '';
let adminId = '';
let publicSpaceId = '';
let privateSpaceId = '';
let publicDiscussionId = '';

function disposableDatabasePath() {
  const url = process.env.DATABASE_URL;
  const path = url?.startsWith('file:') ? url.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Route sweep requires the explicitly disposable browser QA SQLite database.');
  }
  return path;
}

async function createAccount(request: APIRequestContext, name: string, password: string) {
  const email = `route-sweep-${randomUUID()}@example.test`;
  const response = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name, email, password },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json() as { userId: string };
  expect(body.userId).toBeTruthy();
  return { email, id: body.userId };
}

async function loginState(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
    await page.getByLabel('Passwort', { exact: true }).fill(password);
    await page.getByLabel('Passwort', { exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/community$/);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function usePersona(page: Page, persona: Persona) {
  if (persona === 'anonymous') return;
  const state = sessions[persona];
  if (!state?.cookies.length) throw new Error(`No synthetic ${persona} browser session.`);
  await page.context().addCookies(state.cookies);
}

async function installSyntheticApi(page: Page, item?: RouteSweepCase) {
  // Only these exact QA IDs are intercepted. Every other request reaches the
  // disposable CI server; no private real-world records are fetched or saved.
  const article = {
    id: 'qa-route-article', title: 'Route QA article', content: '<p>Synthetic article fixture.</p>',
    category: 'QA', featuredImage: null,
    author: { id: memberId, name: 'Route QA Member', email: 'synthetic@example.test' },
    createdAt: '2026-10-01T12:00:00.000Z', tags: [],
  };
  await page.route('**/api/articles/qa-route-article', route => route.fulfill({ status: 200, json: article }));
  await page.route('**/api/articles/categories-and-tags', route => route.fulfill({ status: 200, json: { categories: ['QA'], tags: [] } }));
  await page.route('**/api/courses/qa-route-course', route => route.fulfill({ status: 200, json: { id: 'qa-route-course', name: 'Route QA course', canEdit: false } }));
  if (item?.url === '/courses/pathways/qa-route-pathway') {
    await page.route('**/api/learning-pathways/me', route => route.fulfill({ status: 200, json: { pathways: [{
      id: 'qa-route-pathway', title: 'Route QA Lernpfad', description: 'Ein privater Testpfad.', badgeLabel: 'QA Lernabzeichen',
      courses: [{ courseId: 'qa-route-course', title: 'Route QA course', order: 0, creditActive: false, available: true, isEnrolled: false },
        { courseId: 'qa-route-course-two', title: 'Zweiter QA Kurs', order: 1, creditActive: false, available: true, isEnrolled: false }],
      unavailable: false, participation: null, creditedCount: 0, requiredCount: 2, history: [],
    }] } }));
  }
  await page.route('**/api/courses/qa-route-course/contents', route => route.fulfill({ status: 200, json: [] }));
  if (item?.url === '/courses/qa-route-course/practice') {
    await page.route('**/api/courses/qa-route-course/practice/authoring', route => route.fulfill({ status: 200, json: {
      draft: { revision: 0, digest: 'qa-empty', payload: { schemaVersion: 1, items: [] } },
      activeCoursePublicationId: null, activeSnapshot: null,
    } }));
    await page.route('**/api/courses/practice/objectives', route => route.fulfill({ status: 200, json: { objectives: [] } }));
  }
  if (item?.url === '/courses/qa-route-course/practice/learn') {
    await page.route('**/api/courses/qa-route-course/practice/learner', route => route.fulfill({ status: 200, json: {
      status: 'off', dueCount: 0,
    } }));
  }
  if (item?.url === '/courses/qa-route-course/qa') {
    await page.route(/\/api\/courses\/qa-route-course\/qa\?filter=all(?:&|$)/, route => route.fulfill({ status: 200, json: {
      items: [], nextCursor: null, canModerate: false, canAsk: false, canReply: false,
    } }));
    await page.route(/\/api\/courses\/qa-route-course\/qa\/revalidate(?:\?|$)/, route => route.fulfill({ status: 200, json: {
      visibleIds: [], canModerate: false, canAsk: false, canReply: false,
    } }));
  }
  await page.route(/\/api\/courses\/qa-route-course\/assignments(?:\?|$)/, route => route.fulfill({ status: 200, json: { submissions: [], nextCursor: null } }));
  await page.route(/\/api\/courses\/qa-route-course\/analytics\?/, route => route.fulfill({ status: 200, json: {
    course: { id: 'qa-route-course', title: 'Route QA course', activePublicationId: 'qa-publication' },
    summary: { enrolled: 1, currentComplete: 0, notStarted: 0, inProgress: 1, unmeasurable: 0,
      quizSignals: [{ contentId: 'qa-quiz', title: 'Safety quiz', attemptedLearners: 1, latestFailureLearners: 1 }] },
    filters: { search: '', status: 'all' }, pagination: { page: 1, pageSize: 25, total: 1, pages: 1 },
    learners: [{ enrollmentId: 'qa-enrollment', displayName: 'Route QA learner', enrolledAt: '2026-10-01T12:00:00.000Z',
      currentStatus: 'in-progress', completedLeaves: 1, totalLeaves: 2, firstIncomplete: { id: 'qa-quiz', title: 'Safety quiz' },
      quizAttempts: 1, quizNeedsReview: 1, latestQuiz: { title: 'Safety quiz', score: 50, passed: false, submittedAt: '2026-10-02T12:00:00.000Z' },
      historicalCompletedAt: null, certificateIssuedAt: null }],
  } }));
  await page.route('**/api/courses/qa-route-course/progress', route => route.fulfill({
    status: 200, json: { completedContentIds: [], complete: false, canTrack: false, hasCertificate: false, completedAt: null },
  }));
  if (item?.url === '/courses/journey') {
    // The new page is exercised with a bounded, explicitly synthetic enrolled
    // course. The locked first leaf must never become the recommended link.
    await page.route('**/api/courses', route => route.fulfill({ status: 200, json: [
      { id: 'qa-route-course', title: 'Route QA Lernkurs', isEnrolled: true, completed: false, canDelete: false },
    ] }));
    await page.route('**/api/courses/qa-route-course/contents', route => route.fulfill({ status: 200, json: [
      { id: 'qa-locked', title: 'Route QA gesperrter Schritt', type: 'TEXT', order: 1, locked: true,
        releaseLocked: true, publicationId: 'qa-publication', subContents: [] },
      { id: 'qa-open', title: 'Route QA offener Lernschritt', type: 'TEXT', order: 2, locked: false,
        releaseLocked: false, publicationId: 'qa-publication', subContents: [] },
    ] }));
    await page.route('**/api/courses/qa-route-course/progress', route => route.fulfill({ status: 200, json: {
      completedContentIds: [], complete: false, canTrack: true, publicationId: 'qa-publication',
    } }));
  }
  await page.route('**/api/projects/qa-route-project', route => route.fulfill({ status: 200, json: {
    id: 'qa-route-project', title: 'Route QA project', description: '<p>Synthetic project fixture.</p>',
    category: 'QA', link: 'https://example.test/project', gradientFrom: '#ddd', gradientTo: '#eee',
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
    author: { id: memberId, name: 'Route QA Member' }, tags: [], likes: [], comments: [],
  } }));
  await page.route(/\/api\/projects\/qa-route-project\/comments(?:\?|$)/, route => route.fulfill({ status: 200, json: [] }));
  await page.route('**/api/resources/qa-route-resource', route => route.fulfill({ status: 200, json: {
    id: 'qa-route-resource', title: 'Route QA resource', type: 'ARTICLE', category: 'QA',
    author: { id: memberId, name: 'Route QA Member', email: 'synthetic@example.test' },
    url: 'https://example.test/resource', color: 'bg-muted',
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
  } }));
  await page.route('**/api/verify-certificate/qa-route-certificate', route => route.fulfill({ status: 200, json: {
    valid: true, certificate: { id: 'qa-route-certificate', userName: 'Synthetic Learner',
      courseName: 'Synthetic Course', issuedAt: '2026-10-01T12:00:00.000Z' },
  } }));
}

function caseUrl(item: RouteSweepCase) {
  return item.url
    .replace(':memberId', encodeURIComponent(memberId))
    .replace(':publicSpaceId', encodeURIComponent(publicSpaceId))
    .replace(':privateSpaceId', encodeURIComponent(privateSpaceId))
    .replace(':publicDiscussionId', encodeURIComponent(publicDiscussionId));
}

function screenshotName(item: RouteSweepCase) {
  return item.source.replace(/^app\//, '').replace(/\/page\.tsx$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
}

test.describe('every App Router page, one at a time', () => {
  // The existing 390px journey suite remains unchanged. This sweep adds the
  // two requested review widths without tripling CI time.
  test.skip(({ viewport }) => viewport?.width === 390, 'The route sweep runs at desktop and 320px.');

  test.beforeAll(async ({ browser, request }) => {
    const path = disposableDatabasePath();
    const password = `RouteQaA1!${randomUUID()}`;
    const member = await createAccount(request, 'Route QA Member', password);
    const moderator = await createAccount(request, 'Route QA Moderator', password);
    const admin = await createAccount(request, 'Route QA Admin', password);
    memberId = member.id;
    adminId = admin.id;

    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('MODERATOR', moderator.id);
      db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('ADMIN', admin.id);
    } finally {
      db.close();
    }
    sessions.member = await loginState(browser, member.email, password);
    sessions.moderator = await loginState(browser, moderator.email, password);
    sessions.admin = await loginState(browser, admin.email, password);

    // Real disposable API state. No synthetic interception for Spaces routes.
    const adminContext = await browser.newContext({ baseURL: origin, storageState: sessions.admin });
    const memberContext = await browser.newContext({ baseURL: origin, storageState: sessions.member });
    try {
      const publicResult = await adminContext.request.post('/api/spaces', { data: {
        name: 'Route QA public space', description: 'A disposable public space.', visibility: 'PUBLIC',
      } });
      expect(publicResult.status(), await publicResult.text()).toBe(201);
      publicSpaceId = (await publicResult.json() as { id: string }).id;
      const privateResult = await adminContext.request.post('/api/spaces', { data: {
        name: 'Route QA private space', description: 'A disposable private space.', visibility: 'PRIVATE',
      } });
      expect(privateResult.status(), await privateResult.text()).toBe(201);
      privateSpaceId = (await privateResult.json() as { id: string }).id;
      expect(publicSpaceId).toBeTruthy(); expect(privateSpaceId).toBeTruthy();

      const joined = await memberContext.request.post(`/api/spaces/${encodeURIComponent(publicSpaceId)}/join`);
      expect(joined.ok(), await joined.text()).toBe(true);
      const added = await adminContext.request.post(`/api/spaces/${encodeURIComponent(privateSpaceId)}/members`, { data: { userId: memberId } });
      expect(added.ok(), await added.text()).toBe(true);
      const discussion = await memberContext.request.post(`/api/spaces/${encodeURIComponent(publicSpaceId)}/discussions`, { data: {
        title: 'Route QA discussion', content: 'Route QA discussion body.', requestId: randomUUID(),
      } });
      expect(discussion.status(), await discussion.text()).toBe(201);
      publicDiscussionId = (await discussion.json() as { id: string }).id;
      expect(publicDiscussionId).toBeTruthy();
    } finally { await adminContext.close(); await memberContext.close(); }
  });

  for (const item of routeSweepCases) {
    test(`${item.source}: ${item.outcome} ${item.url}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await usePersona(page, item.persona);
      await installSyntheticApi(page, item);
      // Observe the page's actual data read before navigation, so a fast
      // response cannot race the waiter and a heading-only loading state
      // cannot become a successful screenshot.
      const settledResponse = item.settledApi ? page.waitForResponse(response =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === caseUrl({ ...item, url: item.settledApi! })
      ) : null;
      await page.goto(caseUrl(item));

      if (item.outcome === 'redirect') {
        await expect(page).toHaveURL(new RegExp(`${item.redirectTo!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
        const destination = routeSweepCases.find(candidate =>
          candidate.outcome === 'render' && candidate.url === item.redirectTo
        );
        if (!destination) throw new Error(`No rendered destination case for ${item.url}`);
        await expect(page.getByRole('heading', { level: 1, name: destination.heading!, exact: true })).toBeVisible();
        if (destination.settledText) {
          await expect(page.getByText(destination.settledText, { exact: false }).first()).toBeVisible();
        }
        // Capture the settled destination. The redirect-only source does not
        // claim a stable rendered state of its own.
        await page.screenshot({ path: testInfo.outputPath(screenshotName(item)), fullPage: true });
        expect(errors).toEqual([]);
        return;
      }

      await expect(page).toHaveURL(url => url.pathname === caseUrl(item));
      const main = page.locator('#page-content');
      await expect(main).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      const heading = page.locator('h1');
      await expect(heading).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1, name: item.heading!, exact: true })).toBeVisible();
      if (settledResponse) {
        const response = await settledResponse;
        expect(response.ok(), `${item.url} ${response.status()} from ${response.url()}`).toBe(true);
      }
      if (item.loadingText) await expect(main.getByText(item.loadingText, { exact: false })).toHaveCount(0);
      if (item.settledText) await expect(page.getByText(item.settledText, { exact: false }).first()).toBeVisible();
      // These success markers render only after their requests have been
      // applied, regardless of how many synthetic records earlier suites left.
      if (item.url === '/admin/dashboard') await expect(page.locator('#metric-totalUsers')).toContainText(/[1-9]/);
      if (item.url === '/chat') await expect(page.getByRole('log', { name: 'Nachrichten' })).toBeVisible();
      if (item.url === '/community') await expect(main.getByRole('status').filter({ hasText: /^\d+ (?:Beitrag|Beiträge) geladen$/ })).toBeVisible();
      if (item.url === '/courses') await expect(main.getByText(/^\d+ (?:Kurs|Kurse) verfügbar$/)).toBeVisible();
      if (item.url === '/courses/journey') {
        await expect(page.getByRole('link', { name: 'Lernschritt öffnen' })).toHaveAttribute('href', '/courses/qa-route-course/contents?content=qa-open');
        await expect(main.getByText('Route QA gesperrter Schritt')).toBeVisible();
        const motion = main.getByRole('button', { name: 'Figurenanimationen an' });
        await expect(motion).toHaveAttribute('aria-pressed', 'true');
        await motion.click();
        await expect(main.getByRole('button', { name: 'Figurenanimationen aus' })).toHaveAttribute('aria-pressed', 'false');
        await page.reload();
        await expect(page.getByRole('link', { name: 'Lernschritt öffnen' })).toHaveAttribute('href', '/courses/qa-route-course/contents?content=qa-open');
        await expect(main.getByRole('button', { name: 'Figurenanimationen aus' })).toHaveAttribute('aria-pressed', 'false');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(main.getByRole('button', { name: 'Figurenanimationen aus' })).toBeDisabled();
        await expect(main.getByText('Weniger Bewegung ist am Gerät eingestellt.')).toBeVisible();
      }
      if (item.url === '/events') await expect(page.getByRole('region', { name: 'Nächste Events' })).toBeVisible();
      if (item.url === '/settings') await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Route QA Member');
      if (item.url === '/courses/qa-route-course/analytics') {
        await expect(main.getByRole('list', { name: 'Lernende im Kurs' })).toContainText('Route QA learner');
      }

      const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        html: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(overflow.html, `${item.url} document width ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(overflow.body, `${item.url} body width ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.viewport + 1);
      await page.screenshot({ path: testInfo.outputPath(screenshotName(item)), fullPage: true });

      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Zum Inhalt springen', exact: true });
      await expect(skip).toBeFocused();
      expect(await skip.evaluate(element => element.matches(':focus-visible'))).toBe(true);
      expect(await skip.evaluate(element => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      await page.keyboard.press('Enter');
      await expect(main).toBeFocused();

      if (item.url === '/courses/qa-route-course/analytics') {
        const search = main.getByRole('textbox', { name: 'Name suchen' });
        await search.focus();
        await expect(search).toBeFocused();
        await search.fill('Route QA');
        await search.press('Enter');
        await expect(main.getByRole('list', { name: 'Lernende im Kurs' })).toContainText('Route QA learner');
      }

      // These pages scroll inside <main>, so a document-level fullPage PNG
      // alone cannot show their lower content. Review the real lower action
      // without filling or submitting either form.
      const lowerTarget = item.url === '/courses/new'
        ? page.getByRole('button', { name: 'Kursentwurf anlegen', exact: true })
        : item.url === '/projects/new'
          ? page.getByRole('button', { name: 'Projekt einreichen', exact: true })
          : item.url === '/about'
            ? page.getByRole('link', { name: 'E-Mail schreiben', exact: true })
            : null;
      if (lowerTarget) {
        await expect(lowerTarget).toBeVisible();
        await lowerTarget.scrollIntoViewIfNeeded();
        await expect(lowerTarget).toBeInViewport();
        await expect(lowerTarget).toBeEnabled();
        await lowerTarget.focus();
        await expect(lowerTarget).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(screenshotName(item).replace(/\.png$/, '-lower.png')) });
      }
      expect(errors).toEqual([]);
    });
  }

  test('private Space clears member content after access is revoked', async ({ browser, page }) => {
    await usePersona(page, 'member');
    await page.goto(`/community/spaces/${encodeURIComponent(privateSpaceId)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Route QA private space' })).toBeVisible();
    await expect(page.getByText('Nur Mitglieder und Administratoren können Inhalte sehen.')).toBeVisible();

    const outsider = await browser.newContext({ baseURL: origin, storageState: sessions.moderator });
    try {
      const denied = await outsider.request.get(`/api/spaces/${encodeURIComponent(privateSpaceId)}`);
      expect(denied.status()).toBe(404);
    } finally { await outsider.close(); }

    const adminContext = await browser.newContext({ baseURL: origin, storageState: sessions.admin });
    try {
      const removed = await adminContext.request.delete(`/api/spaces/${encodeURIComponent(privateSpaceId)}/members/${encodeURIComponent(memberId)}`);
      expect(removed.ok(), await removed.text()).toBe(true);
    } finally { await adminContext.close(); }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { level: 1, name: 'Space nicht verfügbar' })).toBeVisible();
    await expect(page.getByText('Route QA private space')).toHaveCount(0);
  });

  test('private Space clears admin-only content after DB role demotion with a stale session', async ({ browser, page }) => {
    await usePersona(page, 'admin');
    await page.goto(`/community/spaces/${encodeURIComponent(privateSpaceId)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Route QA private space' })).toBeVisible();

    const adminContext = await browser.newContext({ baseURL: origin, storageState: sessions.admin });
    try {
      const removed = await adminContext.request.delete(`/api/spaces/${encodeURIComponent(privateSpaceId)}/members/${encodeURIComponent(adminId)}`);
      expect(removed.ok(), await removed.text()).toBe(true);
    } finally { await adminContext.close(); }
    const db = new DatabaseSync(disposableDatabasePath());
    try { db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('USER', adminId); }
    finally { db.close(); }

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { level: 1, name: 'Space nicht verfügbar' })).toBeVisible();
    await expect(page.getByText('Route QA private space')).toHaveCount(0);
  });

  test('analytics page keeps controls readable from 320 to 768px with a keyboard path', async ({ page }, testInfo) => {
    await usePersona(page, 'member');
    await installSyntheticApi(page);
    await page.goto('/courses/qa-route-course/analytics');
    await expect(page.getByRole('list', { name: 'Lernende im Kurs' })).toContainText('Route QA learner');
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 850 });
      const widths = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      expect(widths.html, `analytics ${width}px ${JSON.stringify(widths)}`).toBeLessThanOrEqual(width + 1);
      expect(widths.body, `analytics ${width}px ${JSON.stringify(widths)}`).toBeLessThanOrEqual(width + 1);
      for (const name of ['Anwenden', 'CSV exportieren', 'Vorherige Seite', 'Nächste Seite']) {
        const button = page.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        const control = await button.evaluate(element => ({ whiteSpace: getComputedStyle(element).whiteSpace,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
        expect(control.whiteSpace, `${name} at ${width}px`).toBe('nowrap');
        expect(control.scrollWidth, `${name} at ${width}px`).toBeLessThanOrEqual(control.clientWidth + 1);
      }
      if (width === 320) await page.screenshot({ path: testInfo.outputPath('course-analytics-320.png'), fullPage: true });
    }
    const search = page.getByRole('textbox', { name: 'Name suchen' });
    await search.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: 'Status' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Anwenden' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'CSV exportieren' })).toBeFocused();
  });

  test('server page boundaries redirect a member away from staff pages', async ({ page }) => {
    await usePersona(page, 'member');
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(`${origin}/`);
    await page.goto('/admin/users');
    await expect(page).toHaveURL(`${origin}/`);
    await page.goto('/moderation');
    await expect(page).toHaveURL(`${origin}/`);
  });
});
