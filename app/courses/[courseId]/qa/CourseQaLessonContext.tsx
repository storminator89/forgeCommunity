import Link from 'next/link'
import type { CourseQaLessonContext, CourseQaLessonContextPair, CourseQaScope } from '@/lib/course-qa-context-contract'

export const unavailableLessonLabel = 'Früherer oder nicht verfügbarer Lektionskontext'

/** Rebuild the read-only projection. Unavailable contexts never retain metadata. */
export function readLessonContext(value: unknown, courseId: string): CourseQaLessonContext {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Lektionskontext konnte nicht geprüft werden.')
  const context = value as Record<string, unknown>
  if (context.status === 'unavailable') return { status: 'unavailable' }
  if (context.status !== 'current' || typeof context.publicationId !== 'string' || !context.publicationId ||
      typeof context.contentId !== 'string' || !context.contentId || typeof context.title !== 'string' || !context.title.trim() ||
      context.href !== `/courses/${encodeURIComponent(courseId)}/contents?content=${encodeURIComponent(context.contentId)}`) {
    throw new Error('Lektionskontext konnte nicht geprüft werden.')
  }
  return { status: 'current', publicationId: context.publicationId, contentId: context.contentId, title: context.title, href: context.href as string }
}

export function readQaScope(value: unknown, courseId: string, pair: CourseQaLessonContextPair | null): CourseQaScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Der Fragenbereich konnte nicht geprüft werden.')
  const scope = value as Record<string, unknown>
  if (!pair && scope.kind === 'course') return { kind: 'course' }
  if (pair && scope.kind === 'lesson') {
    const lessonContext = readLessonContext(scope.lessonContext, courseId)
    if (lessonContext && (lessonContext.status === 'unavailable' ||
        (lessonContext.publicationId === pair.publicationId && lessonContext.contentId === pair.contentId))) return { kind: 'lesson', lessonContext }
  }
  throw new Error('Der Fragenbereich konnte nicht geprüft werden.')
}

export function suppressLessonContext(context: CourseQaLessonContext): CourseQaLessonContext {
  return context === null ? null : { status: 'unavailable' }
}

export function LessonContextLabel({ context, link = false }: { context: CourseQaLessonContext; link?: boolean }) {
  if (!context) return null
  if (context.status === 'unavailable') return <span className="block break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{unavailableLessonLabel}</span>
  return <span className="block min-w-0 text-sm"><span className="block break-words text-muted-foreground [overflow-wrap:anywhere]">Zu dieser Lektion: {context.title}</span>{link && <Link href={context.href} className="mt-1 inline-flex min-h-11 items-center rounded-sm text-primary underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Lektion öffnen</Link>}</span>
}
