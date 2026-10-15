import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Locator, type Page } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

function disposableDatabasePath() {
  const browserOrigin = new URL(origin);
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  // Check before registration, login or course creation. Never seed a real
  // server or follow a fixture-named symlink to another database.
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db' ||
      !lstatSync(databasePath).isFile() || realpathSync(databasePath) !== resolve(databasePath)) {
    throw new Error('Course editor QA requires a loopback origin and the explicitly disposable SQLite fixture.');
  }
  return databasePath;
}

function courseEvidence(courseId: string) {
  const db = new DatabaseSync(disposableDatabasePath(), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return {
      contents: db.prepare('SELECT "id", "title", "type", "content", "parentId", "order", "updatedAt" FROM "CourseContent" WHERE "courseId" = ? ORDER BY "id"').all(courseId),
      attempts: db.prepare('SELECT COUNT(*) AS count FROM "QuizAttempt" WHERE "courseId" = ?').get(courseId)?.count,
      progress: db.prepare('SELECT COUNT(*) AS count FROM "CourseContentProgress" WHERE "courseId" = ?').get(courseId)?.count,
    };
  } finally {
    db.close();
  }
}

async function keyboardActivate(page: Page, target: Locator) {
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}

async function insideViewport(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
}

async function createContent(page: Page, courseId: string, title: string, type: 'TEXT' | 'QUIZ', parentId: string | null) {
  const dialog = page.getByRole('dialog', { name: 'Inhalt hinzufügen', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Titel', exact: true })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill(title);
  const typeButton = dialog.getByRole('group', { name: 'Inhaltstyp', exact: true }).getByRole('button', { name: type === 'TEXT' ? 'Text' : 'Quiz', exact: true });
  await keyboardActivate(page, typeButton);
  await expect(typeButton).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toContainText('Mit „Anlegen“ wird der Eintrag für eingeschriebene Lernende sichtbar.');
  await insideViewport(page, dialog);
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === `/api/courses/${courseId}/contents` && entry.request().method() === 'POST');
  await keyboardActivate(page, dialog.getByRole('button', { name: 'Anlegen', exact: true }));
  const created = await response;
  expect(created.status()).toBe(201);
  const content = await created.json() as { id: string; type: string; title: string; parentId: string | null };
  expect(content).toMatchObject({ title, type, parentId });
  await expect(dialog).toHaveCount(0);
  return content.id;
}

async function saveContent(page: Page, courseId: string, contentId: string) {
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === `/api/courses/${courseId}/contents/${contentId}` && entry.request().method() === 'PUT');
  await keyboardActivate(page, page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true }).getByRole('button', { name: 'Speichern', exact: true }));
  expect((await response).status()).toBe(200);
  const form = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true });
  await expect(form.getByRole('status').filter({ hasText: /^Gespeicherter Inhalt$/ })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Speichern', exact: true })).toBeFocused();
  await expect(page.getByText('Inhalt gespeichert. Änderungen sind sofort für Teilnehmende sichtbar.', { exact: true })).toBeVisible();
  await expect(form).toContainText('Gespeicherte Änderungen sind sofort für Teilnehmende sichtbar.');
}

// Existing CI discovers this with every other *.pw.ts file. Keep the full
// acceptance on desktop and the narrowest touch layout; 390px adds the same
// server writes and branch coverage without a distinct authoring breakpoint.
test('course author creates nested typed content, rehearses an unsaved quiz and explicitly enters learner mode', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390-chromium', 'Desktop and 320px cover both authoring layouts; avoid a third full synthetic course flow.');
  disposableDatabasePath();
  // Never record request headers, credentials, cookies or browser storage.
  // The CI screenshot policy captures only synthetic account/course screens.
  const id = randomUUID();
  const email = `course-editor-${id}@example.test`;
  const password = `CourseEditorA1!${id}`;
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Course Editor Fixture', email, password },
  });
  expect(registration.status()).toBe(201);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);

  const courseTitle = `LMS QA ${id}`;
  const createdCourse = await page.request.post(`${origin}/api/courses`, {
    headers: { origin }, multipart: { title: courseTitle, description: 'Disposable course editor acceptance.' },
  });
  expect(createdCourse.status()).toBe(201);
  const { id: courseId } = await createdCourse.json() as { id: string };
  await page.goto(`/courses/${courseId}/contents`);
  await expect(page.getByRole('heading', { level: 1, name: courseTitle, exact: true })).toBeVisible();
  const modes = page.getByRole('group', { name: 'Kursansicht', exact: true });
  await expect(modes.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(modes.getByRole('button', { name: 'Lernen', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: 'Noch keine Kursinhalte', exact: true })).toBeVisible();

  await keyboardActivate(page, page.locator('#course-authoring-add'));
  const rootId = await createContent(page, courseId, 'Willkommen', 'TEXT', null);
  const form = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true });
  const rootTitle = 'Willkommen, gemeinsam lernen';
  await form.getByRole('textbox', { name: 'Titel', exact: true }).fill(rootTitle);
  await form.getByRole('switch', { name: 'HTML', exact: true }).press('Space');
  await form.getByRole('textbox', { name: 'Inhalt', exact: true }).fill('<p>Dieser Lerntext ist gespeichert und sofort sichtbar.</p>');
  await expect(form.getByRole('status').filter({ hasText: /^Lokal ungespeichert$/ })).toBeVisible();
  await saveContent(page, courseId, rootId);

  await keyboardActivate(page, page.getByRole('button', { name: `Aktionen für ${rootTitle}`, exact: true }));
  await keyboardActivate(page, page.getByRole('menuitem', { name: 'Unterinhalt hinzufügen', exact: true }));
  await expect(page.getByRole('dialog', { name: 'Inhalt hinzufügen', exact: true })).toContainText(`Unter „${rootTitle}“`);
  const quizTitle = 'Wissenscheck mit Kurzantwort';
  const quizId = await createContent(page, courseId, quizTitle, 'QUIZ', rootId);
  await expect(form.getByRole('group', { name: 'Inhaltstyp', exact: true }).getByRole('button', { name: 'Quiz', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByRole('status').filter({ hasText: /^Gespeicherter Inhalt$/ })).toBeVisible();
  const currentOutlineEntry = page.getByRole('navigation', { name: 'Kursstruktur bearbeiten', exact: true }).locator('button[aria-current="page"]');
  await expect(currentOutlineEntry).toContainText('1.1');
  await expect(currentOutlineEntry).toContainText(quizTitle);
  // A mounted, normalized quiz must remain clean even when reselected.
  await keyboardActivate(page, currentOutlineEntry);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  const writes: string[] = [];
  page.on('request', entry => {
    const url = new URL(entry.url());
    if (url.origin === origin && url.pathname.startsWith(`/api/courses/${courseId}`) && !['GET', 'HEAD'].includes(entry.method())) {
      writes.push(`${entry.method()} ${url.pathname}`);
    }
  });
  const beforePreview = courseEvidence(courseId);
  expect(beforePreview.attempts).toBe(0);
  expect(beforePreview.progress).toBe(0);
  await form.getByLabel('Neue Frage als', { exact: true }).selectOption('TEXT_INPUT');
  await keyboardActivate(page, form.getByRole('button', { name: 'Neue Frage', exact: true }));
  const question = form.getByRole('textbox', { name: 'Frage', exact: true });
  await expect(question).toBeFocused();
  // Incomplete local edits must not claim success or reach the live-save API.
  await keyboardActivate(page, form.getByRole('button', { name: 'Speichern', exact: true }));
  await expect(form.getByRole('alert')).toHaveText('Frage 1: Der Fragetext fehlt.');
  await expect(form.getByRole('status').filter({ hasText: /^Speichern nicht abgeschlossen$/ })).toBeVisible();
  const questionText = 'Welches Wort ist unsere synthetische Testantwort?';
  await question.fill(questionText);
  await form.getByRole('textbox', { name: 'Richtige Antwort für Frage 1', exact: true }).fill('Lernpfad');
  await expect(form.getByRole('status').filter({ hasText: /^Lokal ungespeichert$/ })).toBeVisible();
  await insideViewport(page, form);

  // Radix tab keyboard activation and Enter in a short-answer rehearsal must
  // never submit the enclosing live-save form (a previous regression).
  await form.getByRole('tab', { name: 'Bearbeiten', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(form.getByRole('tab', { name: 'Vorschau', exact: true })).toHaveAttribute('aria-selected', 'true');
  const localPreview = form.getByRole('region', { name: 'Interaktive Quizvorschau', exact: true });
  await localPreview.getByRole('textbox', { name: 'Vorschauantwort zu Frage 1', exact: true }).fill('Lernpfad');
  await localPreview.getByRole('textbox', { name: 'Vorschauantwort zu Frage 1', exact: true }).press('Enter');
  await expect(localPreview.getByRole('status')).toHaveText('1 von 1 Vorschaufragen beantwortet. Diese Ansicht vergibt kein Ergebnis.');
  await keyboardActivate(page, localPreview.getByRole('button', { name: 'Lösungen anzeigen', exact: true }));
  await expect(localPreview.getByText('Lernpfad', { exact: true })).toBeVisible();
  await keyboardActivate(page, localPreview.getByRole('button', { name: 'Antworten zurücksetzen', exact: true }));
  await expect(localPreview.getByRole('status')).toHaveText('0 von 1 Vorschaufragen beantwortet. Diese Ansicht vergibt kein Ergebnis.');

  const previewTrigger = page.getByRole('button', { name: 'Vorschau', exact: true });
  await keyboardActivate(page, previewTrigger);
  const preview = page.getByRole('dialog', { name: 'Kursvorschau', exact: true });
  await expect(preview.getByRole('status').filter({ hasText: /^Ungespeicherter Entwurf/ })).toBeVisible();
  await expect(preview).toContainText(questionText);
  await preview.getByRole('textbox', { name: 'Vorschauantwort zu Frage 1', exact: true }).fill('Nur in der Vorschau');
  await expect(preview.getByRole('status').filter({ hasText: /^1 von 1 Vorschaufragen/ })).toBeVisible();
  await insideViewport(page, preview);
  await keyboardActivate(page, preview.getByRole('navigation', { name: 'Inhaltsverzeichnis der Vorschau', exact: true }).getByTitle(rootTitle, { exact: true }));
  await expect(preview.getByRole('heading', { name: rootTitle, exact: true })).toBeFocused();
  await expect(preview.getByText('Dieser Lerntext ist gespeichert und sofort sichtbar.', { exact: true })).toBeVisible();
  await keyboardActivate(page, preview.getByRole('button', { name: 'Weiter', exact: true }));
  await expect(preview.getByRole('heading', { name: quizTitle, exact: true })).toBeFocused();
  await expect(preview.getByRole('textbox', { name: 'Vorschauantwort zu Frage 1', exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(previewTrigger).toBeFocused();
  await expect(form.getByRole('status').filter({ hasText: /^Lokal ungespeichert$/ })).toBeVisible();
  expect(writes).toEqual([]);
  expect(courseEvidence(courseId)).toEqual(beforePreview);

  await saveContent(page, courseId, quizId);
  expect(writes).toEqual([`PUT /api/courses/${courseId}/contents/${quizId}`]);
  const savedQuiz = courseEvidence(courseId);
  const storedQuiz = savedQuiz.contents.find(content => content.id === quizId);
  expect(storedQuiz).toMatchObject({ title: quizTitle, parentId: rootId });
  expect(JSON.parse(storedQuiz!.content as string).questions).toEqual([
    expect.objectContaining({ type: 'TEXT_INPUT', question: questionText, correctAnswer: 'Lernpfad' }),
  ]);
  writes.length = 0;

  // Cancel preserves local fields; discarding the same selected row must
  // remount those fields from the server baseline rather than leak the draft.
  const title = form.getByRole('textbox', { name: 'Titel', exact: true });
  await title.fill('Dieser Titel bleibt nur lokal');
  await keyboardActivate(page, currentOutlineEntry);
  const guard = page.getByRole('alertdialog', { name: 'Ungespeicherte Änderungen', exact: true });
  await expect(guard).toBeVisible();
  await keyboardActivate(page, guard.getByRole('button', { name: 'Weiter bearbeiten', exact: true }));
  await expect(title).toHaveValue('Dieser Titel bleibt nur lokal');
  await keyboardActivate(page, currentOutlineEntry);
  await keyboardActivate(page, guard.getByRole('button', { name: 'Änderungen verwerfen', exact: true }));
  await expect(title).toHaveValue(quizTitle);
  await expect(form.getByRole('status').filter({ hasText: /^Gespeicherter Inhalt$/ })).toBeVisible();
  await expect(form.getByRole('textbox', { name: 'Frage', exact: true })).toHaveValue(questionText);

  await title.fill('Auch der Ansichtswechsel verwirft nur lokal');
  await keyboardActivate(page, modes.getByRole('button', { name: 'Lernen', exact: true }));
  await expect(guard).toBeVisible();
  await keyboardActivate(page, guard.getByRole('button', { name: 'Weiter bearbeiten', exact: true }));
  await expect(modes.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(title).toHaveValue('Auch der Ansichtswechsel verwirft nur lokal');
  await keyboardActivate(page, modes.getByRole('button', { name: 'Lernen', exact: true }));
  await keyboardActivate(page, guard.getByRole('button', { name: 'Änderungen verwerfen', exact: true }));
  await expect(modes.getByRole('button', { name: 'Lernen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(form).toHaveCount(0);
  await expect(page.getByText('Lernansicht des gespeicherten Kursinhalts.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: quizTitle, exact: true })).toBeVisible();
  await expect(page.getByText(questionText, { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Kursstruktur bearbeiten', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toHaveCount(0);
  await insideViewport(page, page.getByRole('region', { name: 'Ausgewählter Kursinhalt', exact: true }));
  await keyboardActivate(page, page.getByRole('button', { name: 'Inhaltsverzeichnis schließen', exact: true }));
  await expect(page.getByRole('button', { name: 'Inhaltsverzeichnis öffnen', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await keyboardActivate(page, page.getByRole('button', { name: 'Inhaltsverzeichnis öffnen', exact: true }));
  await expect(page.getByRole('button', { name: 'Inhaltsverzeichnis schließen', exact: true })).toHaveAttribute('aria-expanded', 'true');

  await keyboardActivate(page, modes.getByRole('button', { name: 'Bearbeiten', exact: true }));
  await expect(title).toHaveValue(quizTitle);
  await expect(form.getByRole('status').filter({ hasText: /^Gespeicherter Inhalt$/ })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/courses/${courseId}/contents\\?content=${quizId}$`));
  await expect(title).toHaveValue(quizTitle);
  await expect(form.getByRole('textbox', { name: 'Frage', exact: true })).toHaveValue(questionText);
  await expect(form.getByRole('status').filter({ hasText: /^Gespeicherter Inhalt$/ })).toBeVisible();
  expect(writes).toEqual([]);
  expect(courseEvidence(courseId)).toEqual(savedQuiz);
});
