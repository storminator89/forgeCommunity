import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoursePathOverview, getCoursePathEntries } from '@/app/courses/[courseId]/contents/CoursePathOverview';
import type { CourseContent } from '@/app/courses/[courseId]/contents/types';

const quiz = JSON.stringify({ questions: [{ id: 'q', type: 'SINGLE_CHOICE', question: 'Frage', options: ['Ja', 'Nein'], correctAnswers: [0] }] });
const content = (id: string, overrides: Partial<CourseContent> = {}): CourseContent => ({ id, courseId: 'course', parentId: null, title: `Inhalt ${id}`, type: 'TEXT', content: '<p>Material</p>', order: 1, ...overrides });
const curriculum = (): CourseContent[] => [
  content('chapter', { title: 'Einführung', subContents: [
    content('video', { parentId: 'chapter', title: 'Video', type: 'VIDEO', content: '/uploads/lesson.mp4', order: 2 }),
    content('nested', { parentId: 'chapter', title: 'Vertiefung', order: 1, subContents: [content('quiz', { parentId: 'nested', title: 'Wissen prüfen', content: quiz })] }),
  ] }),
  content('empty', { title: 'Nächster Schritt', content: '', order: 2 }),
];

test('derives deterministic nested sequence and current leaves without mutating source', () => {
  const tree = curriculum(), saved = JSON.stringify(tree);
  const entries = getCoursePathEntries(tree);
  expect(entries.map(entry => [entry.content.id, entry.path, entry.isLeaf])).toEqual([
    ['chapter', '1', false], ['nested', '1.1', false], ['quiz', '1.1.1', true], ['video', '1.2', true], ['empty', '2', true],
  ]);
  expect(entries.find(entry => entry.content.id === 'quiz')).toMatchObject({ isQuiz: true, findings: [] });
  expect(JSON.stringify(tree)).toBe(saved);
});

test('retains arbitrary depth, without treating ancestor chapters as completion leaves', () => {
  const root = content('0');
  let parent = root;
  for (let depth = 1; depth <= 60; depth++) {
    const child = content(String(depth), { parentId: parent.id });
    parent.subContents = [child]; parent = child;
  }
  const entries = getCoursePathEntries([root]);
  expect(entries).toHaveLength(61);
  expect(entries.filter(entry => entry.isLeaf).map(entry => entry.content.id)).toEqual(['60']);
  expect(entries.at(-1)).toMatchObject({ depth: 60 });
});

test('flags non-leaf quizzes, malformed legacy quizzes and missing material with linked kinds', () => {
  const entries = getCoursePathEntries([
    content('parent-quiz', { type: 'QUIZ', content: quiz, subContents: [content('child', { parentId: 'parent-quiz', content: '' })] }),
    content('broken', { content: '{"questions": broken' }),
  ]);
  expect(entries.find(entry => entry.content.id === 'parent-quiz')!.findings).toEqual([expect.objectContaining({ contentId: 'parent-quiz', kind: 'non-leaf-quiz', severity: 'warning' })]);
  expect(entries.find(entry => entry.content.id === 'child')!.findings).toEqual([expect.objectContaining({ contentId: 'child', kind: 'empty-content' })]);
  expect(entries.find(entry => entry.content.id === 'broken')).toMatchObject({ isQuiz: true, findings: [expect.objectContaining({ contentId: 'broken', kind: 'unreadable', severity: 'error' })] });
});

test('uses per-question readiness diagnostics without changing stored quiz content', () => {
  const draft = JSON.stringify({ questions: [{ id: 'missing-answer', type: 'TEXT_INPUT', question: 'Antwort?', correctAnswer: '' }] });
  const entries = getCoursePathEntries([content('quiz', { content: draft })]);
  expect(entries[0].findings[0]).toMatchObject({ id: 'quiz:question:missing-answer', contentId: 'quiz', questionId: 'missing-answer', kind: 'question-invalid' });
  expect(entries[0].content.content).toBe(draft);
});

test('overview shows honest leaf totals and keyboard actions for selecting and editing', async () => {
  const onContentSelect = jest.fn(), onEditContent = jest.fn();
  render(<CoursePathOverview contents={curriculum()} onContentSelect={onContentSelect} onEditContent={onEditContent} />);
  expect(screen.getByText('2 Kapitel · 3 Inhalte ohne Unterthemen · davon 1 Quiz')).toBeInTheDocument();
  expect(screen.getByText('1 Hinweis zur Inhaltspflege')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Wissen prüfen öffnen' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onContentSelect).toHaveBeenCalledWith('quiz');
  await userEvent.click(screen.getByRole('button', { name: 'Nächster Schritt bearbeiten' }));
  expect(onEditContent).toHaveBeenCalledWith('empty');
  const sequence = screen.getByRole('list', { name: 'Aktuelle Kursreihenfolge' });
  expect(within(sequence).getAllByRole('heading').map(heading => heading.textContent)).toEqual(['Einführung', 'Vertiefung', 'Wissen prüfen', 'Video', 'Nächster Schritt']);
});

test('empty and disabled states are usable without pretending to publish or complete anything', async () => {
  const onContentSelect = jest.fn();
  const { rerender } = render(<CoursePathOverview contents={[]} onContentSelect={onContentSelect} />);
  expect(screen.getByText(/Noch kein Lernpfad vorhanden/)).toBeInTheDocument();
  rerender(<CoursePathOverview contents={curriculum()} onContentSelect={onContentSelect} disabled />);
  const open = screen.getByRole('button', { name: 'Video öffnen' });
  expect(open).toBeDisabled();
  await userEvent.click(open);
  expect(onContentSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /veröffentlichen|abschließen|zertifikat/i })).not.toBeInTheDocument();
});
