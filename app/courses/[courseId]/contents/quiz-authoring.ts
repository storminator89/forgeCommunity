import { quizEditorDraft } from './content-form-utils';
import { getQuizValidationError, parseQuizContent, type QuestionType, type QuizContent, type QuizQuestion } from './types';

/** Author-only diagnostics. This never changes save or server grading rules. */
export interface QuizAuthoringFinding {
  id: string;
  kind: 'unreadable' | 'empty' | 'passing-score' | 'question-invalid';
  severity: 'error';
  message: string;
  contentId?: string;
  questionId?: string;
  questionIndex?: number;
}

export interface QuizAuthoringReadiness {
  quiz: QuizContent | null;
  ready: boolean;
  issues: QuizAuthoringFinding[];
  questionCount: number;
  requiredCorrectCount: number | null;
}

export const QUIZ_QUESTION_TYPES: ReadonlyArray<{ value: QuestionType; label: string }> = [
  { value: 'SINGLE_CHOICE', label: 'Einfachauswahl' },
  { value: 'MULTIPLE_CHOICE', label: 'Mehrfachauswahl' },
  { value: 'TRUE_FALSE', label: 'Wahr/Falsch' },
  { value: 'TEXT_INPUT', label: 'Freitext' },
  { value: 'MATCHING', label: 'Zuordnung' },
  { value: 'FILL_BLANKS', label: 'Lückentext' },
];

export function quizQuestionTypeLabel(type: QuestionType): string {
  return QUIZ_QUESTION_TYPES.find(item => item.value === type)?.label ?? type;
}

export function newQuizQuestionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createQuizQuestion(type: QuestionType = 'SINGLE_CHOICE'): QuizQuestion {
  const base = { id: newQuizQuestionId(), question: '' };
  switch (type) {
    case 'SINGLE_CHOICE': case 'MULTIPLE_CHOICE': return { ...base, type, options: ['', ''], correctAnswers: [] };
    case 'TRUE_FALSE': return { ...base, type, options: ['Wahr', 'Falsch'], correctAnswers: [0] };
    case 'TEXT_INPUT': return { ...base, type, correctAnswer: '', caseSensitive: false };
    case 'MATCHING': return { ...base, type, pairs: [{ left: '', right: '' }, { left: '', right: '' }] };
    case 'FILL_BLANKS': return { ...base, type, text: '', answers: [''] };
  }
}

/** JSON is the persisted contract, including any legacy/custom metadata. */
export function duplicateQuizQuestion(question: QuizQuestion, existingIds: Iterable<string> = []): QuizQuestion {
  const copy = JSON.parse(JSON.stringify(question)) as QuizQuestion;
  const taken = new Set(existingIds);
  taken.add(question.id);
  const candidate = newQuizQuestionId();
  let id = candidate;
  for (let suffix = 2; taken.has(id); suffix++) id = `${candidate}-${suffix}`;
  return { ...copy, id };
}

/** Accepts stored string/object quizzes and temporarily incomplete editor drafts. */
export function getQuizAuthoringReadiness(value: unknown, contentId?: string, courseId?: string): QuizAuthoringReadiness {
  let quiz = parseQuizContent(value, courseId);
  if (!quiz && value && typeof value === 'object' && !Array.isArray(value)) quiz = quizEditorDraft(value as QuizContent, courseId);
  // A temporarily blank number field is NaN in the local editor, not malformed persisted JSON.
  if (!quiz && value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    if (typeof source.passingScore === 'number' && !Number.isFinite(source.passingScore)) {
      const parsed = parseQuizContent({ ...source, passingScore: 70 }, courseId);
      if (parsed) quiz = { ...parsed, passingScore: source.passingScore };
    }
  }
  const scope = contentId ?? 'quiz';
  const finding = (kind: QuizAuthoringFinding['kind'], message: string): QuizAuthoringFinding => ({
    id: `${scope}:${kind}`, kind, severity: 'error', message, ...(contentId && { contentId }),
  });
  if (!quiz) return {
    quiz: null, ready: false, questionCount: 0, requiredCorrectCount: null,
    issues: [finding('unreadable', 'Die gespeicherten Quizdaten können nicht gelesen werden. Der ursprüngliche Inhalt bleibt erhalten.')],
  };

  const issues: QuizAuthoringFinding[] = [];
  const threshold = quiz.passingScore ?? 70;
  const validThreshold = Number.isFinite(threshold) && threshold >= 0 && threshold <= 100;
  if (!validThreshold) issues.push(finding('passing-score', 'Die Bestehensgrenze muss zwischen 0 und 100 liegen.'));
  if (!quiz.questions.length) issues.push(finding('empty', 'Füge mindestens eine Frage hinzu.'));
  for (const [questionIndex, question] of quiz.questions.entries()) {
    // Reuse the authoritative validation, one actionable finding per question.
    const error = getQuizValidationError({ questions: [question], passingScore: 70 }, courseId);
    if (error) issues.push({
      ...finding('question-invalid', error.replace(/^Frage 1: /, `Frage ${questionIndex + 1}: `)),
      id: `${scope}:question:${question.id}`, questionId: question.id, questionIndex,
    });
  }
  let requiredCorrectCount: number | null = null;
  if (validThreshold && quiz.questions.length) {
    // Match the server's arithmetic exactly, including fractional thresholds and zero.
    for (let count = 0; count <= quiz.questions.length; count++) {
      if (count * 100 / quiz.questions.length >= threshold) { requiredCorrectCount = count; break; }
    }
  }
  return { quiz, ready: issues.length === 0, issues, questionCount: quiz.questions.length, requiredCorrectCount };
}
