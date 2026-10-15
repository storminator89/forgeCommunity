import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuizEditor } from '@/app/courses/[courseId]/contents/QuizEditor';
import type { QuizContent } from '@/app/courses/[courseId]/contents/types';

const initial: QuizContent = { questions: [
  { id: 'local-question', type: 'SINGLE_CHOICE', question: 'Local question?', options: ['No', 'Yes'], correctAnswers: [1] },
] };
const stored = { id: 'bank-question', type: 'SINGLE_CHOICE', question: 'Stored question?',
  options: ['Wrong', 'Right'], correctAnswers: [1], explanation: 'Private key' };

function response(value: object, ok = true) {
  return { ok, json: async () => value } as Response;
}

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

test('inserts a historical bank revision as an independent quiz snapshot with a fresh local ID', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/api/courses/questions')) return response({ nextCursor: null, questions: [
      { id: 'bank-item-123', latestRevision: 2, question: 'Stored question?', type: 'SINGLE_CHOICE', updatedAt: '2026-10-15' },
    ] });
    if (path.endsWith('/api/courses/questions/bank-item-123')) return response({ id: 'bank-item-123', latestRevision: 2,
      revisions: [{ revision: 2, createdAt: '2026-10-15' }, { revision: 1, createdAt: '2026-10-14' }] });
    if (path.endsWith('/api/courses/questions/bank-item-123/revisions/1')) return response({ revision: 1, question: stored });
    throw new Error(`Unexpected request: ${path}`);
  }) as jest.Mock;
  try {
    const onChange = jest.fn();
    render(<QuizEditor initialContent={initial} onSave={jest.fn()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fragenpool öffnen' }));
    await waitFor(() => expect(screen.getByLabelText('Version')).toHaveValue('2'));
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Version als Kopie einfügen' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ questions: expect.arrayContaining([
      expect.objectContaining({ question: 'Stored question?', correctAnswers: [1] }),
    ]) })));
    const copied = onChange.mock.calls.at(-1)![0].questions;
    expect(copied).toHaveLength(2);
    expect(copied[1].id).not.toBe(stored.id);
    expect(copied[1].id).not.toBe(copied[0].id);
    expect(JSON.stringify(copied)).not.toContain('bank-item-123');
    expect(initial.questions).toHaveLength(1);
    expect(screen.getByText(/Speichere anschließend den Kursentwurf/)).toBeInTheDocument();
  } finally { global.fetch = originalFetch; }
});
