import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { H5PSourceField } from '@/components/h5p/H5PSourceField';
import { EditContentForm } from '@/app/courses/[courseId]/contents/EditContentForm';
import { CourseContent } from '@/app/courses/[courseId]/contents/types';

jest.mock('@/components/Editor', () => ({ Editor: () => null }));
jest.mock('@/app/courses/[courseId]/contents/QuizEditor', () => ({ QuizEditor: () => null }));
const jsonResponse = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;

function Harness({ onSubmit = jest.fn() }: { onSubmit?: jest.Mock }) {
  const [value, setValue] = useState('https://existing.example.org/embed/1');
  const [busy, setBusy] = useState(false);
  return <form onSubmit={event => { event.preventDefault(); onSubmit(); }}><H5PSourceField value={value} onChange={setValue} onBusyChange={setBusy} disabled={busy} /><button type="submit" disabled={busy} data-testid="outer-save">Lektionen speichern</button></form>;
}

beforeEach(() => { jest.clearAllMocks(); jest.mocked(fetch).mockReset(); });

async function openField(list: unknown = []) {
  jest.mocked(fetch).mockResolvedValueOnce(jsonResponse(list));
  fireEvent.click(screen.getByRole('button', { name: 'H5P auswählen oder hochladen' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/h5p/contents', expect.any(Object)));
  await waitFor(() => expect(screen.queryByText('H5P-Inhalte werden geladen…')).not.toBeInTheDocument());
}

it('loads real packages and selects their persisted ID without submitting the course', async () => {
  const onSubmit = jest.fn();
  render(<Harness onSubmit={onSubmit} />);
  await openField([{ id: 'actual-content-id', title: 'Sicherheitskurs', contentType: 'H5P.InteractiveVideo' }]);
  expect(screen.queryByText('memory-game')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Sicherheitskurs/ }));
  expect(screen.getByLabelText('H5P-URL, ID oder Einbettungscode')).toHaveValue('/h5p/embed/actual-content-id');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(document.querySelectorAll('form')).toHaveLength(1);
});

it('filters the saved package list by title or content type', async () => {
  render(<Harness />);
  await openField([{ id: 'video1', title: 'Unterweisung', contentType: 'H5P.InteractiveVideo' }, { id: 'quiz1', title: 'Wissenstest', contentType: 'H5P.QuestionSet' }]);
  fireEvent.change(screen.getByLabelText('H5P-Inhalte suchen'), { target: { value: 'question' } });
  expect(screen.getByRole('button', { name: /Wissenstest/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Unterweisung/ })).not.toBeInTheDocument();
});

it('uploads a package once, blocks outer saves while pending, then selects the real returned ID', async () => {
  render(<Harness />);
  await openField();
  let resolveUpload!: (response: Response) => void;
  jest.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveUpload = resolve; }));
  const file = new File(['PK-package'], 'sicherheit.h5p');
  fireEvent.change(screen.getByLabelText('H5P-Paket (.h5p, maximal 50 MB)'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen und verwenden' }));
  expect(screen.getByTestId('outer-save')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Paket wird hochgeladen…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Paket wird hochgeladen…' }));
  expect(fetch).toHaveBeenCalledTimes(2);
  const uploadRequest = jest.mocked(fetch).mock.calls[1][1]!;
  expect(uploadRequest.method).toBe('POST');
  expect((uploadRequest.body as FormData).get('h5p')).toBe(file);
  resolveUpload(jsonResponse({ id: 'uploaded-id', title: 'Sicherheitsprüfung', contentType: 'H5P.QuestionSet' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('H5P-URL, ID oder Einbettungscode')).toHaveValue('/h5p/embed/uploaded-id');
  expect(screen.getByTestId('outer-save')).toBeEnabled();
});

it('keeps the existing draft and selected file after an upload failure and allows retry', async () => {
  render(<Harness />);
  await openField();
  jest.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'Ungültiges Archiv' }, false));
  const file = new File(['broken'], 'kaputt.h5p');
  const input = screen.getByLabelText('H5P-Paket (.h5p, maximal 50 MB)') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen und verwenden' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ungültiges Archiv'));
  expect(input.files?.[0]).toBe(file);
  expect(screen.getByLabelText('H5P-URL, ID oder Einbettungscode')).toHaveValue('https://existing.example.org/embed/1');
  expect(screen.getByRole('button', { name: 'Hochladen und verwenden' })).toBeEnabled();
  jest.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: 'retry-id', title: 'Paket' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen und verwenden' }));
  await waitFor(() => expect(screen.getByLabelText('H5P-URL, ID oder Einbettungscode')).toHaveValue('/h5p/embed/retry-id'));
});

it('rejects wrong extensions and oversized files before posting them', async () => {
  render(<Harness />);
  await openField();
  const input = screen.getByLabelText('H5P-Paket (.h5p, maximal 50 MB)');
  fireEvent.change(input, { target: { files: [new File(['x'], 'falsch.zip')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen und verwenden' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Endung .h5p');
  const oversized = new File(['x'], 'gross.h5p');
  Object.defineProperty(oversized, 'size', { value: 51 * 1024 * 1024 });
  fireEvent.change(input, { target: { files: [oversized] } });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen und verwenden' }));
  expect(screen.getByRole('alert')).toHaveTextContent('50 MB');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('offers a retry for list errors without replacing the external URL draft', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'Keine Berechtigung' }, false));
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'H5P auswählen oder hochladen' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Keine Berechtigung'));
  jest.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ id: 'content1', title: 'Lektion' }]));
  fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
  await screen.findByRole('button', { name: 'Lektion' });
  expect(screen.getByLabelText('H5P-URL, ID oder Einbettungscode')).toHaveValue('https://existing.example.org/embed/1');
});

it('keeps the existing external-source save path in the course editor', async () => {
  const initial: CourseContent = { id: 'h5p-lesson', courseId: 'course1', parentId: 'topic1', title: 'H5P-Lektion', type: 'H5P', content: 'https://h5p.example.org/embed/1', order: 0 };
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(<EditContentForm content={initial} onContentChange={jest.fn()} onSubmit={onSubmit} onCancel={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('H5P-URL, ID oder Einbettungscode'), { target: { value: 'https://h5p.example.org/embed/2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'H5P', content: 'https://h5p.example.org/embed/2' })));
  expect(fetch).not.toHaveBeenCalled();
});
