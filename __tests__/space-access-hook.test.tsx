import '@testing-library/jest-dom';
import { StrictMode, useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSpaceAccess } from '@/hooks/useSpaceAccess';

const json = (text: string, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ text, error: text }) });
type JsonResponse = ReturnType<typeof json>;

function AccessHarness() {
  const [text, setText] = useState('');
  const { request, accessLost, invalidate } = useSpaceAccess(() => setText(''));
  useEffect(() => {
    void request<{ text: string }>('/api/private').then(result => setText(result.text)).catch(() => {});
  }, [request]);
  return <div>
    <p role="status">{accessLost ? 'Access lost' : 'Access active'}</p>
    <output aria-label="Cached snapshot">{text || 'Loading'}</output>
    <button onClick={() => { void request<{ text: string }>('/api/private').then(result => setText(result.text)).catch(() => {}); }}>Read again</button>
    <button onClick={invalidate}>Revoke scope</button>
  </div>;
}

beforeEach(() => { jest.clearAllMocks(); });

test('StrictMode effect replay resumes requests while a pre-cleanup response stays stale', async () => {
  let resolvePreCleanup!: (response: JsonResponse) => void;
  global.fetch = jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolvePreCleanup = resolve; }))
    .mockResolvedValueOnce(json('Current authorized response'))
    .mockResolvedValueOnce(json('Still authorized'));
  render(<StrictMode><AccessHarness /></StrictMode>);
  expect(await screen.findByText('Current authorized response')).toBeVisible();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect((jest.mocked(global.fetch).mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
  await act(async () => { resolvePreCleanup(json('Obsolete private response')); });
  expect(screen.queryByText('Obsolete private response')).not.toBeInTheDocument();
  expect(screen.getByText('Current authorized response')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
  expect(await screen.findByText('Still authorized')).toBeVisible();
});

test.each([403, 404])('a %i denial remains permanent after StrictMode replay and a late pre-cleanup 200', async status => {
  let resolvePreCleanup!: (response: JsonResponse) => void;
  global.fetch = jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolvePreCleanup = resolve; }))
    .mockResolvedValueOnce(json('Private approved content'))
    .mockResolvedValueOnce(json('Permission removed', status));
  const view = render(<StrictMode><AccessHarness /></StrictMode>);
  await screen.findByText('Private approved content');
  fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
  expect(await screen.findByText('Access lost')).toBeVisible();
  expect(screen.queryByText('Private approved content')).not.toBeInTheDocument();
  await act(async () => { resolvePreCleanup(json('Obsolete private response')); });
  view.rerender(<StrictMode><AccessHarness /></StrictMode>);
  fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  expect(screen.getByText('Access lost')).toBeVisible();
  expect(screen.queryByText('Obsolete private response')).not.toBeInTheDocument();
});

test('explicit scope revocation cannot be undone by rerendering a StrictMode viewer', async () => {
  global.fetch = jest.fn().mockResolvedValue(json('Private approved content'));
  const view = render(<StrictMode><AccessHarness /></StrictMode>);
  await screen.findByText('Private approved content');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke scope' }));
  expect(screen.getByText('Access lost')).toBeVisible();
  const readsBefore = jest.mocked(global.fetch).mock.calls.length;
  view.rerender(<StrictMode><AccessHarness /></StrictMode>);
  fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
  await act(async () => {});
  expect(global.fetch).toHaveBeenCalledTimes(readsBefore);
  expect(screen.getByText('Access lost')).toBeVisible();
});
