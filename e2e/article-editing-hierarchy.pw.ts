import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const viewports = [{ width: 1280, height: 800 }, { width: 320, height: 700 }];
const routes = [
  { name: 'published', url: '/knowledgebase/qa-edit-hierarchy/edit', save: 'Speichern', loading: 'Artikel wird geladen', failed: 'Artikel konnte nicht geladen werden' },
  { name: 'draft', url: '/knowledgebase/edit/qa-edit-hierarchy', save: 'Als Entwurf speichern', loading: 'Entwurf wird geladen', failed: 'Entwurf konnte nicht geladen werden' },
] as const;
const longTitle = 'Projektentscheidungen gemeinsam festhalten und im nächsten Teamtreffen verständlich weitergeben';
const preview = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#E1E7F9"/><text x="70" y="110" font-family="sans-serif" font-size="44" fill="#212935">Synthetische Bildvorschau: Projektplan</text><g fill="#FDFDFC" stroke="#1B45C0" stroke-width="5"><rect x="70" y="170" width="300" height="350" rx="18"/><rect x="450" y="170" width="300" height="350" rx="18"/><rect x="830" y="170" width="300" height="350" rx="18"/></g><g fill="#212935" font-family="sans-serif" font-size="38"><text x="100" y="240">Sammeln</text><text x="480" y="240">Entscheiden</text><text x="860" y="240">Weitergeben</text></g></svg>').toString('base64')}`;

// These intercepted article/metadata responses exercise rendering only. Real
// publication, storage, sanitization and server permissions remain covered by
// their existing tests; this suite does not claim those from synthetic data.
function article(authorId: string, rich = false) {
  return {
    id: 'qa-edit-hierarchy', title: rich ? longTitle : 'Route QA article',
    content: rich ? '<p>Synthetischer Artikel: Wir halten Entscheidungen so fest, dass alle im Team damit weiterarbeiten können.</p><h2>Vor dem nächsten Treffen</h2><ul><li>Fragestellung und Beteiligte benennen.</li><li>Entscheidung und nächsten Schritt festhalten.</li></ul><p>Offene Fragen bleiben sichtbar. Gemeinsam prüfen wir beim nächsten Treffen, was sich geändert hat.</p>' : '<p>Synthetic article fixture.</p>',
    category: rich ? 'Gemeinschaftliche Projektarbeit und Wissensweitergabe' : 'QA',
    featuredImage: rich ? preview : null,
    author: { id: authorId, name: 'Synthetische Artikelautorin', email: 'synthetic@example.test' },
    createdAt: '2026-10-01T12:00:00.000Z',
    tags: rich ? [{ id: 'qa-tag-1', name: 'Projektplanung' }, { id: 'qa-tag-2', name: 'Wissensweitergabe' }] : [],
  };
}
async function signIn(page: Page) {
  const database = process.env.DATABASE_URL;
  const path = database?.startsWith('file:') ? database.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Article hierarchy captures require the explicitly disposable local SQLite QA fixture.');
  }
  const nonce = randomUUID();
  const email = `article-hierarchy-${nonce}@example.test`;
  const password = `ArticleHierarchyQaA1!${nonce}`;
  const registered = await page.request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Route QA Member', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const { userId } = await registered.json() as { userId: string };
  expect(userId).toBeTruthy();
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  return userId;
}
async function setTheme(page: Page, mode: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
  await page.evaluate(value => localStorage.setItem('theme', value), mode);
}
async function capture(page: Page, info: TestInfo, name: string, reset = true) {
  if (reset) await page.getByRole('main').evaluate(element => { element.scrollTop = 0; });
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.getByRole('main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
}
async function before(first: Locator, second: Locator) {
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a!.y + a!.height).toBeLessThanOrEqual(b!.y);
}

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'This dedicated suite captures 1280×800 and 320×700 itself.');
});

test('both edit routes prioritize required metadata and existing text in light/dark desktop/mobile captures', async ({ page }, info) => {
  test.setTimeout(300_000);
  const authorId = await signIn(page);
  let rich = false;
  await page.route('**/api/articles/qa-edit-hierarchy', route => route.fulfill({ json: article(authorId, rich) }));
  await page.route('**/api/articles/categories-and-tags', route => route.fulfill({ json: {
    categories: ['QA', 'Gemeinschaftliche Projektarbeit und Wissensweitergabe'], tags: ['Projektplanung', 'Wissensweitergabe', 'Feedback'],
  } }));
  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode);
    for (const size of viewports) {
      await page.setViewportSize(size);
      for (const current of routes) {
        for (const populated of [false, true]) {
          rich = populated;
          await page.goto(current.url);
          await expect(page.locator('html')).toHaveClass(new RegExp(mode));
          const title = page.getByRole('textbox', { name: 'Titel' });
          const category = page.getByRole('combobox', { name: 'Kategorie' });
          const editor = page.getByRole('textbox', { name: 'Text bearbeiten' });
          await expect(title).toHaveValue(rich ? longTitle : 'Route QA article');
          await expect(category).toHaveValue(rich ? 'Gemeinschaftliche Projektarbeit und Wissensweitergabe' : 'QA');
          await expect(editor).toContainText(rich ? 'Synthetischer Artikel' : 'Synthetic article fixture.');
          await expect(page.getByRole('group', { name: 'Pflichtangaben' })).toHaveAccessibleDescription('Pflichtangaben: Titel, Inhalt und Kategorie.');
          await expect(title).toHaveAttribute('required', '');
          await expect(title).toHaveAttribute('maxlength', '100');
          await expect(title).toBeInViewport({ ratio: 1 });
          await expect(category).toBeInViewport({ ratio: 1 });
          await expect(page.getByRole('button', { name: 'Fett', exact: true })).toBeInViewport({ ratio: 1 });
          if (!rich) await expect(editor.locator('p').first()).toBeInViewport({ ratio: 1 });
          await expect(page.getByRole('button', { name: current.save, exact: true })).toBeInViewport({ ratio: 1 });
          if (current.name === 'draft') await expect(page.getByRole('button', { name: 'Veröffentlichen', exact: true })).toBeInViewport({ ratio: 1 });
          const optional = page.getByRole('complementary', { name: 'Optionale Artikelangaben' });
          await before(category, editor);
          await before(editor, optional);
          await expect(page.getByText('Noch kein Bild ausgewählt')).toHaveCount(0);
          const stem = `article-${current.name}-${rich ? 'synthetic-populated-long-title' : 'comparable-empty-image'}-${mode}-${size.width}x${size.height}`;
          await capture(page, info, stem);
          await title.focus();
          await page.keyboard.press('Tab');
          await expect(category).toBeFocused();
          await capture(page, info, `${stem}-category-focus`, false);
          await page.keyboard.press('Tab');
          await expect(page.getByRole('button', { name: 'Neue Kategorie erstellen' })).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(page.getByRole('button', { name: 'Fett', exact: true })).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(editor).toBeFocused();
          await expect(page.getByRole('button', { name: 'Fett', exact: true })).toHaveAttribute('aria-pressed', 'true');
          await page.keyboard.insertText('Synthetisch fett. ');
          await expect(editor.locator('strong')).toHaveText('Synthetisch fett.');
          await expect(page.getByRole('button', { name: 'Fett', exact: true })).toHaveAttribute('aria-pressed', 'true');
          await capture(page, info, `${stem}-editor-keyboard`, false);
          await optional.scrollIntoViewIfNeeded();
          await expect(optional.getByLabel('Beitragsbild (optional)')).toHaveAttribute('type', 'file');
          await expect(optional.getByLabel('Tags (max. 5)')).toBeVisible();
          if (rich) {
            const image = optional.getByRole('img', { name: 'Beitragsbildvorschau' });
            await expect(image).toBeVisible();
            await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
            await expect(optional.getByRole('button', { name: 'Tag Projektplanung entfernen' })).toBeVisible();
            const remove = optional.getByRole('button', { name: 'Beitragsbild entfernen' });
            await remove.focus();
            await expect(remove).toBeFocused();
            await capture(page, info, `${stem}-optional-image-focus`, false);
            await page.keyboard.press('Enter');
            await expect(image).toHaveCount(0);
          } else {
            await expect(optional.getByRole('img')).toHaveCount(0);
            await capture(page, info, `${stem}-compact-optional`, false);
          }
        }
      }
    }
  }
});

test('edit loading, server-error and rendered access-guard states remain distinct', async ({ page }, info) => {
  const authorId = await signIn(page);
  let state: 'ok' | 'loading' | 'error' | 'other-author' = 'ok';
  let release = () => {};
  let pending = Promise.resolve();
  await page.route('**/api/articles/qa-edit-hierarchy', async route => {
    if (state === 'loading') await pending;
    await route.fulfill({ status: state === 'error' ? 503 : 200, json: article(state === 'other-author' ? 'another-synthetic-author' : authorId) });
  });
  await page.route('**/api/articles/categories-and-tags', route => route.fulfill({ json: { categories: ['QA'], tags: [] } }));
  await page.setViewportSize({ width: 320, height: 700 });
  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode);
    for (const current of routes) {
      state = 'loading';
      pending = new Promise<void>(resolve => { release = resolve; });
      await page.goto(current.url);
      await expect(page.getByRole('main').getByRole('status')).toContainText(current.loading);
      await expect(page.getByRole('textbox', { name: 'Text bearbeiten' })).toHaveCount(0);
      await capture(page, info, `${current.name}-loading-${mode}-320x700`);
      state = 'ok';
      release();
      await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Route QA article');
      for (const failed of ['error', 'other-author'] as const) {
        state = failed;
        await page.reload();
        await expect(page.getByRole('main').getByRole('alert')).toContainText(current.failed);
        await expect(page.getByRole('textbox', { name: 'Text bearbeiten' })).toHaveCount(0);
        await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveCount(0);
        if (current.name === 'published') await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toHaveCount(0);
        // The existing draft header actions are outside its load-error branch.
        // Preserve that behavior, and do not misrepresent them as usable content.
        await capture(page, info, `${current.name}-${failed}-render-only-${mode}-320x700`);
      }
      if (current.name === 'draft') {
        state = 'ok';
        await page.getByRole('button', { name: 'Erneut versuchen' }).click();
        await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Route QA article');
      }
    }
  }
});

test('save and explicit draft/publish keep their original multipart intent and pending behavior', async ({ page }, info) => {
  const authorId = await signIn(page);
  let release = () => {};
  let submitted = '';
  let pending = Promise.resolve();
  await page.route('**/api/articles/qa-edit-hierarchy', async route => {
    if (route.request().method() === 'PUT') {
      submitted = route.request().postData() ?? '';
      await pending;
      await route.fulfill({ status: 500, json: { error: 'Synthetischer Speicherfehler' } });
    } else await route.fulfill({ json: article(authorId) });
  });
  await page.route('**/api/articles/categories-and-tags', route => route.fulfill({ json: { categories: ['QA'], tags: [] } }));
  await page.setViewportSize({ width: 320, height: 700 });
  await setTheme(page, 'dark');
  for (const current of routes) {
    for (const publish of current.name === 'draft' ? [false, true] : [false]) {
      await page.goto(current.url);
      await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Route QA article');
      submitted = '';
      pending = new Promise<void>(resolve => { release = resolve; });
      await page.getByRole('button', { name: publish ? 'Veröffentlichen' : current.save, exact: true }).click();
      await expect.poll(() => submitted).toContain('name="content"');
      expect(submitted).toContain('Synthetic article fixture.');
      expect(submitted).toMatch(/name="deleteImage"\r\n\r\nfalse/);
      if (current.name === 'draft') expect(submitted).toMatch(new RegExp(`name="isPublished"\\r\\n\\r\\n${publish}`));
      else expect(submitted).not.toContain('name="isPublished"');
      const pendingName = current.name === 'published' ? 'Speichern…' : publish ? 'Veröffentliche…' : 'Speichere Entwurf…';
      await expect(page.getByRole('button', { name: pendingName, exact: true })).toBeDisabled();
      if (current.name === 'draft') await expect(page.getByRole('button', { name: publish ? 'Als Entwurf speichern' : 'Veröffentlichen', exact: true })).toBeDisabled();
      await expect(page).toHaveURL(new RegExp(`${current.url}$`));
      await capture(page, info, `${current.name}-${publish ? 'publish' : 'save'}-pending-dark-320x700`);
      release();
      await expect(page.getByRole('button', { name: current.save, exact: true })).toBeEnabled();
      await expect(page).toHaveURL(new RegExp(`${current.url}$`));
      await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Route QA article');
      if (current.name === 'published') await expect(page.getByRole('main').getByRole('alert')).toContainText('Synthetischer Speicherfehler');
      else await expect(page.getByRole('main').getByText('Fehler beim Speichern des Artikels', { exact: true })).toBeVisible();
      await capture(page, info, `${current.name}-${publish ? 'publish' : 'save'}-failed-dark-320x700`);
    }
  }
});


test('one local draft feedback host shows required/server errors without covering save or publish', async ({ page }, info) => {
  const authorId = await signIn(page);
  let updates = 0;
  await page.route('**/api/articles/qa-edit-hierarchy', route => {
    if (route.request().method() === 'PUT') {
      updates++;
      return route.fulfill({ status: 500, json: { error: 'Synthetic failure' } });
    }
    return route.fulfill({ json: article(authorId) });
  });
  await page.route('**/api/articles/categories-and-tags', route => route.fulfill({ json: { categories: ['QA'], tags: [] } }));
  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode);
    for (const size of viewports) {
      await page.setViewportSize(size);
      for (const action of ['Als Entwurf speichern', 'Veröffentlichen']) {
        for (const failure of ['required', 'server'] as const) {
          await page.goto('/knowledgebase/edit/qa-edit-hierarchy');
          const title = page.getByRole('textbox', { name: 'Titel' });
          await expect(title).toHaveValue('Route QA article');
          updates = 0;
          if (failure === 'required') await title.fill('');
          else await title.fill('Synthetisch weiterbearbeitet');
          await page.getByRole('button', { name: action, exact: true }).click();
          const feedback = page.getByRole('main').getByText(failure === 'required'
            ? 'Bitte füllen Sie alle erforderlichen Felder aus.' : 'Fehler beim Speichern des Artikels', { exact: true });
          await expect(feedback).toBeVisible();
          await expect(page.locator('[data-sonner-toaster]')).toHaveCount(1);
          await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
          const toast = await page.locator('[data-sonner-toast]').boundingBox();
          expect(toast).not.toBeNull();
          for (const name of ['Als Entwurf speichern', 'Veröffentlichen']) {
            const button = page.getByRole('button', { name, exact: true });
            await expect(button).toBeEnabled();
            await expect(button).toBeInViewport({ ratio: 1 });
            const bounds = await button.boundingBox();
            expect(bounds).not.toBeNull();
            const overlaps = bounds!.x < toast!.x + toast!.width && bounds!.x + bounds!.width > toast!.x &&
              bounds!.y < toast!.y + toast!.height && bounds!.y + bounds!.height > toast!.y;
            expect(overlaps).toBe(false);
            await button.focus();
            await expect(button).toBeFocused();
          }
          await expect(title).toHaveValue(failure === 'required' ? '' : 'Synthetisch weiterbearbeitet');
          await expect(page.getByRole('combobox', { name: 'Kategorie' })).toHaveValue('QA');
          await expect(page.getByRole('textbox', { name: 'Text bearbeiten' })).toContainText('Synthetic article fixture.');
          await expect(page).toHaveURL(/\/knowledgebase\/edit\/qa-edit-hierarchy$/);
          await capture(page, info, `draft-feedback-${failure}-${action === 'Veröffentlichen' ? 'publish' : 'save'}-${mode}-${size.width}x${size.height}`);
          expect(updates).toBe(failure === 'required' ? 0 : 1);
        }
      }
    }
  }
  // Success is still followed immediately by the existing navigation. This
  // test makes no claim that a success toast survives its local host unmount.
});
