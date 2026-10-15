/** Learner-only, no-store practice API. Reading due state must not reserve an item. */
export type PracticeLearnerStatus = 'off' | 'unpublished' | 'archived' | 'available' | 'paused' | 'ready' | 'active' | 'complete'
export type PracticePending = {
  reservationId: string
  ordinal: number
  item: { itemId: string; itemRevision: number; objectiveTitle: string; prompt: string; options: string[] }
}
export type PracticeLearnerState = {
  status: PracticeLearnerStatus
  dueCount: number
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

function post<T>(courseId: string, action: string, body: unknown): Promise<T> {
  return request<T>(`${base(courseId)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export const getLearnerPractice = (courseId: string, signal?: AbortSignal) =>
  request<PracticeLearnerState>(base(courseId), { signal })
export const optInPractice = (courseId: string) => post<unknown>(courseId, 'opt-in', {})
export const pausePractice = (courseId: string) => post<unknown>(courseId, 'pause', {})
export const optOutPractice = (courseId: string) => post<unknown>(courseId, 'opt-out', {})
export const startPractice = (courseId: string) => post<unknown>(courseId, 'start', {})
export const nextPractice = (courseId: string, sessionId: string) => post<unknown>(courseId, 'next', { sessionId })
export const answerPractice = (courseId: string, input: { sessionId: string; reservationId: string; submissionId: string; optionIndex: number; confidence: AnswerConfidence }) =>
  post<AnswerFeedback>(courseId, 'answer', input)
export const preparePracticeReset = (courseId: string) => post<{ token: string }>(courseId, 'reset/prepare', {})
export const resetPractice = (courseId: string, token: string) => post<unknown>(courseId, 'reset', { token, confirmation: 'RESET_MY_PRACTICE' })
