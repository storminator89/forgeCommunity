/**
 * STAGED, INACTIVE: compatibility and media-structure policy only.
 * Capability is not authentication, course authorization, publication/path
 * access, snapshot identity, a full quiz parser or permission to read assets.
 */
import { hasQuizOptionImagesField, parseQuizOptionImages } from './quiz-media-contract';

export const QUIZ_MEDIA_CAPABILITY_HEADER = 'X-Forge-Quiz-Media';
export const QUIZ_MEDIA_CAPABILITY = 'option-images-v1';

export interface QuizMediaNodeSnapshot {
  readonly id: string;
  readonly type: string | null;
  readonly content: string;
}

export type QuizMediaGateErrorCode = 'INVALID_QUIZ_MEDIA' | 'QUIZ_MEDIA_REFRESH_REQUIRED' | 'COURSE_SCOPED_QUIZ_MEDIA';
export type QuizMediaGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: {
      readonly code: QuizMediaGateErrorCode;
      readonly status: 400 | 409;
      readonly path: string;
      readonly message: string;
    } };

interface MediaInspection {
  readonly hasMediaField: boolean;
  readonly invalidPath?: string;
}

const MAX_NODE_CHARACTERS = 100_000;
const MAX_NODES = 500;

function invalid(path: string): QuizMediaGateResult {
  return { ok: false, error: { code: 'INVALID_QUIZ_MEDIA', status: 400, path,
    message: 'Die Quiz-Bilddaten sind ungültig. Bitte prüfe den Entwurf.' } };
}

function refresh(): QuizMediaGateResult {
  return { ok: false, error: { code: 'QUIZ_MEDIA_REFRESH_REQUIRED', status: 409, path: 'capability',
    message: 'Dieses Quiz enthält Antwortbilder. Bitte lade die Seite neu, bevor du fortfährst.' } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataProperty(value: object, key: string): PropertyDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor : undefined;
}

function denseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) if (!dataProperty(value, String(index))) return false;
  return true;
}

/** Only question-level media is inspected. Hidden solution/explanation strings
 * are never harvested as image references or recursively treated as fields. */
function inspectQuiz(quiz: unknown, courseId: string, path: string): MediaInspection {
  if (!isRecord(quiz) || !dataProperty(quiz, 'questions') || !denseArray(quiz.questions)) {
    return { hasMediaField: false, invalidPath: `${path}.questions` };
  }
  let hasMediaField = false;
  for (const [index, question] of quiz.questions.entries()) {
    const questionPath = `${path}.questions[${index}]`;
    if (!isRecord(question)) return { hasMediaField, invalidPath: questionPath };
    // Presence comes BEFORE parsing. Malformed/all-null/unsupported fields can
    // never disappear through normalization or an existing parser's allowlist.
    if (!hasQuizOptionImagesField(question)) continue;
    hasMediaField = true;
    const parsed = parseQuizOptionImages(question, courseId);
    if (!parsed.ok) return { hasMediaField, invalidPath: `${questionPath}.${parsed.error.path}` };
  }
  return { hasMediaField };
}

/** Mirrors the existing explicit-QUIZ / legacy TEXT-null quiz classification.
 * Malformed quiz-like JSON never falls through to an HTML/text ACL scanner.
 * This inspection itself neither enumerates refs nor grants asset authority. */
function inspectNode(node: QuizMediaNodeSnapshot, courseId: string): MediaInspection {
  const path = `contents[${node.id}]`;
  if (node.type !== 'QUIZ' && node.type !== 'TEXT' && node.type !== null) return { hasMediaField: false };
  if (typeof node.content !== 'string' || node.content.length > MAX_NODE_CHARACTERS) return { hasMediaField: false, invalidPath: path };
  let parsed: unknown;
  try { parsed = JSON.parse(node.content); }
  catch {
    if (node.type === 'QUIZ' || (node.content.trimStart().startsWith('{') && /["']questions["']\s*:/.test(node.content))) {
      return { hasMediaField: /["']optionImages["']\s*:/.test(node.content), invalidPath: `${path}.content` };
    }
    return { hasMediaField: false };
  }
  if (node.type !== 'QUIZ' && !(isRecord(parsed) && Object.hasOwn(parsed, 'questions'))) return { hasMediaField: false };
  return inspectQuiz(parsed, courseId, path);
}

function validNodes(nodes: ReadonlyArray<QuizMediaNodeSnapshot>): boolean {
  if (!denseArray(nodes) || nodes.length > MAX_NODES) return false;
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!isRecord(node) || !dataProperty(node, 'id') || !dataProperty(node, 'type') || !dataProperty(node, 'content') ||
        typeof node.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(node.id) || ids.has(node.id) ||
        (node.type !== null && typeof node.type !== 'string') || typeof node.content !== 'string') return false;
    ids.add(node.id);
  }
  return true;
}

/** Compare STORED preimage to fully applied proposed result, BEFORE reference
 * collection/CAS. Detects omitted media, changed type/body, delete and subtree
 * deletion without trusting a caller-supplied operation kind or media flag.
 * Unchanged node bodies and metadata-only edits preserve legacy behavior. */
export function checkQuizMediaAuthorMutation(courseId: string, capability: unknown,
  before: ReadonlyArray<QuizMediaNodeSnapshot>, after: ReadonlyArray<QuizMediaNodeSnapshot>): QuizMediaGateResult {
  if (!validNodes(before) || !validNodes(after)) return invalid('contents');
  const oldNodes = new Map(before.map(node => [node.id, node]));
  const newNodes = new Map(after.map(node => [node.id, node]));
  let needsCapability = false;
  for (const id of new Set([...oldNodes.keys(), ...newNodes.keys()])) {
    const oldNode = oldNodes.get(id);
    const newNode = newNodes.get(id);
    if (oldNode && newNode && oldNode.type === newNode.type && oldNode.content === newNode.content) continue;
    if (oldNode) {
      const inspected = inspectNode(oldNode, courseId);
      // An unreadable quiz preimage is conservatively treated as incompatible;
      // a capable current editor can still repair it by proposing valid data.
      needsCapability ||= inspected.hasMediaField || inspected.invalidPath !== undefined;
    }
    if (newNode) {
      const inspected = inspectNode(newNode, courseId);
      if (inspected.invalidPath !== undefined) return invalid(inspected.invalidPath);
      needsCapability ||= inspected.hasMediaField;
    }
  }
  return needsCapability && capability !== QUIZ_MEDIA_CAPABILITY ? refresh() : { ok: true };
}

/** For review/publish, pass saved active publication as before and saved draft
 * as after. For restore/discard pass current draft and exact reset target.
 * Reads/history are not mutations and do not require this negotiation. */
export function checkQuizMediaAuthorSnapshot(courseId: string, capability: unknown,
  before: ReadonlyArray<QuizMediaNodeSnapshot>, after: ReadonlyArray<QuizMediaNodeSnapshot>): QuizMediaGateResult {
  if (!validNodes(before) || !validNodes(after)) return invalid('contents');
  let needsCapability = false;
  for (const node of before) {
    const inspected = inspectNode(node, courseId);
    needsCapability ||= inspected.hasMediaField || inspected.invalidPath !== undefined;
  }
  for (const node of after) {
    const inspected = inspectNode(node, courseId);
    if (inspected.invalidPath !== undefined) return invalid(inspected.invalidPath);
    needsCapability ||= inspected.hasMediaField;
  }
  return needsCapability && capability !== QUIZ_MEDIA_CAPABILITY ? refresh() : { ok: true };
}

/** Call ONLY for a NEW attempt, after authenticated current-enrollment/active
 * snapshot checks and AFTER the historical receipt replay branch. Existing
 * receipt replay must not mint fresh credit or be rejected for missing header.
 * Prefer raw stored quiz JSON over a parser that could strip unknown fields. */
export function checkQuizMediaNewLearnerAttempt(courseId: string, capability: unknown, rawQuiz: unknown): QuizMediaGateResult {
  let parsed = rawQuiz;
  if (typeof parsed === 'string') {
    if (parsed.length > MAX_NODE_CHARACTERS) return invalid('quiz');
    try { parsed = JSON.parse(parsed); } catch { return invalid('quiz'); }
  }
  const inspected = inspectQuiz(parsed, courseId, 'quiz');
  if (inspected.invalidPath !== undefined) return invalid(inspected.invalidPath);
  return inspected.hasMediaField && capability !== QUIZ_MEDIA_CAPABILITY ? refresh() : { ok: true };
}

/** Call before question-bank allowlist reconstruction. Own property presence
 * rejects even malformed/all-null data: course media cannot silently disappear
 * into the owner-wide, cross-course text pool. */
export function checkQuizMediaQuestionPoolInput(rawQuestion: unknown): QuizMediaGateResult {
  return hasQuizOptionImagesField(rawQuestion) ? { ok: false, error: {
    code: 'COURSE_SCOPED_QUIZ_MEDIA', status: 400, path: 'optionImages',
    message: 'Antwortbilder gehören zu diesem Kurs. Bildfragen können noch nicht im kursübergreifenden Fragenpool gespeichert werden.',
  } } : { ok: true };
}
