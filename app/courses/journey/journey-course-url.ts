/** A URL can select only a course already present in this learner's list. */
export function resolveJourneyCourseId(search: string, courses: readonly { id: string }[]): string | null {
  const values = new URLSearchParams(search).getAll('course');
  const requested = values.length === 1 ? values[0] : null;
  return courses.find(course => course.id === requested)?.id ?? courses[0]?.id ?? null;
}

/** Deliberate course changes write only a local selection and safe fragment. */
export function journeyCourseHref(courseId: string, hash = '') {
  const params = new URLSearchParams({ course: courseId });
  const fragment = hash.startsWith('#') && !/[\u0000-\u001f\u007f]/.test(hash) ? hash : '';
  return `/courses/journey?${params.toString()}${fragment}`;
}
