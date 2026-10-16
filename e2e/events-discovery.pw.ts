import { randomUUID } from 'node:crypto';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { expect, test } from '@playwright/test';

// Exercise event-zone rendering from a browser on a different calendar day.
test.use({ timezoneId: 'America/Los_Angeles' });

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';

test('future events are discoverable, searchable, and keyboard accessible across calendar months', async ({ page, request }, testInfo) => {
  // Run through the existing CI workflow and its disposable account database.
  // Event responses are synthetic browser fixtures; no real events are changed.
  expect(process.env.BROWSER_QA_DISPOSABLE_DB).toBe('1');
  const id = randomUUID();
  const email = `events-browser-qa-${id}@example.test`;
  const password = `EventsBrowserQaA1!${id}`;
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin },
    data: { name: 'Events Browser QA Fixture', email, password },
  });
  expect(registration.status(), await registration.text()).toBe(201);

  const now = new Date();
  const eventFixture = (offset: number, title: string, category: string) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 12, 12);
    return {
      id: `event-${offset}`, title, date: date.toISOString(), category,
      description: '<p>Synthetic event details.</p>', location: 'Online Community',
      startTime: '12:00', endTime: '13:00', timezone: 'Europe/Berlin',
      maxAttendees: null, attendeeCount: 0, isAttending: false, canCancelRsvp: false,
    };
  };
  const nextMonth = eventFixture(1, 'Nächster Workshop', 'Workshop');
  const nextYear = eventFixture(14, 'Jahrestreffen', 'Seminar');
  let events = [eventFixture(16, 'Vierter Termin', 'Workshop'), nextYear, eventFixture(15, 'Dritter Termin', 'Workshop'), nextMonth];
  await page.route('**/api/events', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) });
  });
  // Discovery uses synthetic event IDs. Their lazy authenticated RSVP reads
  // need matching complete caller states, rather than real missing-ID 404s.
  // This fixture never intercepts or permits a participation mutation.
  await page.route('**/api/events/*/rsvp', async route => {
    expect(route.request().method()).toBe('GET');
    const eventId = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
    const event = events.find(item => item.id === eventId);
    if (!event) {
      await route.fulfill({ status: 404, json: { error: 'Synthetic event not found' } });
      return;
    }
    await route.fulfill({ json: {
      registrationState: 'NONE', isAttending: false, isWaitlisted: false,
      canCancelRsvp: false, canLeaveWaitlist: false,
      attendeeCount: event.attendeeCount, maxAttendees: event.maxAttendees,
      waitlistCount: 0, waitlistPosition: null,
      registrationClosed: new Date(event.date).getTime() <= Date.now(),
    } });
  });

  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  await page.goto('/events');
  const browserMonth = await page.evaluate(() => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date()));

  const upcoming = page.getByRole('region', { name: 'Nächste Events' });
  await expect(upcoming).toBeVisible();
  await expect(upcoming.getByText('3 von 4 Events ab heute')).toBeVisible();
  await expect(upcoming.getByRole('button', { name: /^Details öffnen:/ })).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Monatskalender' }).getByRole('heading', {
    name: browserMonth,
  })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('events-upcoming.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const preview = upcoming.getByRole('button', { name: /^Details öffnen: Jahrestreffen/ });
  await preview.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Jahrestreffen', exact: true })).toBeVisible();
  await expect(page.locator('#event-event-14')).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Teilnehmen' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();
  await expect(page.getByRole('region', { name: 'Monatskalender' }).getByRole('heading', {
    name: format(new Date(nextYear.date), 'MMMM yyyy', { locale: de }),
  })).toBeVisible();
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(preview).toBeFocused();

  const search = page.getByRole('searchbox', { name: 'Events durchsuchen' });
  await search.fill('Seminar');
  await expect(upcoming.getByRole('button', { name: /^Details öffnen:/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
  await expect(search).toHaveValue('Seminar');
  await search.fill('No matching fixture');
  await expect(upcoming.getByRole('status')).toHaveText('Keine passenden Events ab heute gefunden.');
  await page.getByRole('button', { name: 'Eventsuche löschen' }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(upcoming.getByRole('button', { name: /^Details öffnen:/ })).toHaveCount(3);

  await upcoming.getByRole('button', { name: 'Alle in der Liste ansehen' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Listenansicht' })).toBeFocused();
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Vierter Termin' })).toBeVisible();
  await page.getByRole('button', { name: 'Woche', exact: true }).click();
  await expect(upcoming).toBeVisible();
  await expect(page.getByRole('region', { name: 'Wochenkalender' })).toBeVisible();

  const eventYear = now.getFullYear() + 1;
  events = [{ ...nextMonth, id: 'tokyo-midnight', title: 'Tokio nach Mitternacht',
    date: `${eventYear}-01-01T00:30:00+09:00`, timezone: 'Asia/Tokyo', startTime: '00:30', endTime: '01:30' }];
  await page.reload();
  const tokyoPreview = upcoming.getByRole('button', { name: `Details öffnen: Tokio nach Mitternacht, 01. Januar ${eventYear}` });
  await expect(tokyoPreview).toContainText(`01. Jan. ${eventYear} · 00:30 (Asia/Tokyo)`);
  await tokyoPreview.click();
  await expect(dialog.getByRole('heading', { name: `01. Januar ${eventYear}`, exact: true })).toBeVisible();
  await expect(dialog.getByText('00:30 - 01:30 (Asia/Tokyo)', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const eventDay = format(new Date(eventYear, 0, 1, 12), 'EEEE, dd. MMMM yyyy', { locale: de });
  await expect(page.getByRole('button', { name: `${eventDay}, 1 Event`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Woche', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Wochenkalender' }).getByRole('button', { name: `${eventDay}, 1 Event`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await expect(page.getByText(`01. Jan. ${eventYear}, 00:30 - 01:30 (Asia/Tokyo)`, { exact: true })).toBeVisible();

  events = [];
  await page.reload();
  await expect(upcoming.getByRole('status')).toHaveText('Keine Events ab heute geplant.');
  await expect(upcoming.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Monatskalender' })).toBeVisible();
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await expect(page.getByText('Keine zukünftigen Events gefunden.')).toBeVisible();
});
