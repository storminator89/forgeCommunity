import 'server-only';

import { createHash } from 'node:crypto';

export const QUIZ_CONFIDENCE_VALUES = ['SURE', 'SOMEWHAT_SURE', 'UNSURE', 'GUESSED'] as const;
export type QuizConfidenceValue = typeof QUIZ_CONFIDENCE_VALUES[number];

export class InvalidQuizConfidenceError extends Error {
  constructor() { super('Invalid quiz confidence'); }
}

export type ParsedQuizConfidence = {
  questionIds: Set<string>;
  values: Map<string, QuizConfidenceValue>;
  digest: string | null;
  recorded: boolean;
};

/**
 * Confidence is optional, including for old clients. An omitted item and an
 * explicit null both mean "no answer"; they have the same retry fingerprint.
 * The canonical fingerprint is independent of JSON object key order.
 */
export function parseQuizConfidence(value: unknown): ParsedQuizConfidence {
  if (value === undefined || value === null) {
    return { questionIds: new Set(), values: new Map(), digest: null, recorded: false };
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new InvalidQuizConfidenceError();
  const questionIds = new Set<string>();
  const values = new Map<string, QuizConfidenceValue>();
  for (const [questionId, confidence] of Object.entries(value)) {
    // The published quiz defines valid IDs; it imposes no 256-character limit.
    // Keep null-valued IDs so unknown keys cannot bypass validation.
    questionIds.add(questionId);
    if (confidence === null) continue;
    if (typeof confidence !== 'string' ||
        !(QUIZ_CONFIDENCE_VALUES as readonly string[]).includes(confidence)) {
      throw new InvalidQuizConfidenceError();
    }
    values.set(questionId, confidence as QuizConfidenceValue);
  }
  if (!values.size) return { questionIds, values, digest: null, recorded: false };
  const canonical = [...values].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return { questionIds, values, digest: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), recorded: true };
}

export function assertConfidenceQuestionIds(confidence: ParsedQuizConfidence, questions: readonly { id: string }[]) {
  const questionIds = new Set(questions.map(question => question.id));
  if ([...confidence.questionIds].some(id => !questionIds.has(id))) throw new InvalidQuizConfidenceError();
}
