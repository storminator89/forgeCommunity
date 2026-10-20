import 'server-only';

import { d1AnalyticsSnapshot } from '@/lib/server/d1-course-analytics-read';
import { contentQuiz, courseContentRevision, courseLeaves } from '@/lib/server/course-progress';
import { CoursePathError, prepareCoursePath, publicationPathNodes } from '@/lib/server/course-path';

export const ANALYTICS_PAGE_SIZE = 25;
export const ANALYTICS_MAX_PAGE_SIZE = 50;
export const ANALYTICS_MAX_COHORT = 1000;
export const ANALYTICS_MAX_EXPORT = 500;
const MAX_PROGRESS_ROWS = 100_000;
const MAX_ATTEMPT_ROWS = 20_000;

export type AnalyticsStatus = 'all' | 'not-started' | 'in-progress' | 'current-complete' | 'unmeasurable' | 'needs-quiz-review';
export type AnalyticsQuery = { page: number; pageSize: number; status: AnalyticsStatus; search: string };

export class AnalyticsError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

function positiveInt(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d{0,3}$/.test(value)) throw new AnalyticsError('Ungültige Seiteneinstellung.', 400);
  const number = Number(value);
  if (number > max) throw new AnalyticsError('Ungültige Seiteneinstellung.', 400);
  return number;
}

export function parseAnalyticsQuery(params: URLSearchParams): AnalyticsQuery {
  const allowed = new Set(['page', 'pageSize', 'status', 'search']);
  if ([...params.keys()].some(key => !allowed.has(key))) throw new AnalyticsError('Unbekannter Filter.', 400);
  const status = params.get('status') ?? 'all';
  if (!['all', 'not-started', 'in-progress', 'current-complete', 'unmeasurable', 'needs-quiz-review'].includes(status)) {
    throw new AnalyticsError('Ungültiger Statusfilter.', 400);
  }
  const search = (params.get('search') ?? '').trim();
  if (search.length > 64 || /[\u0000-\u001f\u007f]/.test(search)) throw new AnalyticsError('Ungültige Suche.', 400);
  return { page: positiveInt(params.get('page'), 1, 1000), pageSize: positiveInt(params.get('pageSize'), ANALYTICS_PAGE_SIZE, ANALYTICS_MAX_PAGE_SIZE),
    status: status as AnalyticsStatus, search };
}

type Actor = { id: string; role?: string | null };
type CurrentStatus = Exclude<AnalyticsStatus, 'all' | 'needs-quiz-review'>;
type LearnerRow = {
  enrollmentId: string; displayName: string; enrolledAt: string;
  currentStatus: CurrentStatus; completedLeaves: number; totalLeaves: number;
  firstIncomplete: { id: string; title: string } | null;
  quizAttempts: number; quizNeedsReview: number;
  latestQuiz: { title: string; score: number; passed: boolean; submittedAt: string } | null;
  historicalCompletedAt: string | null; certificateIssuedAt: string | null;
};

type Snapshot = {
  course: { id: string; title: string; activePublicationId: string | null };
  summary: { enrolled: number; currentComplete: number; notStarted: number; inProgress: number; unmeasurable: number;
    quizSignals: Array<{ contentId: string; title: string; attemptedLearners: number; latestFailureLearners: number }> };
  learners: LearnerRow[];
};

async function readSnapshot(courseId: string, actor: Actor): Promise<Snapshot> {
  const { course, publication, contents, enrollments, progress, assignmentPasses, assignmentActivity, attempts, certificates } =
    await d1AnalyticsSnapshot(courseId, actor);
  if (course.activePublicationId && (!publication || publication.courseId !== courseId)) {
    throw new CoursePathError('Course publication is unavailable', 409);
  }
  const pathNodes = publication ? publicationPathNodes(publication.payload) : [];
  const projected = new Map(contents.map(content => [content.id, content]));
  if (projected.size !== pathNodes.length || pathNodes.some(node => {
    const row = projected.get(node.id);
    return !row || row.parentId !== node.parentId || row.order !== node.order;
  })) throw new CoursePathError('Published course contents do not match the active publication', 409);
  const pathAccess = prepareCoursePath(pathNodes);
  const leaves = courseLeaves(contents).reverse();
  const revisions = new Map(leaves.map(content => [content.id, courseContentRevision(content)]));
  const titles = new Map(contents.map(content => [content.id, content.title]));
  const quizLeaves = leaves.filter(content => Boolean(contentQuiz(content)));
  const quizIds = new Set(quizLeaves.map(content => content.id));
  const assignmentLeaves = leaves.filter(content => content.type === 'ASSIGNMENT');
  const assignmentIds = new Set(assignmentLeaves.map(content => content.id));
  if (progress.length > MAX_PROGRESS_ROWS) throw new AnalyticsError('Zu viele Fortschrittsdaten für eine verlässliche Analyse.', 413);
  const validProgress = new Map<string, Set<string>>();
  for (const item of progress) {
    // Assignment progress is only a UI mirror; latest current grading is proof.
    if (assignmentIds.has(item.contentId) || revisions.get(item.contentId) !== item.revision) continue;
    const set = validProgress.get(item.userId) ?? new Set<string>();
    set.add(item.contentId);
    validProgress.set(item.userId, set);
  }
  for (const item of assignmentPasses) {
    const set = validProgress.get(item.userId) ?? new Set<string>();
    set.add(item.contentId);
    validProgress.set(item.userId, set);
  }
  const submittedAssignmentUsers = new Set(assignmentActivity);

  if (attempts.length > MAX_ATTEMPT_ROWS) throw new AnalyticsError('Zu viele Quizversuche für eine verlässliche Analyse.', 413);
  type Attempt = (typeof attempts)[number];
  const attemptsByLearner = new Map<string, Attempt[]>();
  const latestByQuiz = new Map<string, Map<string, Attempt>>();
  for (const item of attempts) {
    if (revisions.get(item.contentId) !== item.revision) continue;
    const byLearner = attemptsByLearner.get(item.userId) ?? [];
    byLearner.push(item);
    attemptsByLearner.set(item.userId, byLearner);
    const byQuiz = latestByQuiz.get(item.contentId) ?? new Map<string, Attempt>();
    if (!byQuiz.has(item.userId)) byQuiz.set(item.userId, item);
    latestByQuiz.set(item.contentId, byQuiz);
  }
  const issuedAt = new Map(certificates.map(row => [row.userId, row._min.issuedAt]));

  const learners: LearnerRow[] = enrollments.map(enrollment => {
    const rawCompleted = validProgress.get(enrollment.userId) ?? new Set<string>();
    const access = pathAccess(rawCompleted);
    const completed = new Set(leaves.filter(content => access.get(content.id)?.completed).map(content => content.id));
    const totalLeaves = leaves.length;
    const learnerAttempts = attemptsByLearner.get(enrollment.userId) ?? [];
    const currentStatus: CurrentStatus = !course.activePublicationId || !totalLeaves ? 'unmeasurable'
      : completed.size === totalLeaves ? 'current-complete'
        : rawCompleted.size || learnerAttempts.length || submittedAssignmentUsers.has(enrollment.userId) ? 'in-progress' : 'not-started';
    const first = currentStatus === 'current-complete' || currentStatus === 'unmeasurable' ? null
      : leaves.find(content => !completed.has(content.id)) ?? null;
    const needsReview = quizLeaves.filter(content => latestByQuiz.get(content.id)?.get(enrollment.userId)?.passed === false).length;
    const latest = learnerAttempts[0];
    return {
      enrollmentId: enrollment.id, displayName: enrollment.user.name?.trim() || 'Unbenannte Person',
      enrolledAt: enrollment.enrolledAt.toISOString(), currentStatus, completedLeaves: completed.size, totalLeaves,
      firstIncomplete: first ? { id: first.id, title: titles.get(first.id) ?? 'Kursinhalt' } : null,
      quizAttempts: learnerAttempts.length, quizNeedsReview: needsReview,
      latestQuiz: latest ? { title: titles.get(latest.contentId) ?? 'Quiz', score: latest.score, passed: latest.passed, submittedAt: latest.submittedAt.toISOString() } : null,
      historicalCompletedAt: enrollment.completedAt?.toISOString() ?? null,
      certificateIssuedAt: issuedAt.get(enrollment.userId)?.toISOString() ?? null,
    };
  });
  const summary = {
    enrolled: learners.length,
    currentComplete: learners.filter(row => row.currentStatus === 'current-complete').length,
    notStarted: learners.filter(row => row.currentStatus === 'not-started').length,
    inProgress: learners.filter(row => row.currentStatus === 'in-progress').length,
    unmeasurable: learners.filter(row => row.currentStatus === 'unmeasurable').length,
    quizSignals: quizLeaves.map(content => {
      const latest = [...(latestByQuiz.get(content.id)?.values() ?? [])];
      return { contentId: content.id, title: titles.get(content.id) ?? 'Quiz', attemptedLearners: latest.length,
        latestFailureLearners: latest.filter(attempt => !attempt.passed).length };
    }).filter(signal => signal.attemptedLearners > 0)
      .sort((a, b) => b.latestFailureLearners - a.latestFailureLearners || b.attemptedLearners - a.attemptedLearners || a.contentId.localeCompare(b.contentId)).slice(0, 3),
  };
  return { course: { id: course.id, title: course.title, activePublicationId: course.activePublicationId }, summary, learners };
}

export async function courseAnalytics(courseId: string, actor: Actor, query: AnalyticsQuery, exportAll = false) {
  const snapshot = await readSnapshot(courseId, actor);
  const needle = query.search.toLocaleLowerCase('de');
  const filtered = snapshot.learners.filter(row => (!needle || row.displayName.toLocaleLowerCase('de').includes(needle)) &&
    (query.status === 'all' || (query.status === 'needs-quiz-review' ? row.quizNeedsReview > 0 : row.currentStatus === query.status)));
  if (exportAll && filtered.length > ANALYTICS_MAX_EXPORT) {
    throw new AnalyticsError(`Der Export enthält ${filtered.length} Zeilen und überschreitet das Limit von ${ANALYTICS_MAX_EXPORT}. Bitte Filter eingrenzen. Es wurde keine unvollständige Datei erzeugt.`, 413);
  }
  return { course: snapshot.course, summary: snapshot.summary, filters: { status: query.status, search: query.search },
    pagination: { page: query.page, pageSize: query.pageSize, total: filtered.length, pages: Math.ceil(filtered.length / query.pageSize) },
    learners: exportAll ? filtered : filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) };
}

/** Escape every textual cell, including leading whitespace/control characters before formula prefixes. */
export function csvCell(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  const guarded = /^[\s\uFEFF]*[=+\-@]/.test(clean) ? `'${clean}` : clean;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function analyticsCsv(rows: LearnerRow[]): string {
  if (rows.length > ANALYTICS_MAX_EXPORT) throw new AnalyticsError('Zu viele Zeilen für den CSV-Export.', 413);
  const header = ['Name', 'Einschreibungs-ID', 'Eingeschrieben am', 'Aktueller Status', 'Aktuelle Inhalte erledigt', 'Aktuelle Inhalte gesamt',
    'Nächster offener Inhalt', 'Quizversuche zur aktuellen Fassung', 'Quizzes mit zuletzt nicht bestandenem Versuch', 'Letztes Quiz',
    'Letzte Quizpunktzahl', 'Letztes Quiz bestanden', 'Historischer Abschluss am', 'Zertifikat ausgestellt am'];
  const lines = rows.map(row => [row.displayName, row.enrollmentId, row.enrolledAt, row.currentStatus, row.completedLeaves,
    row.totalLeaves, row.firstIncomplete?.title ?? '', row.quizAttempts, row.quizNeedsReview, row.latestQuiz?.title ?? '',
    row.latestQuiz?.score ?? '', row.latestQuiz ? String(row.latestQuiz.passed) : '', row.historicalCompletedAt ?? '', row.certificateIssuedAt ?? '']
    .map(value => csvCell(String(value))).join(','));
  const csv = `\uFEFF${header.map(csvCell).join(',')}\r\n${lines.join('\r\n')}\r\n`;
  if (Buffer.byteLength(csv, 'utf8') > 1024 * 1024) throw new AnalyticsError('Der CSV-Export ist zu groß. Bitte Filter eingrenzen. Es wurde keine unvollständige Datei erzeugt.', 413);
  return csv;
}
