import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuizEditor } from '@/app/courses/[courseId]/contents/QuizEditor';
import { QuizAuthorPreview } from '@/app/courses/[courseId]/contents/QuizAuthorPreview';
import { createQuizQuestion, duplicateQuizQuestion, getQuizAuthoringReadiness, QUIZ_QUESTION_TYPES } from '@/app/courses/[courseId]/contents/quiz-authoring';
import { getQuizValidationError, type QuizContent, type QuizQuestion } from '@/app/courses/[courseId]/contents/types';

const allTypes = (): QuizContent => ({ passingScore: 70, shuffleQuestions: false, questions: [
  { id: 'choice', type: 'SINGLE_CHOICE', question: 'Wähle eine Antwort', options: ['Ja', 'Nein'], correctAnswers: [0], explanation: 'Interne Erklärung' },
  { id: 'multi', type: 'MULTIPLE_CHOICE', question: 'Wähle mehrere Antworten', options: ['Rot', 'Blau'], correctAnswers: [0, 1] },
  { id: 'bool', type: 'TRUE_FALSE', question: 'Ist das wahr?', options: ['Wahr', 'Falsch'], correctAnswers: [0] },
  { id: 'short', type: 'TEXT_INPUT', question: 'Nenne das Kennwort', correctAnswer: 'Geheime Lösung', caseSensitive: true },
  { id: 'matching', type: 'MATCHING', question: 'Ordne zu', pairs: [{ left: 'Hauptstadt', right: 'Berlin' }] },
  { id: 'blanks', type: 'FILL_BLANKS', question: 'Ergänze den Satz', text: '[eins] und [zwei]', answers: ['Erste Lösung', 'Zweite Lösung'] },
] });
const choice = (): QuizContent => ({ ...allTypes(), questions: [allTypes().questions[0]] });

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => jest.clearAllMocks());

describe('pure author readiness and question operations', () => {
  test('reuses validation for all six types and calculates the equal-weight pass count', () => {
    const result = getQuizAuthoringReadiness(allTypes(), 'lesson');
    expect(result).toMatchObject({ ready: true, questionCount: 6, requiredCorrectCount: 5, issues: [] });
    expect(getQuizValidationError(result.quiz!)).toBeNull();
  });

  test.each([0, 1, 33.333333333333336, 70, 99.9, 100])('matches server score arithmetic at threshold %s', passingScore => {
    const quiz = { ...allTypes(), passingScore };
    const required = getQuizAuthoringReadiness(quiz).requiredCorrectCount!;
    expect(required * 100 / quiz.questions.length).toBeGreaterThanOrEqual(passingScore);
    if (required > 0) expect((required - 1) * 100 / quiz.questions.length).toBeLessThan(passingScore);
  });

  test('keeps legacy answers, generated IDs, zero threshold and custom metadata without mutating the input', () => {
    const legacy = { passingScore: 0, custom: { retained: true }, questions: [{ question: 'Alt', options: ['A', 'B'], correctAnswer: 1 }] };
    const result = getQuizAuthoringReadiness(JSON.stringify(legacy));
    expect(result).toMatchObject({ ready: true, requiredCorrectCount: 0, quiz: { custom: { retained: true }, questions: [{ id: 'question-1', correctAnswers: [1], correctAnswer: 1 }] } });
    expect(legacy.questions[0]).not.toHaveProperty('id');
  });

  test('returns stable, linked findings for each incomplete question and an invalid threshold', () => {
    const quiz: QuizContent = { passingScore: NaN, questions: [{ ...createQuizQuestion('TEXT_INPUT'), id: 'a' }, { ...createQuizQuestion('MATCHING'), id: 'b' }] };
    const first = getQuizAuthoringReadiness(quiz, 'lesson');
    const second = getQuizAuthoringReadiness(quiz, 'lesson');
    expect(first).toMatchObject({ ready: false, questionCount: 2, requiredCorrectCount: null });
    expect(first.issues).toEqual(second.issues);
    expect(first.issues).toEqual([
      expect.objectContaining({ id: 'lesson:passing-score', severity: 'error', kind: 'passing-score', contentId: 'lesson' }),
      expect.objectContaining({ id: 'lesson:question:a', questionId: 'a', questionIndex: 0, message: 'Frage 1: Der Fragetext fehlt.' }),
      expect.objectContaining({ id: 'lesson:question:b', questionId: 'b', questionIndex: 1, message: 'Frage 2: Der Fragetext fehlt.' }),
    ]);
  });

  test.each(['{broken', { questions: [{ type: 'ESSAY', question: 'Unbekannt' }] }])('fails closed for malformed or unsupported content', value => {
    expect(getQuizAuthoringReadiness(value)).toMatchObject({ ready: false, quiz: null, issues: [{ kind: 'unreadable' }] });
  });

  test('empty quizzes remain incomplete rather than a publishable or completed state', () => {
    expect(getQuizAuthoringReadiness({ questions: [] })).toMatchObject({ ready: false, questionCount: 0, requiredCorrectCount: null, issues: [{ kind: 'empty' }] });
  });

  test.each(QUIZ_QUESTION_TYPES)('creates an editable $value draft', ({ value }) => {
    const draft = createQuizQuestion(value);
    expect(draft).toMatchObject({ type: value, question: '' });
    expect(draft.id).toBeTruthy();
    expect(getQuizAuthoringReadiness({ questions: [draft] })).toMatchObject({ ready: false, questionCount: 1 });
  });

  test('duplicates every question type with new identity, metadata and deep-copy isolation', () => {
    for (const original of allTypes().questions) {
      const enriched = { ...original, metadata: { tags: ['keep'] } };
      const copy = duplicateQuizQuestion(enriched, allTypes().questions.map(question => question.id)) as QuizQuestion & { metadata: { tags: string[] } };
      expect(copy.id).not.toBe(original.id);
      expect({ ...copy, id: original.id }).toEqual(enriched);
      copy.metadata.tags.push('new');
      expect(enriched.metadata.tags).toEqual(['keep']);
      if (copy.type === 'MATCHING' && original.type === 'MATCHING') { copy.pairs[0].right = 'changed'; expect(original.pairs[0].right).toBe('Berlin'); }
      if (copy.type === 'SINGLE_CHOICE' && original.type === 'SINGLE_CHOICE') { copy.options[0] = 'changed'; copy.correctAnswers.push(1); expect(original.options[0]).toBe('Ja'); expect(original.correctAnswers).toEqual([0]); }
    }
  });

  test('resolves generated-ID collisions instead of creating duplicate question IDs', () => {
    const random = jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    try {
      const result = duplicateQuizQuestion(allTypes().questions[0], ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000-2']);
      expect(result.id).toBe('00000000-0000-4000-8000-000000000000-3');
    } finally { random.mockRestore(); }
  });
});

describe('quiz authoring workbench', () => {
  test('opening unchanged stored quiz and preview makes no draft change or submission', async () => {
    const onChange = jest.fn(), onSave = jest.fn(), onSubmit = jest.fn(event => event.preventDefault());
    render(<form onSubmit={onSubmit}><QuizEditor initialContent={JSON.stringify(choice())} onSave={onSave} onChange={onChange} /></form>);
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Vorschau' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lösungen anzeigen' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('adds directly by type, announces it and focuses the new question', async () => {
    const onChange = jest.fn();
    render(<QuizEditor initialContent={choice()} onSave={jest.fn()} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Neue Frage als'), 'MATCHING');
    await userEvent.click(screen.getByRole('button', { name: 'Neue Frage' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ questions: [expect.anything(), expect.objectContaining({ type: 'MATCHING' })] }));
    expect(screen.getAllByLabelText('Frage')[1]).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Frage 2 angelegt: Zuordnung');
  });

  test('duplicates a question adjacent to its source and keeps its answer mapping isolated', async () => {
    const original = choice(), onChange = jest.fn();
    render(<QuizEditor initialContent={original} onSave={jest.fn()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Frage 1 duplizieren' }));
    const copied = onChange.mock.calls.at(-1)[0].questions;
    expect(copied).toHaveLength(2);
    expect(copied[0].id).not.toEqual(copied[1].id);
    expect(screen.getAllByLabelText('Frage')[1]).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Frage 2, Option 1'), { target: { value: 'Kopie' } });
    expect(screen.getByLabelText('Frage 1, Option 1')).toHaveValue('Ja');
    expect(original.questions[0]).toEqual(allTypes().questions[0]);
  });

  test('readiness links jump to an invalid question and keyboard buttons reorder it', async () => {
    const quiz = choice(); quiz.questions.push({ id: 'empty', type: 'TEXT_INPUT', question: '', correctAnswer: '' });
    const onChange = jest.fn();
    render(<QuizEditor initialContent={quiz} onSave={jest.fn()} onChange={onChange} />);
    const jump = screen.getByRole('button', { name: 'Frage 2: Der Fragetext fehlt.' });
    jump.focus(); await userEvent.keyboard('{Enter}');
    expect(screen.getAllByLabelText('Frage')[1]).toHaveFocus();
    screen.getByRole('button', { name: 'Frage 2 nach oben verschieben' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onChange.mock.calls.at(-1)[0].questions.map((question: QuizQuestion) => question.id)).toEqual(['empty', 'choice']);
    expect(screen.getByRole('status')).toHaveTextContent('auf Position 1 verschoben');
  });

  test('deleting the final question returns focus to add and leaves a useful empty state', async () => {
    render(<QuizEditor initialContent={choice()} onSave={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Frage 1 löschen' }));
    expect(screen.getByRole('button', { name: 'Neue Frage' })).toHaveFocus();
    expect(screen.getByText('Füge mindestens eine Frage hinzu.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(screen.getByLabelText('Frage')).toHaveFocus();
    expect(screen.getByLabelText('Frage 1, Option 1')).toHaveValue('Ja');
  });
});

describe('strictly local author rehearsal', () => {
  test('all six modes accept answers with no network, grading, enclosing submit or exposed key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(jest.fn());
    const onSubmit = jest.fn(event => event.preventDefault());
    try {
      // Match the real course editor: an enclosing live-save form has a submit
      // button, so Enter in a rehearsal answer would otherwise save the course.
      render(<form onSubmit={onSubmit}><QuizAuthorPreview content={allTypes()} /><button type="submit">Speichern</button></form>);
      expect(screen.queryByText('Geheime Lösung')).not.toBeInTheDocument();
      expect(screen.queryByText('Berlin')).not.toBeInTheDocument();
      expect(screen.queryByText('Interne Erklärung')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('radio', { name: 'Ja' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Rot' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Blau' }));
      await userEvent.click(screen.getByRole('radio', { name: 'Wahr' }));
      await userEvent.type(screen.getByRole('textbox', { name: 'Vorschauantwort zu Frage 4' }), 'beliebige Antwort');
      await userEvent.type(screen.getByRole('textbox', { name: 'Vorschauantwort zu Frage 4' }), '{enter}');
      await userEvent.type(screen.getByRole('textbox', { name: 'Hauptstadt' }), 'beliebige Stadt');
      await userEvent.type(screen.getByRole('textbox', { name: 'Hauptstadt' }), '{enter}');
      await userEvent.type(screen.getByRole('textbox', { name: 'Frage 6, Lücke 1' }), 'eins');
      await userEvent.type(screen.getByRole('textbox', { name: 'Frage 6, Lücke 1' }), '{enter}');
      await userEvent.type(screen.getByRole('textbox', { name: 'Frage 6, Lücke 2' }), 'zwei');
      expect(screen.getByRole('status')).toHaveTextContent('6 von 6 Vorschaufragen beantwortet');
      expect(screen.queryByRole('button', { name: /abgeben|prüfen|beenden/i })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Lösungen anzeigen' }));
      expect(within(screen.getByRole('generic', { name: 'Lösung für Frage 4' })).getByText('Geheime Lösung')).toBeInTheDocument();
      expect(screen.getByText('Interne Erklärung')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Antworten zurücksetzen' }));
      expect(screen.getByRole('status')).toHaveTextContent('0 von 6');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    } finally { fetchMock.mockRestore(); }
  });

  test('changed source content resets local answers and hides revealed solutions', async () => {
    const quiz = choice();
    const { rerender } = render(<QuizAuthorPreview content={quiz} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Ja' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lösungen anzeigen' }));
    rerender(<QuizAuthorPreview content={{ ...quiz, passingScore: 80 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('0 von 1');
    expect(screen.getByRole('button', { name: 'Lösungen anzeigen' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('disabled preview prevents answer changes and malformed content preserves source', () => {
    const { rerender } = render(<QuizAuthorPreview content={allTypes()} disabled />);
    expect(screen.getByRole('textbox', { name: 'Vorschauantwort zu Frage 4' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lösungen anzeigen' })).toBeDisabled();
    rerender(<QuizAuthorPreview content="{broken" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Der gespeicherte Inhalt bleibt erhalten');
  });
});
