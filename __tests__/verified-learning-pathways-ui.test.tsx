import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '@/lib/sites-auth/react';
import PathwaysClient from '@/app/courses/pathways/PathwaysClient';
import LearningPathwaysAdmin from '@/app/admin/learning-pathways/LearningPathwaysAdmin';
import type { MemberPathway } from '@/app/courses/pathways/pathway-types';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

const session = (id: string, role = 'USER') => ({ data: { user: { id, role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>);
const pathway = (overrides: Partial<MemberPathway> = {}): MemberPathway => ({
  id: 'path-1', title: 'Sicher zusammenarbeiten', description: 'Zwei Kurse für gute Zusammenarbeit.', badgeLabel: 'Zusammenarbeit vertieft',
  courses: [{ courseId: 'course-1', title: 'Erster Kurs', order: 0, creditActive: false, available: true, isEnrolled: false },
    { courseId: 'course-2', title: 'Zweiter Kurs', order: 1, creditActive: false, available: true, isEnrolled: false }],
  unavailable: false, participation: null, creditedCount: 0, requiredCount: 2, history: [], ...overrides,
});
const reply = (body: unknown, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue(session('alice'));
});

test.each(['ADMIN', 'INSTRUCTOR', 'MODERATOR'])('%s sees an access explanation on a direct learner URL without fetching', role => {
  jest.mocked(useSession).mockReturnValue(session('viewer', role));
  global.fetch = jest.fn() as jest.Mock;
  render(<PathwaysClient pathwayId="path-1" />);
  expect(screen.getByRole('heading', { name: 'Kein Zugriff auf Lernpfade' })).toBeVisible();
  expect(screen.getByText(/nur für reguläre Mitglieder verfügbar/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Erneut laden' })).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a server 403 for a stale or test-account session explains access without a retry loop', async () => {
  global.fetch = jest.fn(async () => reply({ error: 'Forbidden' }, false, 403)) as jest.Mock;
  render(<PathwaysClient pathwayId="path-1" />);
  expect(await screen.findByRole('heading', { name: 'Kein Zugriff auf Lernpfade' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Kurse ansehen' })).toHaveAttribute('href', '/courses');
  expect(screen.queryByRole('button', { name: 'Erneut laden' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stand prüfen' })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a later server 403 clears previously shown private pathways', async () => {
  const user = userEvent.setup();
  let reads = 0;
  global.fetch = jest.fn(async () => ++reads === 1 ? reply({ pathways: [pathway()] }) : reply({ error: 'Forbidden' }, false, 403)) as jest.Mock;
  render(<PathwaysClient />);
  expect(await screen.findByText('Sicher zusammenarbeiten')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Stand prüfen' }));
  expect(await screen.findByRole('heading', { name: 'Kein Zugriff auf Lernpfade' })).toBeVisible();
  expect(screen.queryByText('Sicher zusammenarbeiten')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stand prüfen' })).not.toBeInTheDocument();
});

test('member can discover, join, cancel opt-out, and opt out with focus restored', async () => {
  const user = userEvent.setup();
  let stored = pathway();
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      stored = pathway({ participation: { joinedAt: '2026-10-15T08:00:00.000Z', optedOutAt: null, badgeActive: false, badgeFirstAwardedAt: null } });
      return reply({ pathway: stored });
    }
    if (init?.method === 'DELETE') {
      stored = pathway({ participation: { joinedAt: '2026-10-15T08:00:00.000Z', optedOutAt: '2026-10-16T08:00:00.000Z', badgeActive: false, badgeFirstAwardedAt: null } });
      return reply({ pathway: stored });
    }
    return reply({ pathways: [stored] });
  }) as jest.Mock;

  const view = render(<PathwaysClient />);
  expect(await screen.findByRole('link', { name: /Sicher zusammenarbeiten/ })).toHaveAttribute('href', '/courses/pathways/path-1');
  view.rerender(<PathwaysClient pathwayId="path-1" />);
  expect(await screen.findByRole('button', { name: 'Privat teilnehmen' })).toBeVisible();
  expect(screen.getByText(/Niemand sieht hier eine Liste/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Privat teilnehmen' }));
  expect(await screen.findByRole('button', { name: 'Teilnahme beenden' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'In Arbeit' })).toHaveFocus());
  expect(global.fetch).toHaveBeenCalledWith('/api/learning-pathways/path-1/participation', expect.objectContaining({ method: 'POST' }));

  await user.click(screen.getByRole('button', { name: 'Teilnahme beenden' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Teilnahme beenden' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Teilnahme beenden' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Weiter teilnehmen' }));
  expect(global.fetch).not.toHaveBeenCalledWith('/api/learning-pathways/path-1/participation', expect.objectContaining({ method: 'DELETE' }));
  await user.click(screen.getByRole('button', { name: 'Teilnahme beenden' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Teilnahme beenden' }));
  expect(await screen.findByRole('button', { name: 'Erneut privat teilnehmen' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Erneut privat teilnehmen' })).toHaveFocus());
});

test('a revoked private achievement explains revalidation without exposing a public badge', async () => {
  const revoked = pathway({ creditedCount: 1,
    participation: { joinedAt: '2026-10-01T08:00:00.000Z', optedOutAt: null, badgeActive: false, badgeFirstAwardedAt: '2026-10-10T08:00:00.000Z' },
    history: [{ type: 'AWARDED', reason: null, at: '2026-10-10T08:00:00.000Z' },
      { type: 'REVOKED', reason: 'REWARD_INVALIDATED', at: '2026-10-15T08:00:00.000Z' }],
  });
  global.fetch = jest.fn(async () => reply({ pathways: [revoked] })) as jest.Mock;
  render(<PathwaysClient pathwayId="path-1" />);
  expect(await screen.findByRole('heading', { name: 'Erneute Bestätigung nötig' })).toBeVisible();
  expect(screen.getByText('Abzeichen derzeit nicht aktiv')).toBeVisible();
  expect(screen.getAllByText('Eine Kursfreigabe oder ein Kursabschluss ist nicht mehr aktuell.').length).toBeGreaterThan(0);
  expect(screen.queryByText(/Privates Abzeichen aktiv/)).not.toBeInTheDocument();
});

test('rejoining does not show an old opt-out explanation as the current learning state', async () => {
  const rejoined = pathway({ creditedCount: 1,
    participation: { joinedAt: '2026-10-16T08:00:00.000Z', optedOutAt: null, badgeActive: false,
      badgeFirstAwardedAt: '2026-10-10T08:00:00.000Z' },
    history: [{ type: 'REVOKED', reason: 'OPTED_OUT', at: '2026-10-15T08:00:00.000Z' }],
  });
  global.fetch = jest.fn(async () => reply({ pathways: [rejoined] })) as jest.Mock;
  render(<PathwaysClient pathwayId="path-1" />);
  expect(await screen.findByRole('heading', { name: 'In Arbeit' })).toBeVisible();
  expect(screen.queryByText('Du hast deine Teilnahme beendet.')).not.toBeInTheDocument();
  expect(screen.queryByText('Abzeichen derzeit nicht aktiv')).not.toBeInTheDocument();
});

test('a previous account response cannot reveal its pathways after session switch or logout', async () => {
  let resolveAlice!: (result: ReturnType<typeof reply>) => void;
  const aliceRead = new Promise<ReturnType<typeof reply>>(resolve => { resolveAlice = resolve; });
  let reads = 0;
  global.fetch = jest.fn(async () => ++reads === 1 ? aliceRead : reply({ pathways: [] })) as jest.Mock;
  const view = render(<PathwaysClient />);
  jest.mocked(useSession).mockReturnValue(session('bob'));
  view.rerender(<PathwaysClient />);
  expect(await screen.findByText('Noch keine Lernpfade verfügbar')).toBeVisible();
  await act(async () => { resolveAlice(reply({ pathways: [pathway()] })); await aliceRead; });
  expect(screen.queryByText('Sicher zusammenarbeiten')).not.toBeInTheDocument();
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() } as ReturnType<typeof useSession>);
  view.rerender(<PathwaysClient />);
  expect(screen.getByText('Melde dich an, um deine privaten Lernpfade zu sehen.')).toBeVisible();
});

test('course slot explicitly enrolls before opening, and shows a full-course error without claiming progress', async () => {
  const user = userEvent.setup();
  let full = true;
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return full ? reply({ error: 'Course is full' }, false, 409) : reply({ isEnrolled: true }, true, 201);
    return reply({ pathways: [pathway()] });
  }) as jest.Mock;
  render(<PathwaysClient pathwayId="path-1" />);
  const enroll = await screen.findByRole('button', { name: 'Kurs beitreten: Erster Kurs' });
  expect(screen.queryByRole('link', { name: 'Kurs öffnen' })).not.toBeInTheDocument();
  await user.click(enroll);
  expect(await screen.findByText('Dieser Kurs ist derzeit ausgebucht. Bitte versuche es später erneut.')).toBeVisible();
  expect(mockPush).not.toHaveBeenCalled();
  full = false;
  await user.click(enroll);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/courses/course-1/contents'));
  expect(screen.getByRole('link', { name: 'Kurs öffnen' })).toHaveAttribute('href', '/courses/course-1/contents');
});

test('unavailable participant pathway keeps history and opt-out but removes dead links and rejoin', async () => {
  global.fetch = jest.fn(async () => reply({ pathways: [pathway({ unavailable: true,
    courses: [{ courseId: 'course-1', title: 'Erster Kurs', order: 0, creditActive: false, available: false, isEnrolled: false },
      { courseId: 'course-2', title: 'Zweiter Kurs', order: 1, creditActive: false, available: true, isEnrolled: false }],
    participation: { joinedAt: '2026-10-14T08:00:00.000Z', optedOutAt: '2026-10-15T08:00:00.000Z', badgeActive: false, badgeFirstAwardedAt: null },
  })] })) as jest.Mock;
  render(<PathwaysClient pathwayId="path-1" />);
  expect(await screen.findByRole('heading', { name: 'Nicht mehr verfügbar' })).toBeVisible();
  expect(screen.getByText('Kurs nicht mehr verfügbar')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Kurs öffnen' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Erneut privat teilnehmen' })).not.toBeInTheDocument();
  expect(screen.getByText('Eine neue Teilnahme ist derzeit nicht möglich.')).toBeVisible();
});

test('opt-out dialog does not promise immediate rejoin while a pathway is unavailable', async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn(async () => reply({ pathways: [pathway({ unavailable: true,
    courses: [{ courseId: 'course-1', title: 'Erster Kurs', order: 0, creditActive: false, available: false, isEnrolled: false },
      { courseId: 'course-2', title: 'Zweiter Kurs', order: 1, creditActive: false, available: true, isEnrolled: false }],
    participation: { joinedAt: '2026-10-14T08:00:00.000Z', optedOutAt: null, badgeActive: false, badgeFirstAwardedAt: null },
  })] })) as jest.Mock;
  render(<PathwaysClient pathwayId="path-1" />);
  await user.click(await screen.findByRole('button', { name: 'Teilnahme beenden' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText(/Eine erneute Teilnahme ist derzeit nicht möglich, da mindestens ein Kurs entfernt oder unveröffentlicht ist/)).toBeVisible();
  expect(within(dialog).queryByText(/Du kannst später erneut teilnehmen/)).not.toBeInTheDocument();
});

test('admin sees only approved free courses and submits selected order', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  const user = userEvent.setup();
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return reply({ pathway: { id: 'new-path', title: 'Sicher lernen', description: 'Gemeinsam lernen', badgeLabel: 'Lernen vertieft',
      courses: [{ courseId: 'c2', title: 'Beta', order: 0 }, { courseId: 'c1', title: 'Alpha', order: 1 }], createdAt: '2026-10-15T08:00:00.000Z' } });
    if (url === '/api/courses') return reply([
      { id: 'c1', title: 'Alpha', rewardEligible: true, price: null },
      { id: 'c2', title: 'Beta', rewardEligible: true, price: 0 },
      { id: 'c3', title: 'Bezahlt', rewardEligible: true, price: 10 },
      { id: 'c4', title: 'Nicht freigegeben', rewardEligible: false, price: 0 },
    ]);
    return reply({ pathways: [] });
  }) as jest.Mock;
  render(<LearningPathwaysAdmin />);
  expect(await screen.findByText('Noch keine Lernpfade erstellt. Der erste kann links zusammengestellt werden.')).toBeVisible();
  expect(screen.getByLabelText('Alpha')).toBeVisible();
  expect(screen.getByLabelText('Beta')).toBeVisible();
  expect(screen.queryByLabelText('Bezahlt')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Nicht freigegeben')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Titel'), 'Sicher lernen');
  await user.type(screen.getByLabelText('Beschreibung'), 'Gemeinsam lernen');
  await user.type(screen.getByLabelText('Name des privaten Abzeichens'), 'Lernen vertieft');
  await user.click(screen.getByLabelText('Alpha'));
  await user.click(screen.getByLabelText('Beta'));
  await user.click(screen.getByRole('button', { name: 'Beta nach oben' }));
  await user.click(screen.getByRole('button', { name: 'Lernpfad erstellen' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/learning-pathways', expect.objectContaining({ method: 'POST' })));
  const submitCall = jest.mocked(global.fetch).mock.calls.find(([url, init]) => url === '/api/admin/learning-pathways' && init?.method === 'POST');
  expect(JSON.parse(String(submitCall?.[1]?.body))).toMatchObject({
    title: 'Sicher lernen', description: 'Gemeinsam lernen', badgeLabel: 'Lernen vertieft', courseIds: ['c2', 'c1'],
    requestId: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9-]{27,}$/),
  });
  expect(screen.getByText('„Sicher lernen“ wurde erstellt.')).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveFocus());
  expect(screen.getByLabelText('Beschreibung')).toHaveAttribute('maxLength', '500');
  expect(screen.getByLabelText('Name des privaten Abzeichens')).toHaveAttribute('maxLength', '80');
});

test('admin retry reuses the request ID until the draft changes', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  const user = userEvent.setup();
  let posts = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      if (posts < 3) throw new Error('Verbindung unterbrochen');
      return reply({ pathway: { id: 'path-new', title: 'Neuer Lernpfad', description: 'Zwei Kurse',
        badgeLabel: 'Privates Abzeichen', courses: [], createdAt: '2026-10-15T08:00:00.000Z' } });
    }
    if (url === '/api/courses') return reply([
      { id: 'c1', title: 'Alpha', rewardEligible: true, price: 0 },
      { id: 'c2', title: 'Beta', rewardEligible: true, price: 0 },
    ]);
    return reply({ pathways: [] });
  }) as jest.Mock;
  render(<LearningPathwaysAdmin />);
  await screen.findByLabelText('Alpha');
  await user.type(screen.getByLabelText('Titel'), 'Erster Lernpfad');
  await user.type(screen.getByLabelText('Beschreibung'), 'Zwei Kurse');
  await user.type(screen.getByLabelText('Name des privaten Abzeichens'), 'Privates Abzeichen');
  await user.click(screen.getByLabelText('Alpha'));
  await user.click(screen.getByLabelText('Beta'));
  const submit = screen.getByRole('button', { name: 'Lernpfad erstellen' });
  await user.click(submit);
  await screen.findByText('Verbindung unterbrochen');
  await user.click(submit);
  await screen.findByText('Verbindung unterbrochen');
  await user.clear(screen.getByLabelText('Titel'));
  await user.type(screen.getByLabelText('Titel'), 'Neuer Lernpfad');
  await user.click(submit);
  await screen.findByText('„Neuer Lernpfad“ wurde erstellt.');
  const bodies = jest.mocked(global.fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as { requestId: string });
  expect(bodies).toHaveLength(3);
  expect(bodies[0].requestId).toBe(bodies[1].requestId);
  expect(bodies[2].requestId).not.toBe(bodies[1].requestId);
});
