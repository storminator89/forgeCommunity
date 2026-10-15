import { render, screen, waitFor } from '@testing-library/react';
import LegacyProjectDetail from '@/app/projects/[id]test/page';

const mockReplace = jest.fn();
let mockId: string | undefined;
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }), useParams: () => ({ id: mockId }) }));

beforeEach(() => { mockReplace.mockClear(); mockId = undefined; });

it('keeps the legacy handoff pointed at a real project with a visible fallback link', async () => {
  mockId = 'project/one';
  render(<LegacyProjectDetail />);
  expect(await screen.findByRole('heading', { name: 'Projekt wird geöffnet' })).toBeInTheDocument();
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/projects/project%2Fone'));
  expect(screen.getByRole('link', { name: 'Jetzt öffnen' })).toHaveAttribute('href', '/projects/project%2Fone');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
});

it('avoids redirecting to an undefined project when the experimental route has no ID', async () => {
  render(<LegacyProjectDetail />);
  expect(await screen.findByRole('heading', { name: 'Projekt wird geöffnet' })).toBeInTheDocument();
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/showcases'));
  expect(screen.getByRole('link', { name: 'Jetzt öffnen' })).toHaveAttribute('href', '/showcases');
});
