/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunityBookmarksProvider } from '@/components/community/bookmarks/CommunityBookmarksProvider';
import { BookmarkButton } from '@/components/community/bookmarks/BookmarkButton';
import type { CommunityBookmarkTarget } from '@/lib/community-bookmarks';
const target: CommunityBookmarkTarget = { kind: 'post', targetId: 'post' };
const state = (saved = false, revision = 0) => ({ ...target, saved, revision });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(resolvePromise => { resolve = resolvePromise; }); return { promise, resolve }; };
function View({ accountId = 'owner', targets = [target] }: { accountId?: string; targets?: CommunityBookmarkTarget[] }) {
 return <CommunityBookmarksProvider accountId={accountId} targets={targets}><BookmarkButton {...target} /></CommunityBookmarksProvider>;
}
beforeEach(() => { global.fetch = jest.fn(); Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: () => '11111111-1111-4111-8111-111111111111' }); });
afterEach(() => jest.restoreAllMocks());
test('one labelled keyboard/touch button, batched status and explicit confirmed save', async () => {
 jest.mocked(fetch).mockResolvedValueOnce(response({ states: [state()] }) as never).mockResolvedValueOnce(response({ state: state(true, 1) }) as never);
 render(<View />); const button = await screen.findByRole('button', { name: 'Beitrag merken' }); await waitFor(() => expect(button).toBeEnabled());
 button.focus(); expect(button).toHaveFocus(); fireEvent.click(button); await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
 const [, init] = jest.mocked(fetch).mock.calls[1]; expect(init?.method).toBe('PUT'); expect(JSON.parse(init?.body as string)).toEqual({ saved: true, expectedRevision: 0, requestId: '11111111-1111-4111-8111-111111111111' });
 expect(screen.getByText('Gemerkt')).toBeVisible();
});
test('double click while pending sends exactly one mutation', async () => {
 const write = deferred(); jest.mocked(fetch).mockResolvedValueOnce(response({ states: [state()] }) as never).mockReturnValueOnce(write.promise as never);
 render(<View />); const button = screen.getByRole('button'); await waitFor(() => expect(button).toBeEnabled());
 fireEvent.click(button); fireEvent.click(button); expect(fetch).toHaveBeenCalledTimes(2); expect(button).toBeDisabled();
 await act(async () => write.resolve(response({ state: state(true, 1) }))); expect(button).toHaveAttribute('aria-pressed', 'true');
});
test('network uncertainty never paints success or automatically retries write', async () => {
 jest.mocked(fetch).mockResolvedValueOnce(response({ states: [state()] }) as never).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({ states: [state(true, 1)] }) as never);
 render(<View />); await waitFor(() => expect(screen.getByRole('button')).toBeEnabled()); fireEvent.click(screen.getByRole('button'));
 await screen.findByRole('alert'); expect(screen.queryByText('Gemerkt')).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledTimes(2);
 fireEvent.click(screen.getByRole('button', { name: 'Beitrag: Stand erneut laden' })); await screen.findByText('Gemerkt');
 expect(jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
});
test('late old-account fetch cannot paint after account switch', async () => {
 const old = deferred(); jest.mocked(fetch).mockReturnValueOnce(old.promise as never).mockResolvedValueOnce(response({ states: [state()] }) as never);
 const view = render(<View />); view.rerender(<View accountId="other" />); await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
 await act(async () => old.resolve(response({ states: [state(true, 9)] }))); expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
});
test('late old-account mutation cannot paint after account switch', async () => {
 const old = deferred(); jest.mocked(fetch).mockResolvedValueOnce(response({ states: [state()] }) as never).mockReturnValueOnce(old.promise as never).mockResolvedValueOnce(response({ states: [state()] }) as never);
 const view = render(<View />); await waitFor(() => expect(screen.getByRole('button')).toBeEnabled()); fireEvent.click(screen.getByRole('button'));
 view.rerender(<View accountId="other" />); await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
 await act(async () => old.resolve(response({ state: state(true, 1) }))); expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
});
test('state fetch started during write cannot overwrite confirmed newer revision', async () => {
 const write = deferred(), read = deferred();
 jest.mocked(fetch).mockResolvedValueOnce(response({ states: [state()] }) as never).mockReturnValueOnce(write.promise as never).mockReturnValueOnce(read.promise as never);
 const view = render(<View />); await waitFor(() => expect(screen.getByRole('button')).toBeEnabled()); fireEvent.click(screen.getByRole('button'));
 view.rerender(<View targets={[target, { kind: 'comment', targetId: 'new-comment' }]} />);
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
 await act(async () => write.resolve(response({ state: state(true, 1) })));
 await act(async () => read.resolve(response({ states: [state()] })));
 expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
});
test('missing/hidden target shows unavailable and never save success', async () => {
 jest.mocked(fetch).mockResolvedValueOnce(response({ states: [] }) as never); render(<View />);
 const button = await screen.findByRole('button', { name: 'Beitrag nicht verfügbar' }); expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-pressed', 'false');
});
test('409 applies authoritative tombstone and asks user to inspect', async () => {
 jest.mocked(fetch).mockResolvedValueOnce(response({ states: [state(true, 1)] }) as never).mockResolvedValueOnce(response({ state: state(false, 2) }, 409) as never);
 render(<View />); await waitFor(() => expect(screen.getByRole('button')).toBeEnabled()); fireEvent.click(screen.getByRole('button'));
 await screen.findByRole('alert'); expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
});
test('target set chunks at 200 without per-card fetches', async () => {
 jest.mocked(fetch).mockResolvedValue(response({ states: [state()] }) as never);
 render(<View targets={Array.from({ length: 401 }, (_, i) => ({ kind: 'post', targetId: `post${i}` }))} />);
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
 expect(jest.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init?.body as string).targets.length)).toEqual([200, 200, 1]);
});
