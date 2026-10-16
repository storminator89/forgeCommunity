/** Keep the real browser API payload aligned with the event form's zone contract. */
export function waitlistEventFixture(nonce: string, now = Date.now()) {
  return {
    title: `Waitlist QA ${nonce}`,
    date: new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    startTime: '12:00', endTime: '13:00', timezone: 'Europe/Berlin',
    description: '<p>Disposable waitlist browser fixture.</p>', location: 'Online QA', category: 'Workshop', maxAttendees: 1,
  };
}
