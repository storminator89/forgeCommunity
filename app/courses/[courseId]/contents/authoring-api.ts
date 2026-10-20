import type { CourseContent } from './types'
import { QUIZ_MEDIA_CAPABILITY, QUIZ_MEDIA_CAPABILITY_HEADER } from '@/lib/quiz-media-compatibility'
import { parseCanonicalQuizOptionAssetUrl } from '@/lib/quiz-media-contract'
import { prepareCourseOptionImage } from '@/lib/course-option-image-prepare'

/** Private author DTO. The published learner projection is deliberately separate. */
export interface AuthorNode {
  id: string
  parentId: string | null
  title: string
  type: CourseContent['type'] | null
  content: string
  order: number
  prerequisiteIds?: string[]
  releaseOn?: string
}

export interface AuthorPayload {
  schemaVersion: 1
  title: string
  description: string
  startDate: string | null
  endDate: string | null
  imageUrl: string | null
  contents: AuthorNode[]
}

export interface AuthorDraft { revision: number; digest: string; payload: AuthorPayload }
export interface ActivePublication { id: string; sequence: number; digest: string }
export interface AuthorState { draft: AuthorDraft; activePublication: ActivePublication | null }
export interface PublicationImpact {
  added: string[]
  removed: string[]
  changed: string[]
  renamedOrReordered: string[]
  prerequisitesChanged: string[]
  releaseScheduleChanged?: Array<{ id: string; title: string; before: string | null; after: string | null }>
  enrolledLearners: number
  completionMayChange: boolean
  rewardsMayChange: boolean
  issuedCertificatesStayValid: true
}
export interface PublicationReview {
  ready: boolean
  blockers: string[]
  impact: PublicationImpact
  revision: number
  digest: string
  activePublicationId: string | null
}
export interface PublicationRecord extends ActivePublication { source: string; recordedAt: string }
export type AuthorOperation =
  | { kind: 'setMetadata'; patch: Partial<Pick<AuthorPayload, 'title' | 'description' | 'startDate' | 'endDate' | 'imageUrl'>> }
  | { kind: 'insertNode'; node: Pick<AuthorNode, 'id' | 'title' | 'type' | 'content'>; parentId: string | null; afterId: string | null }
  | { kind: 'updateNode'; id: string; patch: Partial<Pick<AuthorNode, 'title' | 'type' | 'content'>> }
  | { kind: 'moveNode'; id: string; parentId: string | null; afterId: string | null }
  | { kind: 'setPrerequisites'; id: string; prerequisiteIds: string[] }
  | { kind: 'setReleaseOn'; id: string; releaseOn: string | null }
  | { kind: 'deleteNode'; id: string }

export class AuthoringError extends Error {
  constructor(message: string, public status: number, public errorCode?: string) { super(message); this.name = 'AuthoringError' }
}

export async function authorResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown; errorCode?: unknown } | null
    if (body?.errorCode === 'UPLOAD_UNCERTAIN') throw new AuthoringError('Der Upload konnte nicht sicher bestätigt werden. Ein privates Bild kann bereits vorhanden sein, wurde aber hier nicht angehängt. Es wird nicht automatisch erneut hochgeladen.', response.status, 'UPLOAD_UNCERTAIN')
    if (body?.code === 'QUIZ_MEDIA_REFRESH_REQUIRED' && typeof body.error === 'string') {
      throw new AuthoringError(body.error, response.status)
    }
    const defaultMessage: Record<number, string> = {
      401: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
      403: 'Du hast keine Berechtigung für diesen Kursentwurf.',
      404: 'Der Kursentwurf ist nicht mehr verfügbar.',
      409: 'Die Veröffentlichung hat sich geändert. Prüfe den aktuellen Stand erneut.',
      412: 'Der Entwurf wurde an anderer Stelle geändert. Deine lokalen Änderungen bleiben erhalten.',
      428: 'Die erwartete Entwurfsversion fehlt. Bitte lade die Seite erneut.',
    }
    throw new AuthoringError(defaultMessage[response.status] || (typeof body?.error === 'string' ? body.error : fallback), response.status)
  }
  return response.json() as Promise<T>
}

export function authorUrl(courseId: string, suffix = ''): string {
  return `/api/courses/${encodeURIComponent(courseId)}/authoring${suffix}`
}

export async function getAuthorState(courseId: string, signal?: AbortSignal): Promise<AuthorState> {
  return authorResponse<AuthorState>(await fetch(authorUrl(courseId), { cache: 'no-store', signal, headers: { [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY } }), 'Der Entwurf konnte nicht geladen werden.')
}

export async function patchAuthorState(courseId: string, expectedRevision: number, operation: AuthorOperation): Promise<AuthorState> {
  return authorResponse<AuthorState>(await fetch(authorUrl(courseId), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY }, cache: 'no-store',
    body: JSON.stringify({ expectedRevision, operation }),
  }), 'Der Entwurf konnte nicht gespeichert werden. Deine lokalen Änderungen bleiben erhalten.')
}

export async function discardAuthorDraft(courseId: string, expectedRevision: number): Promise<AuthorState> {
  return authorResponse<AuthorState>(await fetch(authorUrl(courseId), {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY }, cache: 'no-store', body: JSON.stringify({ expectedRevision }),
  }), 'Der Entwurf konnte nicht verworfen werden.')
}

export async function getPublicationReview(courseId: string, draft: AuthorDraft, active: ActivePublication | null): Promise<PublicationReview> {
  const query = new URLSearchParams({ expectedRevision: String(draft.revision), expectedActivePublicationId: active?.id ?? 'null' })
  return authorResponse<PublicationReview>(await fetch(authorUrl(courseId, `/review?${query}`), { cache: 'no-store', headers: { [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY } }), 'Die Veröffentlichungsprüfung ist fehlgeschlagen.')
}

export async function publishAuthorDraft(courseId: string, draft: AuthorDraft, active: ActivePublication | null, requestId: string): Promise<{ publication: ActivePublication; unchanged: boolean }> {
  return authorResponse(await fetch(authorUrl(courseId, '/publish'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY }, cache: 'no-store',
    body: JSON.stringify({ expectedRevision: draft.revision, expectedActivePublicationId: active?.id ?? null, requestId }),
  }), 'Die Veröffentlichung konnte nicht abgeschlossen werden. Prüfe den Stand, bevor du es erneut versuchst.')
}

export async function getPublicationHistory(courseId: string): Promise<PublicationRecord[]> {
  const result = await authorResponse<{ publications: PublicationRecord[] }>(await fetch(authorUrl(courseId, '/history'), { cache: 'no-store', headers: { [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY } }), 'Der Versionsverlauf konnte nicht geladen werden.')
  return result.publications
}

export async function restorePublication(courseId: string, publicationId: string, expectedRevision: number): Promise<AuthorState> {
  return authorResponse<AuthorState>(await fetch(authorUrl(courseId, '/restore'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY }, cache: 'no-store',
    body: JSON.stringify({ publicationId, expectedRevision }),
  }), 'Die Version konnte nicht als Entwurf wiederhergestellt werden.')
}

/** A single POST only. An ambiguous network outcome is never automatically retried. */
export async function uploadDraftImage(courseId: string, file: File, signal?: AbortSignal): Promise<{ id: string; url: string; mimeType: string; size: number }> {
  if (signal?.aborted) throw new DOMException('Upload abgebrochen.', 'AbortError')
  const prepared = await prepareCourseOptionImage(file)
  if (signal?.aborted) throw new DOMException('Upload abgebrochen.', 'AbortError')
  const data = new FormData()
  data.append('file', prepared)
  const result = await authorResponse<{ id: string; url: string; mimeType: string; size: number }>(await fetch(authorUrl(courseId, '/assets'), {
    method: 'POST', body: data, signal, cache: 'no-store', headers: { [QUIZ_MEDIA_CAPABILITY_HEADER]: QUIZ_MEDIA_CAPABILITY },
  }), 'Der Upload wurde nicht bestätigt. Es wird nicht automatisch erneut hochgeladen. Prüfe den Stand oder wähle die Datei bewusst erneut.')
  const canonical = parseCanonicalQuizOptionAssetUrl(result?.url, courseId)
  if (!canonical.ok || canonical.value.assetId !== result.id || result.mimeType !== 'image/png' || !Number.isInteger(result.size) || result.size < 1 || result.size > 5 * 1024 * 1024) {
    throw new Error('Die Upload-Antwort ist ungültig. Das private Bild wurde nicht angehängt.')
  }
  return { id: result.id, url: canonical.value.src, mimeType: result.mimeType, size: result.size }
}

/** Keep flat DTO bytes and nullable legacy types untouched until a node is edited. */
export function authorTree(payload: AuthorPayload, courseId: string): CourseContent[] {
  const nodes = new Map(payload.contents.map(node => [node.id, { ...node, courseId, type: node.type ?? 'TEXT', subContents: [] as CourseContent[] }]))
  const roots: CourseContent[] = []
  for (const node of payload.contents) {
    const item = nodes.get(node.id)!
    const ancestors = new Set([node.id])
    let ancestor = node.parentId
    let cyclic = false
    while (ancestor) {
      if (ancestors.has(ancestor)) { cyclic = true; break }
      ancestors.add(ancestor)
      ancestor = nodes.get(ancestor)?.parentId ?? null
    }
    const parent = !cyclic && node.parentId ? nodes.get(node.parentId) : null
    if (parent) parent.subContents.push(item)
    else roots.push(item)
  }
  const order = (items: CourseContent[]) => {
    items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    items.forEach(item => order(item.subContents ?? []))
  }
  order(roots)
  return roots
}

export function siblingIds(payload: AuthorPayload, parentId: string | null, excludeId?: string): string[] {
  return payload.contents.filter(node => node.parentId === parentId && node.id !== excludeId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(node => node.id)
}
