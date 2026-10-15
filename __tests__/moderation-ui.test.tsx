import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
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
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
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
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', role: 'MODERATOR' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
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

it('offers a retry when the moderation queue cannot load', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Meldungen sind nicht erreichbar' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }) });

  render(<ModerationQueue />);
  expect(await screen.findByText('Meldungen sind nicht erreichbar')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByText('Keine Meldungen in diesem Status.')).toBeInTheDocument();
  expect(screen.queryByText('Meldungen sind nicht erreichbar')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('clears Alice’s report details and review form before Bob or logout can see them', async () => {
  const privateReport = {
    id: 'private-report', targetType: 'POST', targetId: 'post-1', reason: 'UNSAFE', details: 'Alice private report', status: 'OPEN',
    createdAt: '2026-10-01T10:00:00.000Z', reviewedAt: null, reviewedById: null, resolutionNote: null,
    targetAvailable: false, targetTitle: null, targetPreview: null,
  };
  let viewer = 'alice';
  (global.fetch as jest.Mock).mockImplementation(async () => viewer === 'alice'
    ? { ok: true, json: async () => ({ items: [privateReport], total: 1, page: 1, pageSize: 20 }) }
    : { ok: false, json: async () => ({ error: 'Keine Berechtigung' }) });

  const view = render(<ModerationQueue />);
  expect(await screen.findByText('Alice private report')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Entscheidung speichern' })).toBeInTheDocument();

  viewer = 'bob';
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'bob', role: 'USER' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  view.rerender(<ModerationQueue />);
  expect(screen.queryByText('Alice private report')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Entscheidung speichern' })).not.toBeInTheDocument();
  expect(await screen.findByText('Keine Berechtigung')).toBeInTheDocument();

  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() } as ReturnType<typeof useSession>);
  view.rerender(<ModerationQueue />);
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument();
  expect(screen.queryByText('Alice private report')).not.toBeInTheDocument();
});

it.each(['ADMIN', 'MODERATOR'])('clears private queue state when the same %s loses their role', async (role) => {
  const privateReport = {
    id: 'private-report', targetType: 'POST', targetId: 'post-1', reason: 'UNSAFE', details: 'Private report details', status: 'OPEN',
    createdAt: '2026-10-01T10:00:00.000Z', reviewedAt: null, reviewedById: null, resolutionNote: null,
    targetAvailable: false, targetTitle: null, targetPreview: null,
  };
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', role }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  const fetchMock = global.fetch as jest.Mock;
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [privateReport], total: 1, page: 1, pageSize: 20 }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Keine Berechtigung' }) });

  const view = render(<ModerationQueue />);
  expect(await screen.findByText('Private report details')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Begründung oder durchgeführte Maßnahme'),
    { target: { value: 'Private unfinished review' } });
  const oldReviewForm = screen.getByRole('button', { name: 'Entscheidung speichern' }).closest('form')!;

  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', role: 'USER' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  view.rerender(<ModerationQueue />);

  expect(screen.queryByText('Private report details')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Private unfinished review')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Entscheidung speichern' })).not.toBeInTheDocument();
  fireEvent.submit(oldReviewForm);
  expect(await screen.findByText('Keine Berechtigung')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
});

it.each(['ADMIN', 'MODERATOR'])('ignores an old privileged response after the same %s loses their role', async (role) => {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', role }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  let finishOldRequest!: (response: unknown) => void;
  const oldRequest = new Promise((resolve) => { finishOldRequest = resolve; });
  const fetchMock = global.fetch as jest.Mock;
  fetchMock
    .mockReturnValueOnce(oldRequest)
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Keine Berechtigung' }) });
  const view = render(<ModerationQueue />);
  const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;

  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', role: 'USER' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  view.rerender(<ModerationQueue />);
  expect(oldSignal.aborted).toBe(true);
  expect(await screen.findByText('Keine Berechtigung')).toBeInTheDocument();

  await act(async () => {
    finishOldRequest({ ok: true, json: async () => ({
      items: [{ id: 'old-report', targetType: 'POST', targetId: 'post-1', reason: 'SPAM',
        details: 'Late private report', status: 'OPEN', createdAt: '2026-10-01T10:00:00.000Z',
        reviewedAt: null, reviewedById: null, resolutionNote: null, targetAvailable: false,
        targetTitle: null, targetPreview: null }], total: 1, page: 1, pageSize: 20,
    }) });
    await oldRequest;
  });

  expect(screen.queryByText('Late private report')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Entscheidung speichern' })).not.toBeInTheDocument();
  expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument();
});

it('leaves authorization to the server when the client session role is stale', async () => {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', role: 'USER' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({
    items: [], total: 0, page: 1, pageSize: 20,
  }) });
  render(<ModerationQueue />);
  expect(await screen.findByText('Keine Meldungen in diesem Status.')).toBeInTheDocument();
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
