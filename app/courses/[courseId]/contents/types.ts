export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'TEXT_INPUT' | 'MATCHING' | 'FILL_BLANKS';

export interface BaseQuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  explanation?: string;
}

export interface ChoiceQuizQuestion extends BaseQuizQuestion {
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  options: string[];
  correctAnswers: number[];
}

export interface TextInputQuizQuestion extends BaseQuizQuestion {
  type: 'TEXT_INPUT';
  correctAnswer: string;
  caseSensitive?: boolean;
}

export interface MatchingQuizQuestion extends BaseQuizQuestion {
  type: 'MATCHING';
  pairs: Array<{
    left: string;
    right: string;
  }>;
}

export interface FillBlanksQuizQuestion extends BaseQuizQuestion {
  type: 'FILL_BLANKS';
  text: string; // Text with [blank] placeholders
  answers: string[]; // Answers in order of appearance
}

export type QuizQuestion = ChoiceQuizQuestion | TextInputQuizQuestion | MatchingQuizQuestion | FillBlanksQuizQuestion;

export interface QuizContent {
  questions: QuizQuestion[];
  shuffleQuestions?: boolean;
  passingScore?: number;
}

export interface CourseContent {
  id: string;
  courseId: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ';
  content: string | QuizContent;
  order: number;
  parentId: string | null;
  subContents?: CourseContent[];
  completed?: boolean;
}

/** Read current and legacy persisted quizzes without discarding malformed content. */
export function parseQuizContent(value: unknown): QuizContent | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.questions)) return null;
  if (source.shuffleQuestions !== undefined && typeof source.shuffleQuestions !== 'boolean') return null;
  if (source.passingScore !== undefined && (typeof source.passingScore !== 'number' || !Number.isFinite(source.passingScore))) return null;

  const ids = new Set<string>();
  const questions: QuizQuestion[] = [];
  for (const [index, entry] of source.questions.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const question = entry as Record<string, unknown>;
    if (typeof question.question !== 'string') return null;
    if (question.explanation !== undefined && typeof question.explanation !== 'string') return null;
    const type = question.type ?? 'SINGLE_CHOICE';
    let id = typeof question.id === 'string' && question.id ? question.id : `question-${index + 1}`;
    while (ids.has(id)) id += `-${index + 1}`;
    ids.add(id);
    const base = { ...question, id, type };
    if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE' || type === 'TRUE_FALSE') {
      if (!Array.isArray(question.options) || !question.options.every(option => typeof option === 'string')) return null;
      const correctAnswers = question.correctAnswers ?? (typeof question.correctAnswer === 'number' ? [question.correctAnswer] : []);
      if (!Array.isArray(correctAnswers) || !correctAnswers.every(answer => typeof answer === 'number' && Number.isInteger(answer))) return null;
      questions.push({ ...base, options: [...question.options], correctAnswers: [...correctAnswers] } as ChoiceQuizQuestion);
    } else if (type === 'TEXT_INPUT') {
      if (typeof question.correctAnswer !== 'string' || (question.caseSensitive !== undefined && typeof question.caseSensitive !== 'boolean')) return null;
      questions.push({ ...base, correctAnswer: question.correctAnswer, caseSensitive: question.caseSensitive ?? false } as TextInputQuizQuestion);
    } else if (type === 'MATCHING') {
      if (!Array.isArray(question.pairs) || !question.pairs.every(pair => pair && typeof pair === 'object' && typeof pair.left === 'string' && typeof pair.right === 'string')) return null;
      questions.push({ ...base, pairs: question.pairs.map(pair => ({ ...pair })) } as MatchingQuizQuestion);
    } else if (type === 'FILL_BLANKS') {
      if (typeof question.text !== 'string' || !Array.isArray(question.answers) || !question.answers.every(answer => typeof answer === 'string')) return null;
      questions.push({ ...base, text: question.text, answers: [...question.answers] } as FillBlanksQuizQuestion);
    } else return null;
  }
  return { ...source, questions, shuffleQuestions: source.shuffleQuestions ?? false, passingScore: source.passingScore ?? 70 } as QuizContent;
}

/** A draft may be incomplete; explicit publication/save must have usable answers. */
export function getQuizValidationError(content: QuizContent): string | null {
  if (!Number.isFinite(content.passingScore ?? 70) || (content.passingScore ?? 70) < 0 || (content.passingScore ?? 70) > 100) return 'Die Bestehensgrenze muss zwischen 0 und 100 liegen.';
  if (!content.questions.length) return 'Füge mindestens eine Frage hinzu.';
  for (const [index, question] of content.questions.entries()) {
    const prefix = `Frage ${index + 1}: `;
    if (!question.question.trim()) return `${prefix}Der Fragetext fehlt.`;
    if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') {
      if (question.options.length < 2 || question.options.some(option => !option.trim())) return `${prefix}Fülle mindestens zwei Antwortmöglichkeiten aus.`;
      if (!question.correctAnswers.length || new Set(question.correctAnswers).size !== question.correctAnswers.length || question.correctAnswers.some(answer => answer < 0 || answer >= question.options.length)) return `${prefix}Markiere gültige richtige Antworten.`;
      if (question.type !== 'MULTIPLE_CHOICE' && question.correctAnswers.length !== 1) return `${prefix}Markiere genau eine richtige Antwort.`;
      if (question.type === 'TRUE_FALSE' && question.options.length !== 2) return `${prefix}Wahr/Falsch benötigt genau zwei Antwortmöglichkeiten.`;
    } else if (question.type === 'TEXT_INPUT' && !question.correctAnswer.trim()) return `${prefix}Die richtige Antwort fehlt.`;
    else if (question.type === 'MATCHING' && (!question.pairs.length || question.pairs.some(pair => !pair.left.trim() || !pair.right.trim()))) return `${prefix}Fülle alle Zuordnungspaare aus.`;
    else if (question.type === 'FILL_BLANKS' && (!question.text.trim() || !question.answers.length || question.answers.some(answer => !answer.trim()))) return `${prefix}Fülle den Lückentext und alle Antworten aus.`;
  }
  return null;
}
