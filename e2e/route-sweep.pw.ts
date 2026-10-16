import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { routeSweepCases, type RouteSweepCase } from './route-sweep-manifest';
import type { MemberPathway } from '../app/courses/pathways/pathway-types';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
type Persona = RouteSweepCase['persona'];
type StoredSession = Awaited<ReturnType<BrowserContext['storageState']>>;
const sessions: Partial<Record<Exclude<Persona, 'anonymous'>, StoredSession>> = {};
let memberId = '';
let adminId = '';
let publicSpaceId = '';
let privateSpaceId = '';
let privateMissionId = '';
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
  if (item?.url === '/community/spaces/qa-route-space/missions/qa-route-mission') {
    await page.route('**/api/spaces/qa-route-space', route => route.fulfill({ status: 200, json: {
      id: 'qa-route-space', name: 'Route QA private space', description: 'Synthetic mission UI fixture.', visibility: 'PRIVATE',
      createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
      memberCount: 1, discussionCount: 0, isMember: true, canManage: false,
    } }));
    await page.route('**/api/spaces/qa-route-space/missions/qa-route-mission', route => route.fulfill({ status: 200, json: {
      id: 'qa-route-mission', spaceId: 'qa-route-space', title: 'Route QA teach-back', prompt: 'A synthetic, voluntary teach-back prompt.',
      creator: null, createdAt: '2026-10-01T12:00:00.000Z', closedAt: null, participants: [], participantLimit: 5,
      participation: { epoch: 0, active: false, joinedAt: null, optedOutAt: null }, canManage: false, canJoin: true,
      contributions: [], ownContributions: [], progress: { insightAuthors: 0, hasCrossPersonBuildOn: false, complete: false },
    } }));
  }
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

function screenshotName(item: RouteSweepCase, theme: 'light' | 'dark') {
  return item.source.replace(/^app\//, '').replace(/\/page\.tsx$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') + `-${theme}.png`;
}

test.describe('every App Router page, one at a time', () => {
  // The existing 390px journey suite remains unchanged. This sweep adds the
  // two requested review widths without tripling CI time.
  // Only the bounded native-progress scenes also run in the existing 390px
  // project; the general route sweep still runs at desktop and 320px.
  test.beforeEach(({ viewport }, testInfo) => {
    test.skip(viewport?.width === 390 && !testInfo.title.startsWith('synthetic rendering only:'), 'The general route sweep runs at desktop and 320px.');
  });

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
      const mission = await adminContext.request.post(`/api/spaces/${encodeURIComponent(privateSpaceId)}/missions`, { headers: { origin }, data: {
        title: 'Route QA overview mission', prompt: 'A real disposable mission for the private Space overview.', requestId: randomUUID(),
      } });
      expect(mission.status(), await mission.text()).toBe(201);
      privateMissionId = (await mission.json() as { id: string }).id;
      expect(privateMissionId).toBeTruthy();
      const discussion = await memberContext.request.post(`/api/spaces/${encodeURIComponent(publicSpaceId)}/discussions`, { data: {
        title: 'Route QA discussion', content: 'Route QA discussion body.', requestId: randomUUID(),
      } });
      expect(discussion.status(), await discussion.text()).toBe(201);
      publicDiscussionId = (await discussion.json() as { id: string }).id;
      expect(publicDiscussionId).toBeTruthy();
    } finally { await adminContext.close(); await memberContext.close(); }
  });

  for (const item of routeSweepCases) {
    // Each rendered route gets two fresh, real browser states against the SAME
    // production build. Redirects remain separate, single destination checks.
    for (const paletteTheme of item.outcome === 'render' ? ['light', 'dark'] as const : ['light'] as const) {
    test(`${item.source}: ${item.outcome} ${item.url} [${paletteTheme}]`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      // Set only the disposable context's next-themes preference, before its
      // initialization. Do not recolor the DOM or fabricate component states.
      await page.addInitScript(theme => localStorage.setItem('theme', theme), paletteTheme);
      await page.emulateMedia({ colorScheme: paletteTheme });
      await usePersona(page, item.persona);
      await installSyntheticApi(page, item);
      let releaseLoading: (() => void) | undefined;
      if (item.url === '/courses/qa-route-course/analytics') {
        const loadingGate = new Promise<void>(resolve => { releaseLoading = resolve; });
        // Hold only the already declared synthetic analytics response. Capture
        // the real component's pending render, then resume its normal fixture.
        await page.route(/\/api\/courses\/qa-route-course\/analytics\?/, async route => {
          await loadingGate;
          await route.fallback();
        });
      }
      // Observe the page's actual data read before navigation, so a fast
      // response cannot race the waiter and a heading-only loading state
      // cannot become a successful screenshot.
      const settledResponse = item.settledApi ? page.waitForResponse(response =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === caseUrl({ ...item, url: item.settledApi! })
      ) : null;
      try {
        await page.goto(caseUrl(item));
        if (releaseLoading) {
          if (paletteTheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
          else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
          await expect(page.getByRole('status').filter({ hasText: 'Kursanalyse wird geladen' })).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`palette-real-loading-${paletteTheme}.png`), animations: 'disabled' });
        }
      } finally { releaseLoading?.(); }

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
        await page.screenshot({ path: testInfo.outputPath(screenshotName(item, paletteTheme)), fullPage: true, animations: 'disabled' });
        expect(errors).toEqual([]);
        return;
      }

      await expect(page).toHaveURL(url => url.pathname === caseUrl(item));
      if (paletteTheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
      await expect(page.locator('body')).toHaveCSS('background-color', paletteTheme === 'dark' ? 'rgb(8, 37, 47)' : 'rgb(239, 248, 246)');
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
      if (item.url === '/community') await expect(main.getByText(/^\d+ (?:Beitrag|Beiträge) geladen$/)).toBeVisible();
      if (item.url === '/community/missions') {
        const missionLink = main.getByRole('link', { name: 'Route QA overview mission', exact: true });
        await expect(missionLink)
          .toHaveAttribute('href', `/community/spaces/${encodeURIComponent(privateSpaceId)}/missions/${encodeURIComponent(privateMissionId)}`);
        const missionCard = main.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Route QA overview mission', exact: true }) });
        await expect(missionCard).toHaveCount(1);
        await expect(missionCard.getByText('Route QA private space', { exact: true })).toBeVisible();
        await expect(main.getByRole('button', { name: /teilnehmen|beenden/i })).toHaveCount(0);
      }
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
      await page.screenshot({ path: testInfo.outputPath(screenshotName(item, paletteTheme)), fullPage: true, animations: 'disabled' });

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
        const pagination = main.getByRole('navigation', { name: 'Seiten der Lernenden' });
        // Disabled controls have a WCAG contrast exception. This evidence
        // checks their actual native state and labels, without claiming 4.5:1.
        await expect(pagination.getByRole('button', { name: 'Vorherige Seite', exact: true })).toBeDisabled();
        await expect(pagination.getByRole('button', { name: 'Nächste Seite', exact: true })).toBeDisabled();
        await pagination.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`palette-disabled-pagination-${paletteTheme}.png`), animations: 'disabled' });
      }

      if (item.url === '/login') {
        const email = main.getByRole('textbox', { name: 'E-Mail-Adresse' });
        await email.focus();
        await expect(email).toBeFocused();
        expect(await email.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        expect(await email.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
        await page.screenshot({ path: testInfo.outputPath(`palette-input-keyboard-focus-${paletteTheme}.png`), animations: 'disabled' });
        const submit = main.getByRole('button', { name: 'Anmelden', exact: true });
        await expect(submit).toBeEnabled();
        // Tailwind v4 deliberately does not apply hover colors on touch-only
        // devices, even when the automation can position a pointer there.
        if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
          await submit.hover();
          expect(await submit.evaluate(element => element.matches(':hover'))).toBe(true);
          await page.screenshot({ path: testInfo.outputPath(`palette-primary-hover-${paletteTheme}.png`), animations: 'disabled' });
        }
      }

      if (item.url === '/settings') {
        const privacy = main.getByRole('tab', { name: 'Privatsphäre', exact: true });
        await privacy.focus();
        await page.keyboard.press('Enter');
        await expect(privacy).toHaveAttribute('aria-selected', 'true');
        await expect(privacy).toHaveAttribute('data-state', 'active');
        await expect(main.getByLabel('In der öffentlichen Rangliste erscheinen', { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`palette-selected-tab-${paletteTheme}.png`), animations: 'disabled' });
      }

      if (item.url === '/profile/:memberId') {
        await page.getByRole('button', { name: 'Profil bearbeiten', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Bearbeitung schließen', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Profil verwalten', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Stammdaten bearbeiten', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Profil bearbeiten', exact: true });
        await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('');
        await dialog.getByRole('textbox', { name: 'Kontakt', exact: true }).fill('invalid');
        await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
        await expect(dialog.getByText('Name ist erforderlich', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Ungültiges Kontaktformat', { exact: true })).toBeVisible();
        // Existing client validation stops before saving; no API replacement
        // or private-data/authorization shortcut is introduced by this state.
        await page.screenshot({ path: testInfo.outputPath(`palette-profile-validation-${paletteTheme}.png`), animations: 'disabled' });
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
        await page.screenshot({ path: testInfo.outputPath(screenshotName(item, paletteTheme).replace(/\.png$/, '-lower.png')), animations: 'disabled' });
      }
      expect(errors).toEqual([]);
    });
    }
  }

  for (const paletteTheme of ['light', 'dark'] as const) {
    for (const creditedCount of [0, 1, 2]) {
      const complete = creditedCount === 2;
      const stateLabel = `${creditedCount}-of-2`;
      test(complete ? `synthetic rendering only: existing private active pathway reward [${paletteTheme}]`
        : `synthetic rendering only: native pathway progress ${creditedCount}/2 [${paletteTheme}]`, async ({ page }, testInfo) => {
        // Additional render evidence only. The original unstarted route fixture,
        // real consent/exit journey and award/persistence tests are unchanged.
        const fixture: MemberPathway = {
          id: 'qa-palette-active-pathway', title: 'Route QA private Anerkennung',
          description: complete ? 'Synthetische Darstellung einer privaten Anerkennung mit zwei aktuell angerechneten Kursen.'
            : `Synthetische Darstellung eines privaten Lernpfads mit ${creditedCount} von 2 aktuell angerechneten Kursen.`,
          badgeLabel: 'QA Kursanerkennung', unavailable: false, creditedCount, requiredCount: 2,
          courses: [
            { courseId: 'qa-palette-course-one', title: complete ? 'Erster angerechneter QA Kurs' : 'Erster QA Kurs', order: 0, creditActive: creditedCount >= 1, available: true, isEnrolled: true },
            { courseId: 'qa-palette-course-two', title: complete ? 'Zweiter angerechneter QA Kurs' : 'Zweiter QA Kurs', order: 1, creditActive: complete, available: true, isEnrolled: true },
          ],
          participation: { joinedAt: '2026-10-01T08:00:00.000Z', optedOutAt: null, badgeActive: complete, badgeFirstAwardedAt: complete ? '2026-10-02T08:00:00.000Z' : null },
          history: complete ? [{ type: 'AWARDED', reason: null, at: '2026-10-02T08:00:00.000Z' }] : [],
        };
        const mutations: string[] = [];
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
        page.on('request', request => {
          const path = new URL(request.url()).pathname;
          if (request.method() !== 'GET' && (path.startsWith('/api/learning-pathways/') || /^\/api\/courses\/[^/]+\/enrollment$/.test(path))) {
            mutations.push(`${request.method()} ${path}`);
          }
        });
        await page.addInitScript(theme => localStorage.setItem('theme', theme), paletteTheme);
        await page.emulateMedia({ colorScheme: paletteTheme, forcedColors: 'none' });
        await usePersona(page, 'member');
        await page.route('**/api/learning-pathways/me', route => route.fulfill({ status: 200, json: { pathways: [fixture] } }));
        const appliedResponse = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/learning-pathways/me');
        await page.goto(`/courses/pathways/${fixture.id}`);
        expect((await appliedResponse).status()).toBe(200);
        if (paletteTheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
        else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
        const main = page.locator('#page-content');
        await expect(main.getByRole('heading', { name: complete ? 'Abzeichen aktiv' : 'In Arbeit', exact: true })).toBeVisible();
        await expect(main.getByText(`${creditedCount} von 2 Kursen aktuell bestätigt`, { exact: true })).toBeVisible();
        await expect(main.getByText('Aktuell bestätigt', { exact: true })).toHaveCount(creditedCount);
        await expect(main.getByText('Noch nicht bestätigt', { exact: true })).toHaveCount(2 - creditedCount);
        const progress = main.getByRole('progressbar', { name: `Lernpfad: ${creditedCount} von 2 Kursen aktuell bestätigt`, exact: true });
        await expect(progress).toHaveAttribute('value', String(creditedCount));
        await expect(progress).toHaveAttribute('max', '2');
        await expect(progress).toHaveClass(/\baccent-progress\b/);
        await expect(progress).toHaveCSS('accent-color', paletteTheme === 'dark' ? 'rgb(114, 208, 204)' : 'rgb(7, 92, 101)');
        if (complete) {
          const label = main.getByText(`Privates Abzeichen aktiv: ${fixture.badgeLabel}`, { exact: true });
          await expect(label).toBeVisible();
          const badge = label.locator('..');
          await expect(badge).toHaveClass(/\bbg-reward\b/);
          await expect(badge).toHaveClass(/\btext-reward-foreground\b/);
          await expect(badge).toHaveCSS('background-color', 'rgb(242, 199, 92)');
          await expect(badge).toHaveCSS('color', paletteTheme === 'dark' ? 'rgb(8, 37, 47)' : 'rgb(20, 52, 61)');
          await expect(badge.getByText('Diese Anerkennung ist nur in deinem Lernpfad sichtbar. Sie ist kein Zertifikat.', { exact: true })).toBeVisible();
          await expect(main.getByRole('button', { name: 'Teilnahme beenden', exact: true })).toBeVisible();
          await expect(main.getByRole('button', { name: 'Privat teilnehmen', exact: true })).toHaveCount(0);
          await expect(main.getByText('Abzeichen erstmals aktiv', { exact: true })).toBeVisible();
        } else {
          await expect(main.getByText(`Privates Abzeichen aktiv: ${fixture.badgeLabel}`, { exact: true })).toHaveCount(0);
          await expect(main.getByText('Abzeichen erstmals aktiv', { exact: true })).toHaveCount(0);
          await expect(main.getByRole('button', { name: 'Teilnahme beenden', exact: true })).toBeVisible();
          await expect(main.getByRole('button', { name: 'Privat teilnehmen', exact: true })).toHaveCount(0);
        }
        const overflow = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        expect(overflow.html).toBeLessThanOrEqual(overflow.viewport + 1);
        expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
        // main is a real scroll container. Ensure both the earned badge and its
        // privacy explanation are in the image, including at the 320px width.
        if (complete) {
          const label = main.getByText(`Privates Abzeichen aktiv: ${fixture.badgeLabel}`, { exact: true });
          const badge = label.locator('..');
          await badge.scrollIntoViewIfNeeded();
          await expect(label).toBeInViewport();
          await expect(badge.getByText('Diese Anerkennung ist nur in deinem Lernpfad sichtbar. Sie ist kein Zertifikat.', { exact: true })).toBeInViewport();
        }
        // The image review must verify the painted native fill, not only the
        // accent-color property: Chromium can paint an unrelated default green.
        await expect(progress).toHaveCSS('appearance', 'none');
        await progress.scrollIntoViewIfNeeded();
        await expect(progress).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(complete ? `palette-synthetic-private-active-reward-${paletteTheme}.png`
          : `palette-synthetic-private-pathway-${stateLabel}-${paletteTheme}.png`), animations: 'disabled' });
        await progress.screenshot({ path: testInfo.outputPath(`palette-synthetic-native-progress-${stateLabel}-normal-before-${paletteTheme}.png`), animations: 'disabled' });
        const measureGeometry = () => progress.evaluate(element => {
          const parent = element.parentElement!.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { left: rect.left - parent.left, top: rect.top - parent.top, width: rect.width, height: rect.height,
            parentWidth: parent.width, previousBottom: element.previousElementSibling!.getBoundingClientRect().bottom - parent.top,
            nextTop: element.nextElementSibling ? element.nextElementSibling.getBoundingClientRect().top - parent.top : null,
            marginTop: style.marginTop, marginBottom: style.marginBottom,
            borderWidth: style.borderWidth, padding: style.padding };
        });
        const normalGeometry = await measureGeometry();
        expect(normalGeometry.height).toBe(12);
        expect(normalGeometry.width).toBe(normalGeometry.parentWidth);
        const normalColors = await progress.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
        await expect(progress).toHaveCSS('background-color', paletteTheme === 'dark' ? 'rgb(24, 62, 71)' : 'rgb(226, 238, 236)');
        await expect(progress).toHaveCSS('color', paletteTheme === 'dark' ? 'rgb(114, 208, 204)' : 'rgb(7, 92, 101)');
        await page.emulateMedia({ colorScheme: paletteTheme, forcedColors: 'active' });
        await expect(progress).toHaveCSS('appearance', 'none');
        await expect(progress).toHaveCSS('forced-color-adjust', 'auto');
        await expect(progress).toHaveCSS('outline-width', '1px');
        await expect(progress).toHaveCSS('outline-style', 'solid');
        await expect(progress).toHaveCSS('outline-offset', '-1px');
        await expect(progress).toHaveAttribute('value', String(creditedCount));
        await expect(progress).toHaveAttribute('max', '2');
        await expect(progress).toHaveAccessibleName(`Lernpfad: ${creditedCount} von 2 Kursen aktuell bestätigt`);
        await expect(main.getByText(`${creditedCount} von 2 Kursen aktuell bestätigt`, { exact: true })).toBeVisible();
        const systemPalette = await progress.evaluate(element => {
          const probe = document.createElement('span');
          probe.hidden = true;
          element.parentElement!.append(probe);
          probe.style.color = 'Canvas';
          const canvas = getComputedStyle(probe).color;
          probe.style.color = 'CanvasText';
          const canvasText = getComputedStyle(probe).color;
          probe.remove();
          const style = getComputedStyle(element);
          return { forcedColorsActive: matchMedia('(forced-colors: active)').matches,
            prefersDark: matchMedia('(prefers-color-scheme: dark)').matches, colorScheme: getComputedStyle(document.documentElement).colorScheme,
            canvas, canvasText, background: style.backgroundColor, color: style.color, outline: style.outlineColor,
            forcedColorAdjust: style.forcedColorAdjust };
        });
        const forcedGeometry = await measureGeometry();
        const forcedEvidence = { syntheticRenderingOnly: true, project: testInfo.project.name, paletteTheme, creditedCount, requiredCount: 2,
          systemPalette, normalColors, normalGeometry, forcedGeometry,
          limitation: 'Chromium emulation only; no persisted award or Firefox/WebKit forced-color native pixel evidence.' };
        // The current CI artifact upload retains PNGs only. Keep this bounded
        // palette/geometry evidence in its durable job log as well.
        console.info('Synthetic native progress forced-color evidence:', JSON.stringify(forcedEvidence));
        await testInfo.attach(`synthetic-native-progress-${stateLabel}-${paletteTheme}-forced-evidence`, {
          body: Buffer.from(JSON.stringify(forcedEvidence, null, 2)),
          contentType: 'application/json',
        });
        expect(systemPalette.forcedColorsActive).toBe(true);
        expect(systemPalette.prefersDark).toBe(paletteTheme === 'dark');
        expect(systemPalette.canvas).not.toBe(systemPalette.canvasText);
        // Establish the actual emulated light/dark system palette, rather than
        // inferring it from the screenshot filename or the app's .dark class.
        const brightness = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).reduce((sum, channel) => sum + channel, 0);
        expect(brightness(systemPalette.canvas) > brightness(systemPalette.canvasText)).toBe(paletteTheme === 'light');
        expect(systemPalette.background).toBe(systemPalette.canvas);
        expect(systemPalette.color).toBe(systemPalette.canvasText);
        expect(systemPalette.outline).toBe(systemPalette.canvasText);
        await progress.scrollIntoViewIfNeeded();
        await expect(progress).toBeInViewport();
        expect(forcedGeometry).toEqual(normalGeometry);
        const forcedOverflow = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        expect(forcedOverflow.html).toBeLessThanOrEqual(forcedOverflow.viewport + 1);
        expect(forcedOverflow.body).toBeLessThanOrEqual(forcedOverflow.viewport + 1);
        // Native shadow-part rasterization is verified from these real CI
        // images. Computed host colors cannot establish the painted fill.
        await page.screenshot({ path: testInfo.outputPath(complete ? `palette-native-progress-forced-colors-${paletteTheme}.png`
          : `palette-synthetic-native-progress-${stateLabel}-forced-colors-${paletteTheme}.png`), animations: 'disabled' });
        await progress.screenshot({ path: testInfo.outputPath(`palette-synthetic-native-progress-${stateLabel}-forced-colors-crop-${paletteTheme}.png`), animations: 'disabled' });
        await page.emulateMedia({ colorScheme: paletteTheme, forcedColors: 'none' });
        await expect(progress).toHaveCSS('appearance', 'none');
        await expect(progress).toHaveCSS('accent-color', paletteTheme === 'dark' ? 'rgb(114, 208, 204)' : 'rgb(7, 92, 101)');
        await expect(progress).toHaveCSS('background-color', normalColors.background);
        await expect(progress).toHaveCSS('color', normalColors.color);
        await expect(progress).toHaveAttribute('value', String(creditedCount));
        await expect(progress).toHaveAttribute('max', '2');
        await expect(progress).toHaveAccessibleName(`Lernpfad: ${creditedCount} von 2 Kursen aktuell bestätigt`);
        await progress.scrollIntoViewIfNeeded();
        await expect(progress).toBeInViewport();
        expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(false);
        const restoredGeometry = await measureGeometry();
        expect(restoredGeometry).toEqual(normalGeometry);
        await progress.screenshot({ path: testInfo.outputPath(`palette-synthetic-native-progress-${stateLabel}-normal-after-${paletteTheme}.png`), animations: 'disabled' });
        const restoredEvidence = { syntheticRenderingOnly: true, project: testInfo.project.name, paletteTheme, creditedCount,
          forcedColorsActive: false, restoredGeometry, normalColors };
        console.info('Synthetic native progress normal restoration evidence:', JSON.stringify(restoredEvidence));
        await testInfo.attach(`synthetic-native-progress-${stateLabel}-${paletteTheme}-restored-evidence`, {
          body: Buffer.from(JSON.stringify(restoredEvidence, null, 2)), contentType: 'application/json',
        });
        expect(mutations).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
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
      if (width === 320) await page.screenshot({ path: testInfo.outputPath('course-analytics-320.png'), fullPage: true, animations: 'disabled' });
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
