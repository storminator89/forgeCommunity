import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportControl } from '@/components/community/ReportControl';
import { ModerationQueue } from '@/app/moderation/ModerationQueue';
import { PostCard } from '@/components/community/PostCard';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} {...props}>{children}</a>,
}));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('framer-motion', () => {
  const MotionDiv = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & {
    initial?: unknown; animate?: unknown; exit?: unknown; transition?: unknown; layout?: unknown;
  }>(({ children, initial, animate, exit, transition, layout, ...props }, ref) =>
    <div ref={ref} {...props}>{children}</div>);
  MotionDiv.displayName = 'MotionDiv';
  return {
    motion: { div: MotionDiv },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

beforeEach(() => {
  (global.fetch as jest.Mock).mockReset();
});

it('lets a member report a post with an accessible reason and feedback', async () => {
  const user = userEvent.setup();
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', alreadyReported: false }) });
  render(<ReportControl targetType="POST" targetId="post-1" />);

  await user.click(screen.getByRole('button', { name: 'Beitrag melden' }));
  expect(screen.getByRole('dialog', { name: 'Beitrag melden' })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Grund'), 'HARASSMENT');
  await user.type(screen.getByLabelText(/Hinweis/), 'Harassment directed at a member');
  await user.click(screen.getByRole('button', { name: 'Meldung senden' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ method: 'POST' })));
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    targetType: 'POST', targetId: 'post-1', reason: 'HARASSMENT', details: 'Harassment directed at a member',
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Meldung wurde gespeichert');
  expect(screen.getByRole('button', { name: 'Beitrag melden' })).toBeDisabled();
});

it('shows public-target links and requires a completed action before recording resolution', async () => {
  const user = userEvent.setup();
  const report = {
    id: 'report-1', targetType: 'COMMENT', targetId: 'comment-1', reason: 'UNSAFE', details: 'Threat', status: 'OPEN',
    createdAt: '2026-10-01T10:00:00.000Z', reviewedAt: null, reviewedById: null, resolutionNote: null,
    targetAvailable: true, targetTitle: null, targetPreview: 'Public comment',
  };
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') return { ok: true, json: async () => ({ id: 'report-1', status: 'RESOLVED' }) };
    return { ok: true, json: async () => ({ items: [report], total: 1, page: 1, pageSize: 20 }) };
  });
  render(<ModerationQueue />);

  const target = await screen.findByRole('link', { name: 'Inhalt in der Community öffnen' });
  expect(target).toHaveAttribute('href', '/community#comment-comment-1');
  expect(screen.getByText('Public comment')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Entscheidung'), 'RESOLVED');
  fireEvent.change(screen.getByLabelText('Begründung oder durchgeführte Maßnahme'),
    { target: { value: 'An admin deleted the content' } });
  expect(screen.getByRole('button', { name: 'Entscheidung speichern' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /Ich habe die beschriebene Maßnahme bereits durchgeführt/ }));
  await user.click(screen.getByRole('button', { name: 'Entscheidung speichern' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/reports/report-1', expect.objectContaining({ method: 'PATCH' })));
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(patch![1].body)).toEqual({
    status: 'RESOLVED', resolutionNote: 'An admin deleted the content', actionTaken: true,
  });
});

it('does not link to deleted or unpublished targets', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({
    items: [{ id: 'r2', targetType: 'POST', targetId: 'missing', reason: 'SPAM', details: null, status: 'OPEN',
      createdAt: '2026-10-01T10:00:00.000Z', reviewedAt: null, reviewedById: null, resolutionNote: null,
      targetAvailable: false, targetTitle: null, targetPreview: null }], total: 1, page: 1, pageSize: 20,
  }) });
  render(<ModerationQueue />);
  expect(await screen.findByText('Inhalt ist nicht mehr öffentlich verfügbar.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Inhalt in der Community öffnen' })).not.toBeInTheDocument();
});

it('opens a linked comment and shows separate report controls for another member’s post and comment', async () => {
  window.history.replaceState({}, '', '/community#comment-comment-1');
  Element.prototype.scrollIntoView = jest.fn();
  const post = {
    id: 'post-1', title: 'A post', content: '<p>Visible content</p>', authorId: 'author-1',
    author: { id: 'author-1', name: 'Author', image: null }, createdAt: '2026-10-01T10:00:00.000Z',
    votes: 0, isLiked: false,
    comments: [{ id: 'comment-1', authorId: 'author-2', author: { name: 'Commenter', image: null },
      content: 'Linked comment text', createdAt: '2026-10-01T11:00:00.000Z', votes: 0, isLiked: false }],
  };
  const { rerender } = render(<PostCard post={post} currentUserId="reader-1" onLike={async () => {}} />);
  expect(await screen.findByText('Linked comment text')).toBeInTheDocument();
  expect(document.getElementById('post-post-1')).toBeInTheDocument();
  expect(document.getElementById('comment-comment-1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Beitrag melden' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kommentar melden' })).toBeInTheDocument();
  rerender(<PostCard post={{ ...post, published: false }} currentUserId="reader-1" onLike={async () => {}} />);
  expect(screen.queryByRole('button', { name: 'Beitrag melden' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Kommentar melden' })).not.toBeInTheDocument();
});
