import { randomUUID } from 'node:crypto';
import { isAbsolute, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

function seedPublicChannel(name: string) {
  // Refuse to write fixtures anywhere except this job's explicitly disposable DB.
  const url = process.env.DATABASE_URL;
  const path = url?.startsWith('file:') ? url.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db') {
    throw new Error('Browser QA requires its disposable SQLite fixture database.');
  }
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('INSERT INTO "ChatChannel" ("id", "name", "isPrivate", "createdAt", "updatedAt") VALUES (?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
      .run(randomUUID(), name);
  } finally {
    db.close();
  }
}

test('landing, account, community, members, chat, and notifications work on desktop and mobile', async ({ page, request }, testInfo) => {
  // The job uses a disposable SQLite database. All users, posts and chat data are synthetic.
  const id = randomUUID();
  const email = `browser-qa-${id}@example.test`;
  const password = `BrowserQaA1!${id}`;
  const peerEmail = `browser-qa-peer-${id}@example.test`;
  const peerName = `Browser QA Peer ${id}`;
  const postTitle = `Browser QA post ${id}`;
  const channelName = `Browser QA ${id}`;
  const message = `Browser QA message ${id}`;
  const editedMessage = `Browser QA edited message ${id}`;

  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin },
    data: { name: 'Browser QA Fixture', email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const peerRegistration = await request.post(`${origin}/api/register`, {
    headers: { origin },
    data: { name: peerName, email: peerEmail, password },
  });
  expect(peerRegistration.status(), await peerRegistration.text()).toBe(201);
  seedPublicChannel(channelName);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Wissen teilen/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('landing.png'), fullPage: true });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-content')).toBeFocused();

  await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
  await page.getByRole('link', { name: /Konto erstellen/ }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/register$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  await expect(page.getByRole('heading', { name: 'Community', exact: true })).toBeVisible();

  if (testInfo.project.name.startsWith('mobile-')) {
    const menu = page.getByRole('button', { name: 'Navigation öffnen' });
    await menu.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await page.getByRole('button', { name: 'Navigation schließen' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(menu).toBeFocused();
  }

  const newPost = page.getByRole('button', { name: 'Neuen Beitrag erstellen' });
  await newPost.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Titel' })).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(newPost).toBeVisible();
  await newPost.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Titel' }).fill(postTitle);
  await page.getByRole('textbox', { name: 'Text bearbeiten' }).fill('Synthetic browser QA content.');
  await page.getByRole('button', { name: 'Beitrag veröffentlichen' }).click();
  await expect(page.getByRole('heading', { name: postTitle, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('community-post.png'), fullPage: true });

  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Suche', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-content')).toBeFocused();
  const search = page.getByRole('searchbox', { name: /^Suche nach Kursen/ });
  await search.fill(postTitle);
  await page.getByRole('tab', { name: 'Beiträge' }).click();
  await expect(page.getByRole('heading', { name: postTitle, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('search-result.png'), fullPage: true });

  // Typing replaces the skip-link entry's query; choosing a tab adds a
  // separate entry. Browser Back must restore the query-only All view first.
  await page.goBack();
  await expect(page).toHaveURL(url => url.pathname === '/search' &&
    url.searchParams.get('q') === postTitle && url.searchParams.get('type') === null && url.hash === '#page-content');
  await expect(search).toHaveValue(postTitle);
  await expect(page.getByRole('tab', { name: 'Alle', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(url => url.pathname === '/search' && url.search === '' && url.hash === '');
  await expect(search).toHaveValue('');
  await page.goBack();
  await expect(page).toHaveURL(/\/community$/);
  await page.goForward();
  await expect(page).toHaveURL(url => url.pathname === '/search' && url.search === '' && url.hash === '');
  await expect(search).toHaveValue('');
  await page.goForward();
  await expect(page).toHaveURL(url => url.pathname === '/search' &&
    url.searchParams.get('q') === postTitle && url.searchParams.get('type') === null && url.hash === '#page-content');
  await expect(search).toHaveValue(postTitle);
  await page.goForward();
  await expect(page).toHaveURL(url => url.pathname === '/search' &&
    url.searchParams.get('q') === postTitle && url.searchParams.get('type') === 'post' && url.hash === '#page-content');
  await expect(search).toHaveValue(postTitle);
  await expect(page.getByRole('tab', { name: 'Beiträge' })).toHaveAttribute('aria-selected', 'true');
  await search.focus();
  await expect(search).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Suche löschen' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(search).toBeFocused();

  await page.goto('/members');
  await expect(page.getByRole('heading', { name: 'Mitglieder', exact: true })).toBeVisible();
  const memberSearch = page.getByRole('searchbox', { name: 'Mitglieder suchen' });
  await memberSearch.fill(peerName);
  const peerProfile = page.getByRole('link', { name: `Profil von ${peerName} öffnen` });
  await expect(peerProfile).toBeVisible();
  await page.getByRole('button', { name: 'Listenansicht' }).click();
  await expect(page.getByRole('button', { name: 'Listenansicht' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('members-result.png'), fullPage: true });
  await memberSearch.fill(`No match ${id}`);
  await expect(page.getByRole('heading', { name: 'Keine Mitglieder gefunden' })).toBeVisible();
  await memberSearch.fill(peerName);
  await peerProfile.click();
  await expect(page.getByRole('heading', { name: peerName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Folgen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Folge ich', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Mitglieder', exact: true })).toBeVisible();

  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  if (testInfo.project.name.startsWith('mobile-')) {
    await page.getByRole('button', { name: 'Channels öffnen' }).click();
    await expect(page.getByRole('navigation', { name: 'Chat-Channels' })).toBeVisible();
    await page.getByRole('button', { name: channelName, exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Chat-Channels' })).toBeHidden();
  }
  await expect(page.getByRole('heading', { name: `# ${channelName}`, exact: true })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Nachricht', exact: true });
  await composer.fill(message);
  const sentMessage = page.waitForResponse(response => response.url().endsWith('/api/chat/messages') && response.request().method() === 'POST');
  await composer.press('Enter');
  expect((await sentMessage).status()).toBe(200);
  await expect(composer).toHaveValue('');
  const messageLog = page.getByRole('log', { name: 'Nachrichten' });
  await expect(messageLog.getByText(message, { exact: true })).toBeVisible();
  await messageLog.getByRole('button', { name: 'Nachricht bearbeiten' }).click();
  const edit = page.getByRole('textbox', { name: 'Nachricht bearbeiten' });
  await edit.fill(editedMessage);
  await edit.press('Escape');
  await expect(messageLog.getByText(message, { exact: true })).toBeVisible();
  await messageLog.getByRole('button', { name: 'Nachricht bearbeiten' }).click();
  await page.getByRole('textbox', { name: 'Nachricht bearbeiten' }).fill(editedMessage);
  await page.getByRole('button', { name: 'Änderung speichern' }).click();
  await expect(messageLog.getByText(editedMessage, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chat-message.png'), fullPage: true });

  // The follow action above creates the peer's real notification. Switch users
  // through the UI to verify recipient isolation and notification controls.
  await page.getByRole('button', { name: 'Benutzermenü öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(peerEmail);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);

  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Benachrichtigungen', exact: true })).toBeVisible();
  const notice = page.getByText('Browser QA Fixture folgt Ihnen jetzt', { exact: true });
  const noticeItem = page.locator('article').filter({ has: notice });
  await expect(notice).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('notifications-unread.png'), fullPage: true });
  await page.getByRole('button', { name: /Ungelesen/ }).click();
  await expect(notice).toBeVisible();
  await noticeItem.getByRole('button', { name: 'Als gelesen markieren', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alles gelesen' })).toBeVisible();
  await page.getByRole('button', { name: 'Alle Benachrichtigungen anzeigen' }).click();
  await expect(notice).toBeVisible();
  await noticeItem.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Noch keine Benachrichtigungen' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('notifications-cleared.png'), fullPage: true });
});
