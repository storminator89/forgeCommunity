import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

// Explicitly synthetic rendering fixtures. These captures do not prove article
// storage, publication, sanitization or authorization. The existing real-HTTP
// journeys and their assertions remain unchanged.
const articles = [
  { id: 'synthetic-repair', title: 'Reparaturen gemeinsam dokumentieren', content: '<p>Eine Checkliste hält Beobachtungen und nächste Schritte zusammen.</p>', category: 'Werkstatt', featuredImage: null, author: { id: 'ada', name: 'Ada Winter', email: 'ada@example.test' }, createdAt: '2026-05-01T10:00:00Z', tags: [{ id: 'checklist', name: 'Checkliste' }] },
  { id: 'synthetic-tools', title: 'Werkzeug nach dem Lerntreffen pflegen', content: '<p>So bleibt die gemeinsame Werkstatt für alle nutzbar.</p>', category: 'Werkstatt', featuredImage: null, author: { id: 'bea', name: 'Bea Sommer', email: 'bea@example.test' }, createdAt: '2026-05-02T10:00:00Z', tags: [{ id: 'practice', name: 'Praxis' }] },
  { id: 'synthetic-meeting', title: 'Ein offenes Lerntreffen planen', content: '<p>Raum für Fragen und gemeinsamen Austausch schaffen.</p>', category: 'Zusammenarbeit', featuredImage: null, author: { id: 'ada', name: 'Ada Winter', email: 'ada@example.test' }, createdAt: '2026-05-03T10:00:00Z', tags: [] },
];
const longCategory = 'Gemeinschaftswerkstatt'.repeat(6);
const longTag = 'Reparaturdokumentation'.repeat(6);
const longArticle = { ...articles[0], title: 'Gemeinsam gesammelte Werkstatterfahrungen verständlich weitergeben', category: longCategory, author: { ...articles[0].author, name: 'Lernbegleitung'.repeat(8) }, tags: [{ id: 'synthetic-long-tag', name: longTag }] };
const metadata = { categories: ['Werkstatt', longCategory], tags: ['Checkliste', longTag] };

async function login(page: Page) {
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Knowledge captures require a loopback server and its explicitly disposable SQLite fixture database.');
  }
  const id = randomUUID();
  const email = `knowledge-capture-${id}@example.test`;
  const password = `KnowledgeCaptureA1!${id}`;
  const registered = await page.request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Knowledge QA', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  await page.goto('/login?callbackUrl=%2Fknowledgebase');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/knowledgebase$/);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.locator('main').evaluate(main => main.scrollWidth <= main.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

async function openFilters(page: Page, narrow: boolean) {
  if (narrow) {
    const toggle = page.getByRole('button', { name: 'Filter', exact: true });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.getByRole('group', { name: 'Kategorie wählen', exact: true })).toBeVisible();
}

async function expectFeedbackClearOfActions(page: Page, message: string) {
  const main = page.locator('main');
  const host = main.locator('[data-sonner-toaster]');
  await expect(host).toHaveCount(1);
  const feedback = host.locator('[data-sonner-toast]').filter({ hasText: message });
  await expect(feedback.getByText(message, { exact: true })).toBeVisible();
  const toastBox = await feedback.boundingBox();
  expect(toastBox).not.toBeNull();
  for (const name of ['Als Entwurf speichern', 'Veröffentlichen']) {
    const actionBox = await main.getByRole('button', { name, exact: true }).boundingBox();
    expect(actionBox).not.toBeNull();
    const overlaps = toastBox!.x < actionBox!.x + actionBox!.width && toastBox!.x + toastBox!.width > actionBox!.x &&
      toastBox!.y < actionBox!.y + actionBox!.height && toastBox!.y + toastBox!.height > actionBox!.y;
    expect(overlaps).toBe(false);
  }
}

test('knowledge search and real-looking synthetic results precede compact filters in both themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390-chromium', 'This focused slice captures the original 1280x800 and 320x700 viewports.');
  const narrow = testInfo.project.name === 'mobile-320-chromium';
  await login(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('forge-community-motion-off', 'true'));
  let state: 'populated' | 'long' | 'loading' | 'empty' | 'error' = 'populated';
  let loading = Promise.resolve();
  await page.route('**/api/articles', async route => {
    const current = state;
    if (current === 'loading') await loading;
    if (current === 'error') await route.fulfill({ status: 503, json: { error: 'Synthetic fixture unavailable' } });
    else await route.fulfill({ json: current === 'populated' ? articles : current === 'long' ? [longArticle] : [] });
  });

  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme);
    state = 'populated';
    await page.goto('/knowledgebase');
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
    const search = page.getByRole('searchbox', { name: 'Artikel suchen', exact: true });
    const firstTitle = page.getByRole('heading', { name: articles[0].title, exact: true });
    await expect(firstTitle).toBeVisible();
    await expect(search).toBeInViewport({ ratio: 1 });
    await expect(firstTitle).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('link', { name: 'Neuer Artikel', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByText('3 Artikel', { exact: true })).toBeVisible();
    if (narrow) await expect(page.locator('#kb-filter-options')).toBeHidden();
    await capture(page, testInfo, `knowledge-synthetic-results-${theme}`);

    await openFilters(page, narrow);
    const category = page.getByRole('group', { name: 'Kategorie wählen', exact: true });
    const tags = page.getByRole('group', { name: 'Tag wählen', exact: true });
    await category.getByRole('button', { name: 'Werkstatt 2', exact: true }).click();
    await tags.getByRole('button', { name: 'Checkliste 1', exact: true }).click();
    await expect(page.getByText('1 Artikel', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Werkzeug nach dem Lerntreffen/ })).toHaveCount(0);
    await capture(page, testInfo, `knowledge-synthetic-filters-expanded-${theme}`);
    if (narrow) await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(page.getByText('Kategorie: Werkstatt', { exact: true })).toBeVisible();
    await expect(page.getByText('Tag: Checkliste', { exact: true })).toBeVisible();
    await capture(page, testInfo, `knowledge-synthetic-selected-filters-${theme}`);
    await search.fill('ohne Treffer');
    await expect(page.getByRole('heading', { name: 'Keine Artikel gefunden', exact: true })).toBeVisible();
    await capture(page, testInfo, `knowledge-synthetic-no-results-${theme}`);
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(firstTitle).toBeVisible();

    state = 'long';
    await page.reload();
    await expect(page.getByRole('heading', { name: longArticle.title, exact: true })).toBeVisible();
    await openFilters(page, narrow);
    await category.getByRole('button', { name: `${longCategory} 1`, exact: true }).click();
    await tags.getByRole('button', { name: `${longTag} 1`, exact: true }).click();
    await capture(page, testInfo, `knowledge-synthetic-long-filter-labels-${theme}`);
    if (narrow) await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await capture(page, testInfo, `knowledge-synthetic-long-selected-labels-${theme}`);
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
    await expect(page.getByRole('heading', { name: longArticle.title, exact: true })).toBeVisible();

    state = 'error';
    await page.reload();
    const main = page.locator('main');
    await expect(main.getByRole('alert')).toContainText('Artikel konnten nicht geladen werden');
    await expect(main.getByRole('heading', { name: 'Artikel konnten nicht geladen werden', exact: true })).toBeVisible();
    await expect(main.getByText('0 Artikel', { exact: true })).toHaveCount(0);
    await capture(page, testInfo, `knowledge-synthetic-load-error-${theme}`);
    state = 'populated';
    await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(firstTitle).toBeVisible();

    let finishLoading!: () => void;
    loading = new Promise<void>(resolve => { finishLoading = resolve; });
    state = 'loading';
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Artikel werden geladen', exact: true })).toBeVisible();
    await expect(page.getByText('0 Artikel', { exact: true })).toHaveCount(0);
    await capture(page, testInfo, `knowledge-synthetic-loading-${theme}`);
    state = 'empty';
    finishLoading();
    await expect(page.getByRole('heading', { name: 'Noch keine Artikel', exact: true })).toBeVisible();
    await expect(page.getByText('0 Artikel', { exact: true })).toBeVisible();
    await expect(page.getByText('Noch keine Tags.', { exact: true })).toHaveCount(0);
    await capture(page, testInfo, `knowledge-synthetic-empty-${theme}`);
  }
});

test('new article keeps a single early draft/publish pair, keyboard order and unchanged explicit submission intents', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390-chromium', 'This focused slice captures the original 1280x800 and 320x700 viewports.');
  await login(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('forge-community-motion-off', 'true'));
  let metadataUnavailable = false;
  await page.route('**/api/articles/categories-and-tags', route => metadataUnavailable
    ? route.fulfill({ status: 503, json: { error: 'Synthetic metadata unavailable' } })
    : route.fulfill({ json: metadata }));
  const submitted: string[] = [];
  let finishPost!: () => void;
  await page.route('**/api/articles', async route => {
    expect(route.request().method()).toBe('POST');
    submitted.push(route.request().postData() ?? '');
    await new Promise<void>(resolve => { finishPost = resolve; });
    const publishing = /name="isPublished"\r?\n\r?\ntrue/.test(route.request().postData() ?? '');
    await route.fulfill({ status: 503, json: { error: publishing ? 'Synthetischer Veröffentlichungsfehler' : 'Synthetischer Entwurfsfehler' } });
  });

  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme);
    await page.goto('/knowledgebase/new-article');
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
    const title = page.getByRole('textbox', { name: 'Titel', exact: true });
    const draft = page.getByRole('button', { name: 'Als Entwurf speichern', exact: true });
    const publish = page.getByRole('button', { name: 'Veröffentlichen', exact: true });
    const category = page.getByRole('combobox', { name: 'Kategorie', exact: true });
    const content = page.getByRole('textbox', { name: 'Text bearbeiten', exact: true });
    await expect(title).toBeVisible();
    await expect(content).toBeVisible();
    await expect(draft).toHaveCount(1);
    await expect(publish).toHaveCount(1);
    await expect(draft).toBeInViewport({ ratio: 1 });
    await expect(publish).toBeInViewport({ ratio: 1 });
    await expect(category).toBeInViewport({ ratio: 1 });
    await expect(page.getByText('Pflichtangaben: Titel, Inhalt und Kategorie.', { exact: true })).toBeVisible();
    await capture(page, testInfo, `new-article-synthetic-metadata-${theme}`);

    await page.getByRole('button', { name: 'Zur Übersicht', exact: true }).focus();
    await page.keyboard.press('Tab'); await expect(draft).toBeFocused();
    await page.keyboard.press('Tab'); await expect(publish).toBeFocused();
    await page.keyboard.press('Tab'); await expect(title).toBeFocused();
    await page.keyboard.press('Tab'); await expect(category).toBeFocused();
    const beforeValidation = submitted.length;
    await draft.focus(); await page.keyboard.press('Enter');
    await expectFeedbackClearOfActions(page, 'Bitte füllen Sie alle erforderlichen Felder aus.');
    expect(submitted).toHaveLength(beforeValidation);
    await capture(page, testInfo, `new-article-synthetic-required-validation-${theme}`);

    await title.fill('Eine gemeinsame Anleitung für die Werkstatt');
    await category.selectOption(longCategory);
    await content.fill('Beobachtungen verständlich festhalten und gemeinsam prüfen. '.repeat(160));
    await page.getByRole('combobox', { name: 'Tags (max. 5)', exact: true }).selectOption(longTag);
    await page.getByRole('button', { name: `Tag ${longTag} entfernen`, exact: true }).scrollIntoViewIfNeeded();
    await capture(page, testInfo, `new-article-synthetic-long-optional-labels-${theme}`);
    await page.getByRole('button', { name: `Tag ${longTag} entfernen`, exact: true }).click();
    // A one-pixel PNG exercises the existing local selection/preview/removal.
    await page.locator('#featuredImage').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    await expect(page.getByRole('img', { name: 'Vorschau', exact: true })).toBeVisible();
    const removeImage = page.getByRole('button', { name: 'Beitragsbild entfernen', exact: true });
    await removeImage.focus();
    await capture(page, testInfo, `new-article-synthetic-image-keyboard-${theme}`);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('img', { name: 'Vorschau', exact: true })).toHaveCount(0);

    await draft.focus();
    await expect(draft).toBeInViewport({ ratio: 1 });
    await expect(publish).toBeInViewport({ ratio: 1 });
    await capture(page, testInfo, `new-article-synthetic-long-content-action-focus-${theme}`);
    for (const [button, pending, intent] of [
      [draft, 'Speichere...', 'false'], [publish, 'Veröffentliche...', 'true'],
    ] as const) {
      const beforePost = submitted.length;
      await button.focus(); await page.keyboard.press('Enter');
      const pendingAction = page.getByRole('button', { name: pending, exact: true });
      await expect(pendingAction).toBeDisabled();
      await expect(page.getByRole('group', { name: 'Artikel speichern oder veröffentlichen', exact: true }).locator('button:disabled')).toHaveCount(2);
      await expect.poll(() => submitted.length).toBe(beforePost + 1);
      expect(submitted[beforePost]).toMatch(new RegExp(`name="isPublished"\\r?\\n\\r?\\n${intent}`));
      await capture(page, testInfo, `new-article-synthetic-${intent === 'true' ? 'publish' : 'draft'}-pending-${theme}`);
      finishPost();
      await expect(button).toBeEnabled();
      await expectFeedbackClearOfActions(page, intent === 'true' ? 'Synthetischer Veröffentlichungsfehler' : 'Synthetischer Entwurfsfehler');
      await expect(title).toHaveValue('Eine gemeinsame Anleitung für die Werkstatt');
      expect(submitted).toHaveLength(beforePost + 1);
      await expect(page).toHaveURL(/\/knowledgebase\/new-article$/);
    }
    await capture(page, testInfo, `new-article-synthetic-save-error-${theme}`);

    metadataUnavailable = true;
    await page.reload();
    await expect(title).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neue Kategorie erstellen', exact: true })).toBeEnabled();
    await expect(draft).toBeInViewport({ ratio: 1 });
    await expect(publish).toBeInViewport({ ratio: 1 });
    await capture(page, testInfo, `new-article-synthetic-metadata-unavailable-${theme}`);
    metadataUnavailable = false;
  }
});
