import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SkillDirectoryPage from '@/app/skills/page';
import { SearchUrlContext } from '../test-utils/search-url-context';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

function SkillDirectory() { return <SearchUrlContext><SkillDirectoryPage /></SearchUrlContext>; }

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
let mockViewerId: string | null = 'viewer';
let mockSessionStatus: 'loading' | 'authenticated' | 'unauthenticated' = 'authenticated';
jest.mock('next-auth/react', () => ({ useSession: () => ({
  data: mockViewerId ? { user: { id: mockViewerId } } : null,
  status: mockSessionStatus,
}) }));

const directory = {
  skills: [{ id: 'skill-1', name: 'TypeScript', category: 'Technik' }, { id: 'skill-2', name: 'Figma', category: 'Design' }],
  members: [
    { id: 'ada', name: 'Ada', avatar: '', title: 'Entwicklerin', endorsements: 2, hasEndorsed: false, skills: [{ skillName: 'TypeScript', level: 80 }] },
    { id: 'bea', name: 'Bea', avatar: '', title: 'Designerin', endorsements: 1, hasEndorsed: false, skills: [{ skillName: 'Figma', level: 90 }] },
  ],
};

beforeEach(() => {
  window.history.replaceState({}, '', '/skills');
  mockViewerId = 'viewer';
  mockSessionStatus = 'authenticated';
  global.fetch = jest.fn().mockImplementation(async (url: string) => url === '/api/skills/directory'
    ? { ok: true, json: async () => directory }
    : { ok: true, json: async () => ({ message: 'Empfohlen' }) });
});

it('discards viewer-specific endorsements and open details immediately on account switch and logout', async () => {
  mockViewerId = 'alice';
  jest.mocked(global.fetch).mockImplementation(async (url: string | URL | Request) => url === '/api/skills/directory'
    ? { ok: true, json: async () => ({ ...directory, members: directory.members.map(member => ({ ...member, hasEndorsed: mockViewerId === 'alice' })) }) } as Response
    : { ok: true, json: async () => ({ message: 'Empfohlen' }) } as Response);
  const view = render(<SkillDirectory />);
  const aliceRow = (await screen.findByRole('link', { name: 'Ada' })).closest('li');
  expect(within(aliceRow!).getByRole('button', { name: 'Bereits empfohlen' })).toBeDisabled();
  fireEvent.click(within(aliceRow!).getByRole('button', { name: 'Details anzeigen' }));
  expect(screen.getByRole('dialog', { name: 'Ada' })).toBeInTheDocument();

  mockViewerId = 'bob';
  view.rerender(<SkillDirectory />);
  expect(screen.queryByRole('dialog', { name: 'Ada' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
  const bobRow = (await screen.findByRole('link', { name: 'Ada' })).closest('li');
  expect(within(bobRow!).getByRole('button', { name: 'Empfehlen' })).toBeEnabled();

  mockViewerId = null;
  view.rerender(<SkillDirectory />);
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument();
  expect(jest.mocked(global.fetch).mock.calls.filter(([url]) => url === '/api/skills/directory')).toHaveLength(2);
});

it.each(['loading', 'unauthenticated'] as const)('does not reuse a stale account or read directory data while session status is %s', async status => {
  const view = render(<SkillDirectory />);
  await screen.findByRole('link', { name: 'Ada' });
  const reads = jest.mocked(global.fetch).mock.calls.length;
  mockSessionStatus = status;
  view.rerender(<SkillDirectory />);
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Eigene Fähigkeiten ergänzen' })).not.toBeInTheDocument();
  expect(screen.getByText(status === 'loading' ? 'Anmeldung wird geprüft' : 'Anmeldung erforderlich')).toBeInTheDocument();
  expect(jest.mocked(global.fetch).mock.calls).toHaveLength(reads);
});

it('aborts a former viewer request and ignores its late response', async () => {
  mockViewerId = 'alice';
  let finishAlice!: (value: Response) => void;
  const aliceResponse = new Promise<Response>(resolve => { finishAlice = resolve; });
  const signals: AbortSignal[] = [];
  jest.mocked(global.fetch).mockImplementation((url: string | URL | Request, options?: RequestInit) => {
    if (url !== '/api/skills/directory') return Promise.resolve({ ok: true, json: async () => ({ message: 'Empfohlen' }) } as Response);
    signals.push(options!.signal as AbortSignal);
    return mockViewerId === 'alice' ? aliceResponse : Promise.resolve({ ok: true, json: async () => ({ ...directory, members: [directory.members[1]] }) } as Response);
  });
  const view = render(<SkillDirectory />);
  await waitFor(() => expect(signals).toHaveLength(1));
  mockViewerId = 'bob';
  view.rerender(<SkillDirectory />);
  expect(signals[0].aborted).toBe(true);
  expect(await screen.findByRole('link', { name: 'Bea' })).toBeInTheDocument();
  await act(async () => finishAlice({ ok: true, json: async () => directory } as Response));
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
});

it('filters the skill directory and links to member profiles', async () => {
  render(<SkillDirectory />);
  expect(await screen.findByRole('link', { name: 'Ada' })).toHaveAttribute('href', '/profile/ada');
  expect(screen.getByRole('link', { name: 'Bea' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Technik' }));
  expect(screen.getByRole('button', { name: 'Technik' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('link', { name: 'Bea' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Name oder Fähigkeit suchen'), { target: { value: 'ohne Treffer' } });
  expect(screen.getByText('Keine passenden Mitglieder')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(screen.getByLabelText('Name oder Fähigkeit suchen')).toHaveFocus();
  expect(window.location.search).toBe('');
  expect(screen.getByRole('link', { name: 'Bea' })).toBeInTheDocument();
  expect(screen.getByText('2 Ergebnisse')).toBeInTheDocument();
});

it.each(['TypeScript', 'typescript', 'script'])('initializes the directory from the %s URL skill query without losing category filters', async query => {
  window.history.replaceState({}, '', `/skills?query=${encodeURIComponent(query)}&keep=1#directory`);
  render(<SkillDirectory />);
  const input = screen.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen' });
  expect(input).toHaveValue(query);
  expect(await screen.findByRole('link', { name: 'Ada' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Bea' })).not.toBeInTheDocument();
  expect(input).toHaveAttribute('maxlength', '120');
  expect(input).toHaveClass('h-11');
  expect(input.closest('section')).toHaveClass('min-w-0', 'sm:grid-cols-[minmax(0,1fr)_12rem_auto]');

  fireEvent.click(screen.getByRole('button', { name: 'Design' }));
  expect(screen.getByText('Keine passenden Mitglieder')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'Figma' } });
  expect(window.location.search).toBe('?query=Figma&keep=1');
  expect(window.location.hash).toBe('#directory');
  expect(screen.getByRole('button', { name: 'Design' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('link', { name: 'Bea' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
});

it('synchronizes later URL navigation and Back/Forward without replacing input focus or accepting stale router values', async () => {
  window.history.replaceState({}, '', '/skills?query=TypeScript');
  const view = render(<SkillDirectory />);
  await screen.findByRole('link', { name: 'Ada' });
  const input = screen.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen' });
  input.focus();
  fireEvent.change(input, { target: { value: 'Figma' } });
  expect(input).toHaveFocus();
  expect(window.location.search).toBe('?query=Figma');

  act(() => window.history.pushState({}, '', '/skills?query=TypeScript'));
  view.rerender(<SkillDirectory />);
  expect(input).toHaveValue('TypeScript');
  expect(input).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Ada' })).toBeInTheDocument();
  window.history.back();
  await waitFor(() => expect(input).toHaveValue('Figma'));
  expect(screen.getByRole('link', { name: 'Bea' })).toBeInTheDocument();
  window.history.forward();
  await waitFor(() => expect(input).toHaveValue('TypeScript'));
  expect(input).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Ada' })).toBeInTheDocument();
});

it('keeps a shareable query but clears category and viewer-specific details on account change', async () => {
  window.history.replaceState({}, '', '/skills?query=TypeScript');
  const view = render(<SkillDirectory />);
  const row = (await screen.findByRole('link', { name: 'Ada' })).closest('li')!;
  fireEvent.click(screen.getByRole('button', { name: 'Technik' }));
  fireEvent.click(within(row).getByRole('button', { name: 'Details anzeigen' }));
  mockViewerId = 'another-viewer';
  view.rerender(<SkillDirectory />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen' })).toHaveValue('TypeScript');
  await screen.findByRole('link', { name: 'Ada' });
  expect(screen.getByRole('button', { name: 'Alle Kategorien' })).toHaveAttribute('aria-pressed', 'true');
  mockViewerId = null;
  view.rerender(<SkillDirectory />);
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument();
  expect(window.location.search).toBe('?query=TypeScript');
});

it('ignores delayed router search parameters after a newer keystroke', async () => {
  window.history.replaceState({}, '', '/skills?query=TypeScript');
  const view = render(<SearchParamsContext.Provider value={new URLSearchParams('query=TypeScript')}><SkillDirectoryPage /></SearchParamsContext.Provider>);
  await screen.findByRole('link', { name: 'Ada' });
  const input = screen.getByRole('searchbox', { name: 'Name oder Fähigkeit suchen' });
  fireEvent.change(input, { target: { value: 'Figma' } });
  view.rerender(<SearchParamsContext.Provider value={new URLSearchParams('query=Fig')}><SkillDirectoryPage /></SearchParamsContext.Provider>);
  expect(input).toHaveValue('Figma');
  view.rerender(<SearchParamsContext.Provider value={new URLSearchParams('query=Figma')}><SkillDirectoryPage /></SearchParamsContext.Provider>);
  expect(input).toHaveValue('Figma');
  expect(screen.getByRole('link', { name: 'Bea' })).toBeInTheDocument();
});

it('offers a keyboard-accessible own-skills link and removes it at logout', async () => {
  const view = render(<SkillDirectory />);
  await screen.findByRole('link', { name: 'Ada' });
  const link = screen.getByRole('link', { name: 'Eigene Fähigkeiten ergänzen' });
  expect(link).toHaveAttribute('href', '/settings?tab=skills');
  const activate = jest.fn((event: Event) => event.preventDefault());
  link.addEventListener('click', activate);
  link.focus();
  await userEvent.keyboard('{Enter}');
  expect(activate).toHaveBeenCalledTimes(1);
  expect(jest.mocked(global.fetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);

  mockViewerId = null;
  view.rerender(<SkillDirectory />);
  expect(screen.queryByRole('link', { name: 'Eigene Fähigkeiten ergänzen' })).not.toBeInTheDocument();
});

it('shows member details and updates endorsement state after success', async () => {
  render(<SkillDirectory />);
  const ada = await screen.findByRole('link', { name: 'Ada' });
  const row = ada.closest('li');
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByRole('button', { name: 'Details anzeigen' }));
  expect(await screen.findByRole('dialog', { name: 'Ada' })).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Profil öffnen' })).toHaveAttribute('href', '/profile/ada');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Empfehlen' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/members/ada/endorse', expect.objectContaining({ method: 'POST' })));
  expect(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Bereits empfohlen' })).toBeDisabled();
});

it('keeps fetch failures in the shell and offers a retry', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  render(<SkillDirectory />);
  expect(await screen.findByText('Skill-Verzeichnis konnte nicht geladen werden')).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByRole('link', { name: 'Ada' })).toBeInTheDocument();
  errorSpy.mockRestore();
});

it('requires the searched skill itself to match the selected category', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({
    ...directory,
    members: [{ ...directory.members[0], skills: [...directory.members[0].skills, { skillName: 'Figma', level: 30 }] }, directory.members[1]],
  }) } as Response);
  render(<SkillDirectory />);
  await screen.findByRole('link', { name: 'Ada' });
  fireEvent.click(screen.getByRole('button', { name: 'Design' }));
  fireEvent.change(screen.getByLabelText('Name oder Fähigkeit suchen'), { target: { value: 'TypeScript' } });
  expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument();
  expect(screen.getByText('Keine passenden Mitglieder')).toBeInTheDocument();
  // Names can still find a member who has a skill in this category.
  fireEvent.change(screen.getByLabelText('Name oder Fähigkeit suchen'), { target: { value: 'Ada' } });
  expect(screen.getByRole('link', { name: 'Ada' })).toBeInTheDocument();
});

it('discovers actual catalog entries with member counts, including an unused skill', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({
    ...directory, skills: [...directory.skills, { id: 'unused', name: 'Moderation', category: 'Zusammenarbeit' }],
  }) } as Response);
  render(<SkillDirectory />);
  const chip = await screen.findByRole('button', { name: 'TypeScript: 1 Mitglied finden' });
  expect(screen.getByRole('button', { name: 'Moderation: 0 Mitglieder finden' })).toBeInTheDocument();
  chip.focus(); await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('searchbox')).toHaveFocus();
  expect(window.location.search).toBe('?query=TypeScript');
  expect(screen.queryByRole('link', { name: 'Bea' })).not.toBeInTheDocument();
});

it('keeps the own-skills tab addressable across reload-style mounting and real tab history', async () => {
  window.history.replaceState({}, '', '/skills?view=mine&query=TypeScript');
  jest.mocked(fetch).mockImplementation(async url => responseForUrl(String(url)));
  function responseForUrl(url: string) {
    return { ok: true, json: async () => url === '/api/user/skills' ? [] : directory } as Response;
  }
  render(<SkillDirectory />);
  expect(screen.getByRole('tab', { name: 'Meine Fähigkeiten' })).toHaveAttribute('aria-selected', 'true');
  await screen.findByText('Womit kennst du dich aus?');
  await userEvent.click(screen.getByRole('tab', { name: 'Community' }));
  await screen.findByRole('link', { name: 'Ada' });
  expect(window.location.search).toBe('?query=TypeScript');
  window.history.back();
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Meine Fähigkeiten' })).toHaveAttribute('aria-selected', 'true'));
  window.history.forward();
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('TypeScript'));
  expect(jest.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it('keeps owned skills usable when the directory fails and retries the catalog from the workbench', async () => {
  window.history.replaceState({}, '', '/skills?view=mine');
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let directoryReads = 0;
  jest.mocked(fetch).mockImplementation(async url => {
    if (String(url) === '/api/user/skills') return { ok: true, json: async () => [] } as Response;
    if (String(url) === '/api/skills/directory') {
      directoryReads += 1;
      if (directoryReads === 1) throw new Error('offline');
      return { ok: true, json: async () => directory } as Response;
    }
    throw new Error(`Unexpected request: ${String(url)}`);
  });
  try {
    render(<SkillDirectory />);
    await screen.findByText('Womit kennst du dich aus?');
    await waitFor(() => expect(directoryReads).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Fähigkeit hinzufügen', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Aus Verzeichnis' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Verzeichnis nicht verfügbar.');
    expect(screen.getByLabelText('Fähigkeit', { exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    await waitFor(() => expect(directoryReads).toBe(2));
    expect(await screen.findByRole('option', { name: 'Figma' })).toBeInTheDocument();
    expect(screen.getByLabelText('Fähigkeit', { exact: true })).not.toBeDisabled();
  } finally {
    errorSpy.mockRestore();
  }
});
