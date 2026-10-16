import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const sizes = [
  { width: 1280, height: 800 }, { width: 320, height: 700 },
  { width: 375, height: 812 }, { width: 414, height: 896 }, { width: 768, height: 900 },
];
const course = {
  id: 'qa-route-course', title: 'Route QA Lernkurs', instructor: 'Synthetic Assignment Author', duration: 'Flexibel',
  startDate: null, endDate: null, category: 'Synthetische Browserprüfung', participants: 1, maxStudents: 10,
  price: null, currency: null, isEnrolled: true, completed: false, canDelete: false, imageUrl: null,
};
const openStep = { id: 'qa-open', title: 'Route QA offener Lernschritt', type: 'TEXT', order: 2, locked: false,
  releaseLocked: false, publicationId: 'qa-publication', subContents: [] };
const lockedStep = { ...openStep, id: 'qa-locked', title: 'Route QA gesperrter Schritt', order: 1, locked: true, releaseLocked: true };
// The two leading catalog strings match the unchanged desktop review capture.
// That capture used a changing shared disposable DB (6 courses desktop, 9 mobile).
// This fixed six-row render fixture is synthetic API evidence, not a new DB pass.
const catalog = [
  { ...course, id: 'assignment', title: 'Synthetic assignment c47c73eb', isEnrolled: false },
  { ...course, id: 'publication', title: 'Private publication 32ab52c6', instructor: 'Synthetic Publication Author', isEnrolled: false },
  { ...course, id: 'start', title: 'Gemeinsam ein Projekt beginnen', category: 'Zusammenarbeit' },
  { ...course, id: 'feedback', title: 'Hilfreiches Feedback geben', category: 'Zusammenarbeit', isEnrolled: false },
  { ...course, id: 'digital', title: 'Digitale Werkzeuge verstehen', category: 'Technik', price: 49, currency: 'EUR', isEnrolled: false },
  { ...course, id: 'full', title: 'Gespräche moderieren', category: 'Zusammenarbeit', participants: 10, isEnrolled: false },
];

async function signIn(page: Page) {
  const url = process.env.DATABASE_URL;
  const path = url?.startsWith('file:') ? url.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Course entry QA requires the explicitly disposable local SQLite fixture.');
  }
  const nonce = randomUUID();
  const email = `course-entry-${nonce}@example.test`;
  const password = `CourseEntryQaA1!${nonce}`;
  const registered = await page.request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Route QA Member', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.locator('#page-content').evaluate(element => { element.scrollTop = 0; });
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}

async function theme(page: Page, value: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: value, reducedMotion: 'reduce' });
  await page.evaluate(value => localStorage.setItem('theme', value), value);
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'This dedicated capture suite checks all five review viewports itself.');
  await signIn(page);
});

test('catalog and journey bring the real task into the comparable first viewport', async ({ page }, info) => {
  let route: 'catalog' | 'journey' = 'catalog';
  await page.route('**/api/courses', request => request.fulfill({ json: route === 'catalog' ? catalog : [course] }));
  await page.route('**/api/courses/qa-route-course/contents', request => request.fulfill({ json: [lockedStep, openStep] }));
  await page.route('**/api/courses/qa-route-course/progress', request => request.fulfill({ json: {
    completedContentIds: [], complete: false, canTrack: true, publicationId: 'qa-publication',
  } }));
  for (const mode of ['light', 'dark'] as const) {
    await theme(page, mode);
    for (const size of sizes) {
      await page.setViewportSize(size);
      route = 'catalog';
      await page.goto('/courses');
      const search = page.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
      await expect(search).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('heading', { name: catalog[0].title })).toBeInViewport({ ratio: 1 });
      await capture(page, info, `catalog-comparable-${mode}-${size.width}x${size.height}`);
      await search.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('combobox', { name: 'Kategorie' })).toBeFocused();
      await page.screenshot({ path: info.outputPath(`catalog-keyboard-${mode}-${size.width}.png`), fullPage: true, animations: 'disabled' });
      const navigation = page.getByRole('navigation', { name: 'Weitere Kursbereiche' });
      await page.keyboard.press('Tab');
      await expect(navigation.getByRole('link', { name: 'Mein Lernweg' })).toBeFocused();
      await expect(navigation.getByRole('link', { name: 'Mein Lernweg' })).toHaveAttribute('href', '/courses/journey');
      await page.keyboard.press('Tab');
      const trigger = navigation.getByRole('button', { name: 'Kursbereiche' });
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', { name: 'Kursbereiche' });
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(menu.getByRole('menuitem')).toHaveCount(4);
      for (const [index, [name, href]] of [
        ['Lernpfade', '/courses/pathways'], ['Mein Lernziel', '/courses/goals'],
        ['Meine Kursentwürfe', '/courses/authoring'], ['Neuer Kurs', '/courses/new'],
      ].entries()) {
        const item = menu.getByRole('menuitem', { name });
        await expect(item).toHaveAttribute('href', href);
        if (index > 0) await page.keyboard.press('ArrowDown');
        await expect(item).toBeFocused();
        await expect(item).toBeInViewport({ ratio: 1 });
      }
      await capture(page, info, `catalog-menu-open-${mode}-${size.width}x${size.height}`);
      await page.keyboard.press('Home');
      await expect(menu.getByRole('menuitem', { name: 'Lernpfade' })).toBeFocused();
      await page.keyboard.press('End');
      await expect(menu.getByRole('menuitem', { name: 'Neuer Kurs' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(() => trigger.evaluate(element => element.matches(':focus-visible'))).toBe(true);
      await page.screenshot({ path: info.outputPath(`catalog-menu-trigger-focus-${mode}-${size.width}.png`), fullPage: true, animations: 'disabled' });
      await page.keyboard.press('Tab');
      await expect(page.getByRole('list', { name: 'Kurse' }).getByRole('listitem').first().getByRole('button', { name: 'Kurs beitreten' })).toBeFocused();
      route = 'journey';
      await page.goto('/courses/journey');
      await expect(page.getByRole('heading', { name: course.title })).toBeInViewport({ ratio: 1 });
      const next = page.getByRole('link', { name: 'Lernschritt öffnen' });
      await expect(next).toHaveAttribute('href', '/courses/qa-route-course/contents?content=qa-open');
      await expect(next).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('status')).toHaveText('0 von 2 Inhalten aktuell bestätigt');
      await expect(page.locator('[data-journey-mascot]')).toHaveCount(1);
      await expect(page.locator('img[src*="forge-spark-blink"]')).toHaveCount(0);
      await expect(page.locator('[data-spark-celebration]')).toHaveCount(0);
      await capture(page, info, `journey-comparable-${mode}-${size.width}x${size.height}`);
      await next.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Maskottchen anzeigen' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-journey-mascot]')).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-journey-mascot]')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Figurenanimationen aus' })).toBeDisabled();
    }
  }
});

test('catalog menu links activate their existing destinations with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route('**/api/courses', request => request.fulfill({ json: catalog }));
  const destinations = [
    ['Mein Lernweg', '/courses/journey'], ['Lernpfade', '/courses/pathways'], ['Mein Lernziel', '/courses/goals'],
    ['Meine Kursentwürfe', '/courses/authoring'], ['Neuer Kurs', '/courses/new'],
  ];
  for (const [index, [name, href]] of destinations.entries()) {
    await page.goto('/courses');
    await expect(page.getByRole('heading', { name: catalog[0].title })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: 'Weitere Kursbereiche' });
    if (name === 'Mein Lernweg') await navigation.getByRole('link', { name }).focus();
    else {
      await navigation.getByRole('button', { name: 'Kursbereiche' }).focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', { name: 'Kursbereiche' });
      await expect(menu.getByRole('menuitem')).toHaveCount(4);
      // Roving focus is deferred: confirm entry and each move before the next key.
      await expect(menu.getByRole('menuitem', { name: destinations[1][0], exact: true })).toBeFocused();
      for (let position = 1; position < index; position++) {
        await page.keyboard.press('ArrowDown');
        await expect(menu.getByRole('menuitem', { name: destinations[position + 1][0], exact: true })).toBeFocused();
      }
      await expect(menu.getByRole('menuitem', { name })).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(url => url.pathname === href);
  }
});

test('catalog secondary navigation preserves creator and other account perspectives at all review sizes', async ({ page }, info) => {
  const sessionResponse = await page.request.get(`${origin}/api/auth/session`);
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  expect(session.user.id).toBeTruthy();
  // Synthetic session roles exercise navigation presentation only, not server authorization.
  let role = 'ADMIN';
  await page.route('**/api/auth/session', request => request.fulfill({ json: { ...session, user: { ...session.user, role } } }));
  await page.route('**/api/courses', request => request.fulfill({ json: catalog }));
  for (const currentRole of ['ADMIN', 'INSTRUCTOR', 'COMPANY', 'MODERATOR']) {
    role = currentRole;
    const creator = role === 'ADMIN' || role === 'INSTRUCTOR';
    for (const mode of ['light', 'dark'] as const) {
      await theme(page, mode);
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto('/courses');
        await expect(page.getByRole('heading', { name: catalog[0].title })).toBeInViewport({ ratio: 1 });
        const main = page.locator('#page-content');
        const navigation = main.getByRole('navigation', { name: 'Weitere Kursbereiche' });
        await expect(navigation.getByRole('link', { name: 'Mein Lernweg' })).toHaveCount(0);
        const create = main.getByRole('link', { name: 'Neuer Kurs', exact: true });
        if (creator) {
          await expect(create).toHaveAttribute('href', '/courses/new');
          await expect(create).toBeInViewport({ ratio: 1 });
        } else await expect(create).toHaveCount(0);
        await capture(page, info, `catalog-role-${role.toLowerCase()}-${mode}-${size.width}x${size.height}`);
        const trigger = navigation.getByRole('button', { name: 'Kursbereiche' });
        await trigger.focus();
        await page.keyboard.press('Space');
        const menu = page.getByRole('menu', { name: 'Kursbereiche' });
        const expected = [
          ['Mein Lernziel', '/courses/goals'], ['Meine Kursentwürfe', '/courses/authoring'],
          ...(!creator ? [['Neuer Kurs', '/courses/new']] : []),
        ];
        await expect(menu.getByRole('menuitem')).toHaveCount(expected.length);
        await expect(menu.getByRole('menuitem', { name: 'Lernpfade' })).toHaveCount(0);
        for (const [index, [name, href]] of expected.entries()) {
          const item = menu.getByRole('menuitem', { name });
          await expect(item).toHaveAttribute('href', href);
          if (index > 0) await page.keyboard.press('ArrowDown');
          await expect(item).toBeFocused();
          await expect(item).toBeInViewport({ ratio: 1 });
        }
        await capture(page, info, `catalog-role-${role.toLowerCase()}-menu-${mode}-${size.width}x${size.height}`);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
    }
  }
});

test('catalog loading, empty, filtered and failed states stay distinct; long labels are separate stress evidence', async ({ page }, info) => {
  let state: 'populated' | 'empty' | 'error' | 'loading' | 'stress' = 'populated';
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const longTitle = 'Gemeinschaftliche Projektplanung mit nachvollziehbaren Entscheidungen und langfristiger Wissensweitergabe';
  await page.route('**/api/courses', async request => {
    if (state === 'loading') await pending;
    await request.fulfill({ status: state === 'error' ? 503 : 200, json: state === 'empty' ? [] : state === 'stress'
      ? [{ ...catalog[0], title: longTitle, instructor: 'Lehrkraft für gemeinschaftliche Wissensweitergabe und digitale Zusammenarbeit', category: 'Gemeinschaftliche Organisationsentwicklung und Verantwortung' }]
      : catalog });
  });
  for (const mode of ['light', 'dark'] as const) {
    await theme(page, mode);
    await page.setViewportSize({ width: 320, height: 700 });
    state = 'populated';
    await page.goto('/courses');
    const search = page.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
    await expect(page.getByRole('heading', { name: catalog[0].title })).toBeVisible();
    await search.fill('Kein passender Kurs');
    await expect(page.getByRole('heading', { name: 'Keine Kurse gefunden' })).toBeVisible();
    await capture(page, info, `catalog-no-results-${mode}-320x700`);
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await expect(search).toBeFocused();
    for (const current of ['empty', 'error', 'stress'] as const) {
      state = current;
      await page.reload();
      if (current === 'empty') await expect(page.getByRole('heading', { name: 'Noch keine Kurse' })).toBeVisible();
      if (current === 'error') await expect(page.locator('#page-content').getByRole('alert')).toContainText('Kurse konnten nicht geladen werden');
      if (current === 'stress') await expect(page.getByRole('heading', { name: longTitle })).toBeVisible();
      await capture(page, info, `catalog-${current}-${mode}-320x700`);
    }
  }
  state = 'loading';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kurse werden geladen' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Noch keine Kurse' })).toHaveCount(0);
  await capture(page, info, 'catalog-loading-dark-320x700');
  release();
  await expect(page.getByRole('heading', { name: catalog[0].title })).toBeVisible();
});

test('journey locked, empty, error and long-content states keep honest actions and independent figure preferences', async ({ page }, info) => {
  let state: 'locked' | 'empty' | 'error' | 'stress' = 'locked';
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/courses', request => request.fulfill({ json: [{ ...course, title: state === 'stress'
    ? 'Gemeinschaftliche Projektplanung mit nachvollziehbaren Entscheidungen und langfristiger Wissensweitergabe' : course.title }] }));
  await page.route('**/api/courses/qa-route-course/contents', request => request.fulfill({ status: state === 'error' ? 503 : 200, json:
    state === 'empty' ? [] : state === 'stress' ? [{ ...openStep, title: 'Verantwortungsübernahme und Wissensweitergabevereinbarungen gemeinsam nachvollziehbar gestalten' }] : [lockedStep] }));
  await page.route('**/api/courses/qa-route-course/progress', request => request.fulfill({ json: {
    completedContentIds: [], complete: false, canTrack: true, publicationId: 'qa-publication',
  } }));
  for (const mode of ['light', 'dark'] as const) {
    await theme(page, mode);
    for (const current of ['locked', 'empty', 'error', 'stress'] as const) {
      state = current;
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto('/courses/journey');
      if (current === 'error') await expect(page.locator('#page-content').getByRole('alert')).toContainText('Der Kursstand konnte nicht geladen werden');
      else if (current === 'stress') await expect(page.getByRole('link', { name: 'Lernschritt öffnen' })).toBeVisible();
      else {
        await expect(page.getByRole('link', { name: 'Kurs ansehen' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Lernschritt öffnen' })).toHaveCount(0);
        if (current === 'empty') await expect(page.getByRole('progressbar')).toHaveCount(0);
        else await expect(page.getByText('Gerade ist kein weiterer Inhalt frei.')).toBeVisible();
      }
      await capture(page, info, `journey-${current}-${mode}-320x700`);
    }
  }
  // Explicit device-local motion-off is independently operable with no OS reduction.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.getByRole('button', { name: 'Figurenanimationen an' }).click();
  await expect(page.getByRole('button', { name: 'Figurenanimationen aus' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Maskottchen anzeigen' }).click();
  await expect(page.locator('[data-journey-mascot]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Maskottchen anzeigen' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Maskottchen anzeigen' }).click();
  await expect(page.getByRole('button', { name: 'Figurenanimationen aus' })).toHaveAttribute('aria-pressed', 'false');
  await capture(page, info, 'journey-stress-motion-off-dark-320x700');
});
