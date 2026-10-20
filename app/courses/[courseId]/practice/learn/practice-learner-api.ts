import type { PracticeAvailability } from '@/lib/formative-practice-availability'

/** Learner-only, no-store practice API. Reading due state must not reserve an item. */
export type PracticeLearnerStatus = 'off' | 'unpublished' | 'archived' | 'available' | 'paused' | 'ready' | 'active' | 'complete' | 'unavailable'
export type PracticePending = {
  reservationId: string
  ordinal: number
  questionContext?: 'sameObjectiveAfterConfidentError'
  item: { itemId: string; itemRevision: number; objectiveTitle: string; prompt: string; options: string[] }
}
export type PracticeLearnerState = {
  status: PracticeLearnerStatus
  dueCount: number
  availability: PracticeAvailability
  nextAvailableAt: string | null
  publicationId?: string
  snapshotId?: string
  session?: { id: string; answeredCount: number; pending?: PracticePending }
}
export type AnswerConfidence = 'SURE' | 'SOMEWHAT_SURE' | 'UNSURE' | 'GUESSED' | null
export type AnswerFeedback = { correct: boolean; correctIndex?: number; explanation?: string; nextDueAt?: string | null; canContinue: boolean; answeredCount: number }

export class PracticeLearnerApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'PracticeLearnerApiError' }
}

const base = (courseId: string) => `/api/courses/${encodeURIComponent(courseId)}/practice/learner`

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : response.status === 403 ? 'Du hast keinen Zugang zu dieser Übung.'
        : response.status === 404 ? 'Dieser Kurs ist nicht verfügbar.'
          : 'Die Übung konnte nicht verarbeitet werden.'
    throw new PracticeLearnerApiError(message, response.status)
  }
  return body as T
}

function post<T>(courseId: string, action: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(`${base(courseId)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
}

export const getLearnerPractice = (courseId: string, signal?: AbortSignal) =>
  request<PracticeLearnerState>(base(courseId), { signal })
export const optInPractice = (courseId: string, signal?: AbortSignal) => post<unknown>(courseId, 'opt-in', {}, signal)
export const pausePractice = (courseId: string, signal?: AbortSignal) => post<unknown>(courseId, 'pause', {}, signal)
export const optOutPractice = (courseId: string, signal?: AbortSignal) => post<unknown>(courseId, 'opt-out', {}, signal)
export const startPractice = (courseId: string, signal?: AbortSignal) => post<unknown>(courseId, 'start', {}, signal)
export const closePractice = (courseId: string, sessionId: string, signal?: AbortSignal) => post<unknown>(courseId, 'close', { sessionId }, signal)
export const nextPractice = (courseId: string, sessionId: string, signal?: AbortSignal) => post<unknown>(courseId, 'next', { sessionId }, signal)
export const answerPractice = (courseId: string, input: { sessionId: string; reservationId: string; submissionId: string; optionIndex: number; confidence: AnswerConfidence }, signal?: AbortSignal) =>
  post<AnswerFeedback>(courseId, 'answer', input, signal)
export const preparePracticeReset = (courseId: string, signal?: AbortSignal) => post<{ token: string }>(courseId, 'reset/prepare', {}, signal)
export const resetPractice = (courseId: string, token: string, signal?: AbortSignal) => post<unknown>(courseId, 'reset', { token, confirmation: 'RESET_MY_PRACTICE' }, signal)
