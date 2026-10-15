import 'server-only';

/** A null pointer is never an implicit publication. */
export const publishedCourseWhere = { activePublicationId: { not: null } } as const;

/** Archived content is retained for evidence and restore, never learner projection. */
export const activeCourseContentWhere = { archivedAt: null } as const;
