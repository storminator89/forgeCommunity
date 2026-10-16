import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      id: 'event-1', title: 'Workshop', date: '2026-11-01T11:00:00.000Z',
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


test('editing derives both the day and start time from the stored instant in the event zone', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  const { container } = render(<EventForm initialData={{
    id: 'midnight', title: 'Nach Mitternacht', date: '2030-05-20T22:30:00.000Z',
    description: 'Details', location: 'Community', startTime: '00:30', endTime: '01:30', timezone: 'Europe/Berlin',
  }} onSuccess={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByLabelText('Datum')).toHaveValue('2030-05-21');
  expect(screen.getByLabelText('Startzeit')).toHaveValue('00:30');
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  const options = jest.mocked(global.fetch).mock.calls[0][1]!;
  expect(JSON.parse(options.body as string)).toMatchObject({ date: '2030-05-21', startTime: '00:30', endTime: '01:30', timezone: 'Europe/Berlin' });
});

test.each(['2030-03-31', '2030-10-27'])('refuses a DST gap or repeated local time before submitting on %s', async date => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  global.fetch = jest.fn();
  const { container } = render(<EventForm initialData={{
    id: 'dst', title: 'Zeitumstellung', date: `${date}T00:00:00.000Z`,
    description: 'Details', location: 'Community', startTime: '01:00', endTime: '04:00', timezone: 'Europe/Berlin',
  }} onSuccess={jest.fn()} onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Startzeit'), { target: { value: '02:30' } });
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fehler', variant: 'destructive' })));
  expect(global.fetch).not.toHaveBeenCalled();
  error.mockRestore();
});
