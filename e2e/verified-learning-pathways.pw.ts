import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

function disposableDatabasePath() {
  const url = process.env.DATABASE_URL;
  const path = url?.startsWith('file:') ? url.slice(5) : '';
  if (new URL(origin).origin !== origin || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Pathway browser QA requires a loopback origin and the explicitly disposable SQLite fixture.');
  }
  return path;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function seedPublishedRewardCourses(path: string, instructorId: string, nonce: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const quiz = JSON.stringify({ questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Correct?',
    options: ['yes', 'no'], correctAnswers: [0] }] });
  const result: string[] = [];
  try {
    for (let index = 1; index <= 2; index++) {
      const courseId = `pathway-qa-${nonce}-${index}`;
      const contentId = `quiz-${courseId}`;
      const publicationId = `publication-${courseId}`;
      const title = `QA Lernkurs ${index}`;
      const payload = JSON.stringify({ schemaVersion: 1, contents: [{ id: contentId, parentId: null,
        title: 'Wissenstest', order: 1, type: 'TEXT', content: quiz }] });
      const approval = hash(JSON.stringify([[contentId, hash(JSON.stringify(['TEXT', quiz])), true]]));
      db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "rewardEligible", "rewardApprovalRevision", "updatedAt")
        VALUES (?, ?, 'Synthetischer Browser-Testkurs', ?, 0, 1, ?, CURRENT_TIMESTAMP)`).run(courseId, title, instructorId, approval);
      db.prepare(`INSERT INTO "CourseDraft" ("courseId", "payload", "digest", "updatedAt")
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)`).run(courseId, payload, `qa-${courseId}`);
      db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "type", "updatedAt")
        VALUES (?, 'Wissenstest', ?, 1, ?, 'TEXT', CURRENT_TIMESTAMP)`).run(contentId, quiz, courseId);
      db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
        VALUES (?, ?, 1, 'AUTHOR', ?, ?, 1)`).run(publicationId, courseId, payload, `qa-${courseId}`);
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, courseId);
      result.push(courseId);
    }
  } finally { db.close(); }
  return result;
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

test('admin creates a real private pathway and a member joins it at desktop and 320px', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One disposable journey captures desktop and 320px without creating duplicate pathways.');
  const databasePath = disposableDatabasePath();
  const nonce = randomUUID();
  const adminEmail = `pathway-admin-${nonce}@example.test`;
  const memberEmail = `pathway-member-${nonce}@example.test`;
  const password = `PathwayQA1!${nonce}`;
  const title = `QA Lernpfad ${nonce.slice(0, 8)}`;

  expect((await request.get(`${origin}/api/admin/learning-pathways`)).status()).toBe(401);
  expect((await request.get(`${origin}/api/learning-pathways/me`)).status()).toBe(401);
  const adminRegistration = await request.post(`${origin}/api/register`, { headers: { origin },
    data: { name: 'Pathway QA Administrator', email: adminEmail, password } });
  const memberRegistration = await request.post(`${origin}/api/register`, { headers: { origin },
    data: { name: 'Pathway QA Member', email: memberEmail, password } });
  expect(adminRegistration.status()).toBe(201);
  expect(memberRegistration.status()).toBe(201);
  const adminId = (await adminRegistration.json() as { userId: string }).userId;
  const db = new DatabaseSync(databasePath);
  try { db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('ADMIN', adminId); }
  finally { db.close(); }
  const courseIds = seedPublishedRewardCourses(databasePath, adminId, nonce);

  await login(page, adminEmail, password);
  await page.goto('/admin/learning-pathways');
  await expect(page.getByRole('heading', { name: 'Lernpfade verwalten' })).toBeVisible();
  await expect(page.getByText('Noch keine Lernpfade erstellt. Der erste kann links zusammengestellt werden.')).toBeVisible();
  await expect(page.getByLabel('QA Lernkurs 1')).toBeVisible();
  await expect(page.getByLabel('QA Lernkurs 2')).toBeVisible();
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Beschreibung').fill('Zwei aktuelle Kurse für den privaten Lernweg.');
  await page.getByLabel('Name des privaten Abzeichens').fill('QA Lernweg abgeschlossen');
  for (const name of ['QA Lernkurs 1', 'QA Lernkurs 2']) {
    await page.getByLabel(name).focus();
    await page.keyboard.press('Space');
  }
  await page.getByRole('button', { name: 'QA Lernkurs 2 nach oben' }).click();
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/learning-pathways' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Lernpfad erstellen' }).click();
  const created = await creation;
  expect(created.status(), await created.text()).toBe(201);
  const pathway = (await created.json() as { pathway: { id: string; courses: Array<{ courseId: string }> } }).pathway;
  expect(pathway.courses.map(course => course.courseId)).toEqual([...courseIds].reverse());
  await expect(page.getByText(`„${title}“ wurde erstellt.`)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: testInfo.outputPath('verified-pathways-admin-desktop.png'), fullPage: true, animations: 'disabled' });

  const memberContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  try {
    const member = await memberContext.newPage();
    await login(member, memberEmail, password);
    expect((await memberContext.request.get(`${origin}/api/admin/learning-pathways`)).status()).toBe(403);
    expect((await memberContext.request.post(`${origin}/api/learning-pathways/missing/participation`, { headers: { origin } })).status()).toBe(404);
    await member.goto('/courses/pathways');
    await expect(member.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    await member.evaluate(async () => { await document.fonts.ready; });
    await member.screenshot({ path: testInfo.outputPath('verified-pathways-list-desktop.png'), fullPage: true, animations: 'disabled' });
    await member.getByRole('link', { name: new RegExp(title) }).focus();
    await member.keyboard.press('Enter');
    await expect(member).toHaveURL(`${origin}/courses/pathways/${pathway.id}`);
    await expect(member.getByRole('button', { name: 'Privat teilnehmen' })).toBeVisible();
    await expect(member.getByText('Niemand sieht hier eine Liste von Teilnehmenden.')).toBeVisible();
    await member.getByRole('button', { name: 'Privat teilnehmen' }).click();
    await expect(member.getByRole('heading', { name: 'In Arbeit' })).toBeFocused();
    const mine = await memberContext.request.get(`${origin}/api/learning-pathways/me`);
    expect(mine.status()).toBe(200);
    const saved = (await mine.json() as { pathways: Array<{ id: string; participation: { badgeActive: boolean; optedOutAt: string | null }; creditedCount: number }> }).pathways.find(row => row.id === pathway.id);
    expect(saved).toMatchObject({ creditedCount: 0, participation: { badgeActive: false, optedOutAt: null } });
    await member.setViewportSize({ width: 320, height: 700 });
    await expect(member.getByRole('heading', { name: title })).toBeVisible();
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await member.evaluate(async () => { await document.fonts.ready; });
    await member.screenshot({ path: testInfo.outputPath('verified-pathways-detail-320.png'), fullPage: true, animations: 'disabled' });
    const courseJoin = member.waitForResponse(response => new URL(response.url()).pathname === `/api/courses/${courseIds[0]}/enrollment` && response.request().method() === 'POST');
    await member.getByRole('button', { name: 'Kurs beitreten: QA Lernkurs 1' }).click();
    expect((await courseJoin).status()).toBe(201);
    await expect(member).toHaveURL(`${origin}/courses/${courseIds[0]}/contents`);
    await expect(member.getByText('QA Lernkurs 1').first()).toBeVisible();
    await member.goto(`/courses/pathways/${pathway.id}`);
    await expect(member.getByRole('link', { name: 'Kurs öffnen' })).toHaveAttribute('href', `/courses/${courseIds[0]}/contents`);
    await member.getByRole('button', { name: 'Teilnahme beenden' }).click();
    await member.keyboard.press('Escape');
    await expect(member.getByRole('alertdialog')).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Teilnahme beenden' })).toBeFocused();
  } finally { await memberContext.close(); }
});
