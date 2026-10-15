import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OwnSkillsWorkbench } from '@/components/skills/own-skills-workbench';

const catalog = [
  { id: 'typescript', name: 'TypeScript', category: 'Technik' },
  { id: 'figma', name: 'Figma', category: 'Design' },
];
const owned = { id: 'owned-ts', skillId: 'typescript', level: 81, endorsements: 2, skill: catalog[0] };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
let rows: typeof owned[];
let changed: jest.Mock;

beforeEach(() => {
  rows = [owned]; changed = jest.fn();
  global.fetch = jest.fn(async (_url, init) => response(init?.method ? {} : rows));
});

const show = () => render(<OwnSkillsWorkbench viewerId="alice" catalog={catalog} onChanged={changed} />);
const loaded = () => screen.findByRole('heading', { name: 'TypeScript' });

it('keeps exact stored values, excludes owned options and edits without replacing endorsement-bearing rows', async () => {
  show(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Fähigkeit hinzufügen' }));
  expect(within(screen.getByRole('dialog')).queryByRole('option', { name: 'TypeScript' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Figma' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  fireEvent.click(screen.getByRole('button', { name: 'TypeScript bearbeiten' }));
  expect(screen.getByLabelText('Selbsteinschätzung (0–100%)')).toHaveValue(81);
  fireEvent.change(screen.getByLabelText('Selbsteinschätzung (0–100%)'), { target: { value: '82' } });
  rows = [{ ...owned, level: 82 }];
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(await screen.findByText('Selbsteinschätzung gespeichert.')).toBeInTheDocument();
  expect(screen.getByText(/Selbsteinschätzung 82%/)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/user/skills/typescript', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ level: 82 }) }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('guards repeated save events while an existing-skill attach is in flight', async () => {
  let finish!: (result: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  jest.mocked(fetch).mockImplementation(async (_url, init) => init?.method === 'POST' ? pending : response(rows));
  show(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Fähigkeit hinzufügen' }));
  fireEvent.change(screen.getByLabelText('Fähigkeit', { exact: true }), { target: { value: 'figma' } });
  const form = screen.getByRole('button', { name: 'Speichern' }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Wird gespeichert…' })).toBeDisabled();
  await act(async () => finish(response({ id: 'figma-row' })));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('reuses a catalog item after a partial create/attach failure and keeps recoverable errors in the dialog', async () => {
  const created = { id: 'new-skill', name: 'Moderation', category: 'Zusammenarbeit' };
  let attachments = 0;
  jest.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === '/api/skills') return response(created);
    if (init?.method === 'POST') return ++attachments === 1 ? response({ error: 'Bitte erneut versuchen.' }, false) : response({});
    return response(rows);
  });
  show(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Fähigkeit hinzufügen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Neu erstellen' }));
  fireEvent.change(screen.getByLabelText('Name der Fähigkeit'), { target: { value: '  Moderation  ' } });
  fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'Zusammenarbeit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Bitte erneut versuchen.');
  expect(screen.getByLabelText('Fähigkeit', { exact: true })).toHaveValue('new-skill');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText('Fähigkeit hinzugefügt.');
  expect(jest.mocked(fetch).mock.calls.filter(([url]) => url === '/api/skills')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith('/api/skills', expect.objectContaining({ body: JSON.stringify({ name: 'Moderation', category: 'Zusammenarbeit' }) }));
  expect(changed).toHaveBeenCalledTimes(1);
});

it('explains the endorsement loss and lets keyboard users cancel before removing', async () => {
  show(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'TypeScript entfernen' }));
  expect(screen.getByText(/Skill-Empfehlungen gehen verloren/)).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(jest.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'TypeScript entfernen' }));
  rows = [];
  fireEvent.click(screen.getByRole('button', { name: 'Fähigkeit entfernen' }));
  expect(await screen.findByText('Fähigkeit entfernt.')).toBeInTheDocument();
  await screen.findByText('Womit kennst du dich aus?');
  expect(fetch).toHaveBeenCalledWith('/api/user/skills/typescript', expect.objectContaining({ method: 'DELETE' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Fähigkeit hinzufügen' })).toHaveFocus());
});

it.each(['-1', '101', '10.5', ''])('rejects invalid self-assessment %s before any write', async value => {
  show(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'TypeScript bearbeiten' }));
  fireEvent.change(screen.getByLabelText('Selbsteinschätzung (0–100%)'), { target: { value } });
  fireEvent.submit(screen.getByRole('button', { name: 'Speichern' }).closest('form')!);
  expect(screen.getByRole('alert')).toHaveTextContent('ganze Zahl zwischen 0 und 100');
  expect(jest.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it('has a retryable read error and keeps a successful write closed if refreshing the list fails', async () => {
  jest.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  show();
  await screen.findByText('Deine Fähigkeiten konnten nicht geladen werden.');
  fireEvent.click(screen.getByRole('button', { name: 'Liste erneut laden' }));
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'TypeScript bearbeiten' }));
  jest.mocked(fetch).mockResolvedValueOnce(response({})).mockRejectedValueOnce(new Error('offline after save'));
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText('Gespeichert. Lade die Liste erneut, um den aktuellen Stand zu sehen.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(changed).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Liste erneut laden' })).toHaveFocus());
  fireEvent.click(screen.getByRole('button', { name: 'Liste erneut laden' }));
  await loaded();
});

it('does not mistake a pending or failed catalog for an exhausted catalog and offers a retry', async () => {
  const retryCatalog = jest.fn();
  const props = { viewerId: 'alice', catalog: [] as typeof catalog, onChanged: changed, onCatalogRetry: retryCatalog };
  const view = render(<OwnSkillsWorkbench {...props} catalogLoading />);
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Fähigkeit hinzufügen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Aus Verzeichnis' }));
  expect(screen.getByText('Verzeichnis wird geladen …')).toBeInTheDocument();
  expect(screen.getByLabelText('Fähigkeit', { exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  expect(screen.queryByText('Alle vorhandenen Fähigkeiten sind bereits in deinem Profil.')).not.toBeInTheDocument();
  view.rerender(<OwnSkillsWorkbench {...props} catalogError />);
  expect(screen.getByRole('alert')).toHaveTextContent('Verzeichnis nicht verfügbar.');
  fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
  expect(retryCatalog).toHaveBeenCalledTimes(1);
  view.rerender(<OwnSkillsWorkbench {...props} catalog={catalog} />);
  expect(screen.getByLabelText('Fähigkeit', { exact: true })).not.toBeDisabled();
  expect(screen.getByRole('option', { name: 'Figma' })).toBeInTheDocument();
});

it('aborts old account reads and mutations and ignores their late responses', async () => {
  let finish!: (result: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  jest.mocked(fetch).mockImplementation(async (_url, init) => init?.method ? pending : response(rows));
  const view = show(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'TypeScript bearbeiten' }));
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  const signal = jest.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')![1]!.signal as AbortSignal;
  rows = [];
  view.rerender(<OwnSkillsWorkbench viewerId="bob" catalog={catalog} onChanged={changed} />);
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText('TypeScript')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await screen.findByText('Womit kennst du dich aus?');
  await act(async () => finish(response({})));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByText('Selbsteinschätzung gespeichert.')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mein Profil' })).toHaveAttribute('href', '/profile/bob');
});
