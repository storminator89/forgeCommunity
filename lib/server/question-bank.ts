import 'server-only';

import { d1ListBankQuestions, d1BankQuestionHistory, d1BankQuestionRevision } from '@/lib/server/d1-question-bank-read';

import { checkQuizMediaQuestionPoolInput } from '@/lib/quiz-media-compatibility';

import { d1CreateBankQuestion, d1ReviseBankQuestion } from '@/lib/server/d1-question-bank-write';
import { getQuizValidationError, parseQuizContent, type QuizQuestion } from '@/app/courses/[courseId]/contents/types';

export class QuestionBankError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Ignore untrusted extra JSON fields and persist only the quiz grading contract. */
export function bankQuestionFromInput(value: unknown): QuizQuestion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QuestionBankError('Ungültige Frage.');
  const mediaGate = checkQuizMediaQuestionPoolInput(value);
  if (!mediaGate.ok) throw new QuestionBankError(mediaGate.error.message, mediaGate.error.status);
  const input = value as Record<string, unknown>;
  if (typeof input.type !== 'string' || typeof input.question !== 'string' || input.question.length > 3000 ||
      (input.explanation !== undefined && (typeof input.explanation !== 'string' || input.explanation.length > 3000))) {
    throw new QuestionBankError('Ungültige Frage.');
  }
  const base = { id: 'bank-question', type: input.type, question: input.question.trim(),
    ...(typeof input.explanation === 'string' && { explanation: input.explanation.trim() }) };
  let question: QuizQuestion;
  if (input.type === 'SINGLE_CHOICE' || input.type === 'MULTIPLE_CHOICE' || input.type === 'TRUE_FALSE') {
    if (!Array.isArray(input.options) || input.options.length > 12 ||
        !input.options.every(option => typeof option === 'string' && option.length <= 1000) ||
        !Array.isArray(input.correctAnswers) || !input.correctAnswers.every(answer => Number.isInteger(answer))) {
      throw new QuestionBankError('Ungültige Antwortmöglichkeiten.');
    }
    question = { ...base, type: input.type, options: input.options.map(option => option.trim()), correctAnswers: [...input.correctAnswers] };
  } else if (input.type === 'TEXT_INPUT') {
    if (typeof input.correctAnswer !== 'string' || input.correctAnswer.length > 1000 ||
        (input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean')) throw new QuestionBankError('Ungültige Antwort.');
    question = { ...base, type: input.type, correctAnswer: input.correctAnswer.trim(), caseSensitive: input.caseSensitive === true };
  } else if (input.type === 'MATCHING') {
    if (!Array.isArray(input.pairs) || input.pairs.length > 20 || !input.pairs.every(pair =>
      pair && typeof pair === 'object' && !Array.isArray(pair) && typeof pair.left === 'string' &&
      typeof pair.right === 'string' && pair.left.length <= 1000 && pair.right.length <= 1000)) throw new QuestionBankError('Ungültige Zuordnung.');
    question = { ...base, type: input.type, pairs: input.pairs.map(pair => ({ left: pair.left.trim(), right: pair.right.trim() })) };
  } else if (input.type === 'FILL_BLANKS') {
    if (typeof input.text !== 'string' || input.text.length > 5000 || !Array.isArray(input.answers) ||
        input.answers.length > 20 || !input.answers.every(answer => typeof answer === 'string' && answer.length <= 1000)) {
      throw new QuestionBankError('Ungültiger Lückentext.');
    }
    question = { ...base, type: input.type, text: input.text.trim(), answers: input.answers.map(answer => answer.trim()) };
  } else throw new QuestionBankError('Unbekannter Fragetyp.');
  const parsed = parseQuizContent({ questions: [question] });
  if (!parsed || getQuizValidationError(parsed)) throw new QuestionBankError(getQuizValidationError(parsed ?? { questions: [] }) ?? 'Ungültige Frage.');
  if (Buffer.byteLength(JSON.stringify(question), 'utf8') > 16 * 1024) throw new QuestionBankError('Die Frage ist zu groß.', 413);
  return question;
}

export async function listBankQuestions(ownerId: string, cursor?: string | null) {
  if (cursor && !validId(cursor)) throw new QuestionBankError('Ungültiger Listencursor.');
  return d1ListBankQuestions(ownerId, cursor || null);
}

export async function createBankQuestion(ownerId: string, value: unknown) {
  const question = bankQuestionFromInput(value);
  return d1CreateBankQuestion(ownerId, JSON.stringify(question));
}

export async function getBankQuestionHistory(ownerId: string, itemId: string) {
  if (!validId(itemId)) throw new QuestionBankError('Frage nicht gefunden.', 404);
  return d1BankQuestionHistory(ownerId, itemId);
}

export async function getBankQuestionRevision(ownerId: string, itemId: string, revision: number) {
  if (!validId(itemId) || !validRevision(revision)) throw new QuestionBankError('Frage nicht gefunden.', 404);
  return d1BankQuestionRevision(ownerId, itemId, revision);
}

export async function reviseBankQuestion(ownerId: string, itemId: string, expectedRevision: unknown, value: unknown) {
  if (!validId(itemId)) throw new QuestionBankError('Frage nicht gefunden.', 404);
  if (!validRevision(expectedRevision)) throw new QuestionBankError('Erwartete Version fehlt.', 428);
  const question = bankQuestionFromInput(value);
  return d1ReviseBankQuestion(ownerId, itemId, expectedRevision, JSON.stringify(question));
}
