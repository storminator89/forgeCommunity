import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditor } from '@/components/profile/ProfileEditor';

jest.mock('@/components/profile/ProfileEditForm', () => ({ ProfileEditForm: () => <button>Stammdaten bearbeiten</button> }));
jest.mock('@/components/profile/SocialLinksForm', () => ({ SocialLinksForm: () => <button>Soziale Links bearbeiten</button> }));
jest.mock('@/components/profile/ImageUpload', () => ({ ImageUpload: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const profile = {
  id: 'author', name: 'Ada', title: 'Designerin', bio: 'Hallo', contact: null,
  image: '/images/uploads/avatar.png', coverImage: null, socialLinks: {},
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, url: null }) } as Response));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => jest.restoreAllMocks());

it('presents profile-editing destinations without stacked cards', async () => {
  render(<ProfileEditor profile={profile} onUpdate={jest.fn()} />);
  expect(screen.getByRole('heading', { name: 'Profil verwalten' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stammdaten bearbeiten' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Soziale Links' }));
  expect(screen.getByRole('button', { name: 'Soziale Links bearbeiten' })).toBeInTheDocument();
});

it('persists image removal before updating the visible profile', async () => {
  const onUpdate = jest.fn();
  render(<ProfileEditor profile={profile} onUpdate={onUpdate} />);
  await userEvent.click(screen.getByRole('tab', { name: 'Medien' }));
  await userEvent.click(screen.getByRole('button', { name: 'Profilbild entfernen' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/users/author/upload?type=avatar', { method: 'DELETE', credentials: 'include' }));
  expect(onUpdate).toHaveBeenCalledWith({ image: null });
});
