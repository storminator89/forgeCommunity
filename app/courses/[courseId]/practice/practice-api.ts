/** Private author-only API. All reads bypass caches; all writes carry explicit revisions. */
export type PracticeObjective = { id: string; title: string; description: string; revision: number; updatedAt?: string }
export type PracticeItem = { id: string; objectiveId: string; latestRevision: number; prompt: string; updatedAt?: string }
export type PracticeChoice = { type: 'SINGLE_CHOICE'; prompt: string; options: string[]; correctIndex: number; explanation: string }
export type PracticeRef = { objectiveId: string; objectiveRevision: number; itemId: string; itemRevision: number }
export type PracticeSnapshot = { id: string; coursePublicationId: string; sequence: number; digest: string; itemCount: number; recordedAt?: string }
export type PracticeState = { draft: { revision: number; digest: string; payload: { schemaVersion: 1; items: PracticeRef[] } }; activeCoursePublicationId: string | null; activeSnapshot: PracticeSnapshot | null }
export type PracticeHistory = { activeCoursePublicationId: string | null; snapshots: PracticeSnapshot[]; nextCursor: string | null }
export type PracticePreviewItem = PracticeRef & { objectiveTitle: string; objectiveDescription: string; schemaVersion: 1 } & PracticeChoice
export type PracticePage<T> = { nextCursor: string | null } & T

export class PracticeApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'PracticeApiError' }
}

const pool = '/api/courses/practice'
const id = encodeURIComponent
export const objectiveUrl = (objectiveId: string) => `${pool}/objectives/${id(objectiveId)}`
export const itemUrl = (itemId: string) => `${pool}/items/${id(itemId)}`
export const authorUrl = (courseId: string) => `/api/courses/${id(courseId)}/practice/authoring`

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'Die Übungsdaten konnten nicht verarbeitet werden.'
    throw new PracticeApiError(message, response.status)
  }
  return body as T
}

function json(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const getPracticeState = (courseId: string, signal?: AbortSignal) => request<PracticeState>(authorUrl(courseId), { signal })
export const getObjectives = (signal?: AbortSignal, cursor?: string) => request<PracticePage<{ objectives: PracticeObjective[] }>>(`${pool}/objectives${cursor ? `?cursor=${id(cursor)}` : ''}`, { signal })
export const createObjective = (title: string, description: string) => request<PracticeObjective>(`${pool}/objectives`, json('POST', { title, description }))
export const getObjective = (objectiveId: string) => request<PracticeObjective>(objectiveUrl(objectiveId))
export const reviseObjective = (objectiveId: string, expectedRevision: number, patch: { title: string; description: string }) => request<PracticeObjective>(objectiveUrl(objectiveId), json('PATCH', { expectedRevision, patch }))
export const getItems = (objectiveId: string, signal?: AbortSignal, cursor?: string) => request<PracticePage<{ items: PracticeItem[] }>>(`${objectiveUrl(objectiveId)}/items${cursor ? `?cursor=${id(cursor)}` : ''}`, { signal })
export const createItem = (objectiveId: string, choice: PracticeChoice) => request<PracticeItem>(`${objectiveUrl(objectiveId)}/items`, json('POST', { choice }))
export const getItem = (itemId: string) => request<PracticeItem>(itemUrl(itemId))
export const reviseItem = (itemId: string, expectedRevision: number, choice: PracticeChoice) => request<PracticeItem>(itemUrl(itemId), json('PATCH', { expectedRevision, choice }))
export async function getItemRevision(itemId: string, revision: number, signal?: AbortSignal) {
  const result = await request<{ itemId: string; revision: number; choice: PracticeChoice & { schemaVersion: 1 }; createdAt: string }>(`${itemUrl(itemId)}/revisions/${revision}`, { signal })
  // The stored DTO has schemaVersion; write requests deliberately do not.
  const { schemaVersion: _schemaVersion, ...choice } = result.choice
  return { ...result, choice }
}
export const savePracticeState = (courseId: string, expectedRevision: number, items: PracticeRef[]) => request<PracticeState>(authorUrl(courseId), json('PATCH', { expectedRevision, items }))
export const publishPractice = (courseId: string, expectedRevision: number, expectedActivePublicationId: string, requestId: string) => request<{ snapshot: PracticeSnapshot; unchanged: boolean; replay: boolean }>(`${authorUrl(courseId)}/publish`, json('POST', { expectedRevision, expectedActivePublicationId, requestId }))
export const getPracticeHistory = (courseId: string, cursor?: string) => request<PracticeHistory>(`${authorUrl(courseId)}/history${cursor ? `?cursor=${id(cursor)}` : ''}`)
export const getPracticePreview = (courseId: string, items: PracticeRef[]) => request<{ items: PracticePreviewItem[] }>(`${authorUrl(courseId)}/preview`, json('POST', { items }))
