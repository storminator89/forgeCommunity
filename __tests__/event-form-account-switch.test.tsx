import { act, fireEvent, render } from '@testing-library/react';
import EventForm from '@/components/EventForm';

jest.mock('@/components/Editor', () => ({ Editor: () => null }));
jest.mock('@/hooks/use-toast', () => {
  const toast = jest.fn();
  return { useToast: () => ({ toast }), mockToast: toast };
});

const mockToast = jest.requireMock('@/hooks/use-toast').mockToast as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

test('late event edit response after form unmount does not toast or update the former viewer', async () => {
  let resolveEdit!: (value: { ok: boolean }) => void;
  const pendingEdit = new Promise<{ ok: boolean }>(resolve => { resolveEdit = resolve; });
  global.fetch = jest.fn().mockReturnValue(pendingEdit);
  const onSuccess = jest.fn();
  const onClose = jest.fn();
  const { container, unmount } = render(<EventForm
    initialData={{
      id: 'event-1', title: 'Workshop', date: '2026-11-01T12:00:00.000Z',
      description: 'Details', location: 'Community', startTime: '12:00', endTime: '13:00',
      timezone: 'Europe/Berlin',
    }}
    onSuccess={onSuccess}
    onClose={onClose}
  />);
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => resolveEdit({ ok: true }));
  expect(mockToast).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
