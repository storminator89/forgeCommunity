/** Immutable question provenance; null is the existing whole-course scope. */
export type CourseQaLessonContextPair = { publicationId: string; contentId: string };

/** Only a currently readable lesson may disclose its identity or label. */
export type CourseQaCurrentLessonContext = CourseQaLessonContextPair & {
  status: 'current';
  title: string;
  href: string;
};
export type CourseQaUnavailableLessonContext = { status: 'unavailable' };
export type CourseQaLessonContext = CourseQaCurrentLessonContext | CourseQaUnavailableLessonContext | null;
export type CourseQaScope = { kind: 'course' } | {
  kind: 'lesson';
  lessonContext: CourseQaCurrentLessonContext | CourseQaUnavailableLessonContext;
};
export type CourseQaContextEntry = { id: string; lessonContext: CourseQaLessonContext };
