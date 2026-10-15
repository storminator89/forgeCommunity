import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SkillDirectory from '@/app/skills/page';

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'viewer' } } }) }));

const directory = {
  skills: [{ id: 'skill-1', name: 'TypeScript', category: 'Technik' }, { id: 'skill-2', name: 'Figma', category: 'Design' }],
  members: [
    { id: 'ada', name: 'Ada', avatar: '', title: 'Entwicklerin', endorsements: 2, hasEndorsed: false, skills: [{ skillName: 'TypeScript', level: 80 }] },
    { id: 'bea', name: 'Bea', avatar: '', title: 'Designerin', endorsements: 1, hasEndorsed: false, skills: [{ skillName: 'Figma', level: 90 }] },
  ],
};

beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async (url: string) => url === '/api/skills/directory'
    ? { ok: true, json: async () => directory }
    : { ok: true, json: async () => ({ message: 'Empfohlen' }) });
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
  expect(screen.getByRole('link', { name: 'Bea' })).toBeInTheDocument();
  expect(screen.getByText('2 Ergebnisse')).toBeInTheDocument();
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
