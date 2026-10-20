import 'server-only';

import { env } from 'cloudflare:workers';
import { AnalyticsError } from '@/lib/server/course-analytics';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { contentQuiz, courseContentRevision, courseLeaves, type ProgressContent } from '@/lib/server/course-progress';

type Actor = { id: string; role?: string | null };
type Content = ProgressContent & { title: string; order: number };
type Course = { id: string; title: string; instructorId: string; activePublicationId: string | null };
type Context = { course: Course; publication: { courseId: string; payload: string } | null; contents: Content[] };
type ContextRow = { courseExists: number; authorized: number; oversize: number; snapshot: string | null };
type DataRow = { payload: string | null; oversize: number };
const MAX_DATE_MS = 8640000000000000;
const MAX_CONTEXT_BYTES = 1500 * 1024;
// Each of the five result sets receives a bounded share of the response budget.
const MAX_SET_BYTES = 1024 * 1024;
function cost(fields: string[]) {
  return `256 + 6 * (${fields.map(f => `COALESCE(length(CAST(${f} AS BLOB)), 0)`).join(' + ')})`;
}
function milliseconds(field: string) {
  const length = `length(${field})`;
  const fraction = (suffix: number) => `substr(${field}, 21, ${length} - ${20 + suffix})`;
  const digits = `CASE WHEN substr(${field}, -1) = 'Z' THEN ${fraction(1)}
    WHEN substr(${field}, -6) = '+00:00' THEN ${fraction(6)} ELSE ${fraction(0)} END`;
  return `CASE WHEN typeof(${field}) IN ('integer', 'real') THEN
      CASE WHEN ${field} BETWEEN -${MAX_DATE_MS} AND ${MAX_DATE_MS} THEN CAST(${field} AS INTEGER) END
    WHEN typeof(${field}) = 'text' AND ${length} BETWEEN 19 AND 35
      AND instr(CAST(${field} AS BLOB), x'00') = 0
      AND substr(${field}, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND substr(${field}, 11, 1) IN ('T', ' ')
      AND substr(${field}, 12, 8) GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
      AND strftime('%Y-%m-%d %H:%M:%S', julianday(substr(${field}, 1, 19)))
        = replace(substr(${field}, 1, 19), 'T', ' ')
      AND (substr(${field}, 20) IN ('', 'Z', '+00:00') OR (substr(${field}, 20, 1) = '.' AND (
        (${length} BETWEEN 21 AND 29 AND ${fraction(0)} NOT GLOB '*[^0-9]*')
        OR (${length} BETWEEN 22 AND 30 AND substr(${field}, -1) = 'Z' AND ${fraction(1)} NOT GLOB '*[^0-9]*')
        OR (${length} BETWEEN 27 AND 35 AND substr(${field}, -6) = '+00:00' AND ${fraction(6)} NOT GLOB '*[^0-9]*'))))
    THEN ROUND((julianday(substr(${field}, 1, 19)) - 2440587.5) * 86400000)
      + CASE WHEN substr(${field}, 20, 1) = '.' THEN CAST(substr((${digits}) || '000', 1, 3) AS INTEGER) ELSE 0 END END`;
}

// This context contains no learner data. Its exact representation is checked
// again in the SAME native transaction as all learner reads below.
const contextSql = `WITH
  course_row AS MATERIALIZED (SELECT id, title, instructorId, activePublicationId FROM Course WHERE id = ?1),
  authority AS MATERIALIZED (SELECT EXISTS(SELECT 1 FROM course_row) AS courseExists,
    EXISTS(SELECT 1 FROM course_row c JOIN User u ON u.id = ?2
      WHERE c.instructorId = u.id OR (?3 = 'ADMIN' AND u.role = 'ADMIN')) AS authorized),
  permitted AS MATERIALIZED (SELECT c.* FROM course_row c, authority a WHERE a.authorized),
  publication AS MATERIALIZED (SELECT p.courseId, p.payload FROM CoursePublication p JOIN permitted c ON p.id = c.activePublicationId),
  contents AS MATERIALIZED (SELECT x.id, x.courseId, x.parentId, x.title, x.type, x.content, x."order"
    FROM CourseContent x JOIN permitted c ON x.courseId = c.id
    WHERE c.activePublicationId IS NOT NULL AND x.archivedAt IS NULL ORDER BY x.id LIMIT 501),
  costs AS MATERIALIZED (SELECT ${cost(['id', 'title', 'instructorId', 'activePublicationId'])} AS n FROM permitted
    UNION ALL SELECT ${cost(['courseId', 'payload'])} FROM publication
    UNION ALL SELECT ${cost(['id','courseId','parentId','title','type','content'])} FROM contents),
  budget AS (SELECT COALESCE(SUM(n), 0) > ${MAX_CONTEXT_BYTES} AS oversize FROM costs)
  SELECT a.courseExists, a.authorized, b.oversize,
    CASE WHEN a.authorized AND NOT b.oversize THEN json_object(
      'course', json((SELECT json_object('id', id, 'title', title, 'instructorId', instructorId, 'activePublicationId', activePublicationId) FROM permitted)),
      'publication', json((SELECT json_object('courseId', courseId, 'payload', payload) FROM publication)),
      'contents', json((SELECT json_group_array(json_object('id', id, 'courseId', courseId, 'parentId', parentId,
        'title', title, 'type', type, 'content', content, 'order', "order")) FROM contents))) END AS snapshot
    FROM authority a CROSS JOIN budget b`;

// Shared SQL input is a bounded JSON manifest, never an expanded IN parameter
// list. Enrollment eligibility is resolved anew inside the final transaction.
const cohort = `cohort AS MATERIALIZED (SELECT e.id, e.userId, e.enrolledAt, e.completedAt, u.name, u.id IS NOT NULL AS accountExists
  FROM Enrollment e LEFT JOIN User u ON u.id = e.userId WHERE e.courseId = ?1
  ORDER BY ${milliseconds('e.enrolledAt')} DESC, e.id DESC LIMIT 1001),
  eligible AS MATERIALIZED (SELECT * FROM cohort WHERE (SELECT COUNT(*) FROM cohort) <= 1000),
  leaves AS MATERIALIZED (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.revision') AS revision,
    json_extract(value, '$.kind') AS kind FROM json_each(?2))`;

// Check scalar byte cost BEFORE JSON serialization. Return an explicit sentinel
// rather than truncated partial totals. No answer, feedback, confidence, evidence
// or private-practice columns are selected anywhere in this reader.
function dataSql(selection: string, fields: string[], extra = '') {
  return `WITH ${cohort}${extra}, selected AS MATERIALIZED (${selection}),
    budget AS MATERIALIZED (SELECT COALESCE(SUM(${cost(fields)}), 0) > ${MAX_SET_BYTES} AS oversize FROM selected)
    SELECT NULL AS payload, oversize FROM budget
    UNION ALL SELECT json_object(${fields.map(f => `'${f}', ${f}`).join(', ')}), 0 FROM selected, budget WHERE NOT oversize`;
}
const enrollmentsSql = dataSql(`SELECT id, userId, name, accountExists, ${milliseconds('enrolledAt')} AS enrolledAtMs,
  ${milliseconds('completedAt')} AS completedAtMs, completedAt IS NOT NULL AS hasCompletedAt FROM cohort`,
  ['id','userId','name','accountExists','enrolledAtMs','completedAtMs','hasCompletedAt']);
const progressSql = dataSql(`SELECT p.userId, p.contentId, p.revision FROM CourseContentProgress p
  JOIN eligible e ON e.userId = p.userId JOIN leaves l ON l.id = p.contentId
  WHERE p.courseId = ?1 LIMIT 100001`, ['userId','contentId','revision']);
const attemptsSql = dataSql(`SELECT q.id, q.userId, q.contentId, q.revision, q.score, q.passed,
  ${milliseconds('q.submittedAt')} AS submittedAtMs FROM QuizAttempt q
  JOIN eligible e ON e.userId = q.userId JOIN leaves l ON l.id = q.contentId AND l.kind = 'quiz'
  WHERE q.courseId = ?1 ORDER BY submittedAtMs DESC, q.id DESC LIMIT 20001`,
  ['id','userId','contentId','revision','score','passed','submittedAtMs']);
const assignmentsSql = dataSql(`SELECT s.userId, s.contentId,
  CASE WHEN g.action = 'GRADED' AND g.score >= s.passingScore THEN 1 ELSE 0 END AS passed
  FROM ranked s LEFT JOIN AssignmentGradeDecision g ON g.id =
    (SELECT d.id FROM AssignmentGradeDecision d WHERE d.submissionId = s.id ORDER BY d.sequence DESC LIMIT 1)
  WHERE s.position = 1`, ['userId','contentId','passed'], `,
  ranked AS MATERIALIZED (SELECT s.id, s.userId, s.contentId, s.passingScore,
    ROW_NUMBER() OVER (PARTITION BY s.userId, s.contentId ORDER BY s.attemptNumber DESC) AS position
    FROM AssignmentSubmission s JOIN eligible e ON e.userId = s.userId
    JOIN leaves l ON l.id = s.contentId AND l.revision = s.revision AND l.kind = 'assignment'
    WHERE s.courseId = ?1)`);
const certificatesSql = dataSql(`SELECT c.userId, MIN(${milliseconds('c.issuedAt')}) AS issuedAtMs,
  MAX(CASE WHEN ${milliseconds('c.issuedAt')} IS NULL THEN 1 ELSE 0 END) AS clockInvalid
  FROM Certificate c JOIN eligible e ON e.userId = c.userId WHERE c.courseId = ?1 GROUP BY c.userId`,
  ['userId','issuedAtMs','clockInvalid']);
function date(ms: number | null): Date {
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || Math.abs(ms) > MAX_DATE_MS) {
    throw new AnalyticsError('Zeitangaben der Kursanalyse sind beschädigt.', 409);
  }
  return new Date(ms);
}
function decode<T>(result: { success: boolean; results: DataRow[] }): T[] {
  if (!result.success || !result.results.length) throw new Error('D1 analytics result is missing.');
  if (result.results.some(row => row.oversize)) throw new AnalyticsError('Zu viele Daten für eine verlässliche Analyse. Es wurden keine Teilzahlen angezeigt.', 413);
  return result.results.filter(row => row.payload !== null).map(row => {
    if (typeof row.payload !== 'string') throw new Error('D1 analytics row is missing.');
    return JSON.parse(row.payload) as T;
  });
}
function conflict(error: unknown) {
  let current = error;
  for (let i = 0; i < 6 && current; i++) {
    if (/malformed JSON|D1_ANALYTICS_READ_CONFLICT/i.test(current instanceof Error ? current.message : String(current))) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}
export async function d1AnalyticsSnapshot(courseId: string, actor: Actor) {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  // No session: every query, including the final atomic batch, uses primary.
  const db = env.DB;
  for (let retry = 0; retry < 4; retry++) {
    try {
      const row = await db.prepare(contextSql).bind(courseId, actor.id, actor.role === 'ADMIN' ? 'ADMIN' : '').first<ContextRow>();
      if (!row) throw new Error('Missing D1 analytics context.');
      if (!row.courseExists) throw new AnalyticsError('Kurs nicht gefunden.', 404);
      if (!row.authorized) throw new AnalyticsError('Kein Zugriff auf die Kursanalyse.', 403);
      if (row.oversize) throw new AnalyticsError('Zu viele Inhaltsdaten für eine verlässliche Analyse.', 413);
      if (typeof row.snapshot !== 'string') throw new Error('Missing authorized D1 analytics context.');
      const context = JSON.parse(row.snapshot) as Context;
      const manifest = JSON.stringify(courseLeaves(context.contents).map(content => ({ id: content.id,
        revision: courseContentRevision(content), kind: content.type === 'ASSIGNMENT' && parseAssignmentContent(content.content)?.prompt.trim()
          ? 'assignment' : contentQuiz(content) ? 'quiz' : 'other' })));
      const guard = db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM (${contextSql}) current
        WHERE current.snapshot IS ?4 AND current.authorized AND NOT current.oversize) THEN 1
        ELSE json('D1_ANALYTICS_READ_CONFLICT') END AS guarded`)
        .bind(courseId, actor.id, actor.role === 'ADMIN' ? 'ADMIN' : '', row.snapshot);
      // Native batch is one read-only transaction. Guard failure rolls the batch
      // back before any learner read is returned; retry rechecks all authority.
      const result = await db.batch<DataRow>([guard, ...[enrollmentsSql, progressSql, attemptsSql, assignmentsSql, certificatesSql]
        .map(sql => db.prepare(sql).bind(courseId, manifest))]);
      const rawEnrollments = decode<{ id: string; userId: string; name: string | null; accountExists: number; enrolledAtMs: number | null;
        completedAtMs: number | null; hasCompletedAt: number }>(result[1]);
      if (rawEnrollments.length > 1000) throw new AnalyticsError('Der Kurs hat zu viele Einschreibungen für diese Ansicht. Es wurden keine Teilzahlen angezeigt.', 413);
      if (rawEnrollments.some(e => !e.accountExists)) throw new AnalyticsError('Teilnehmerdaten sind beschädigt.', 409);
      rawEnrollments.sort((a, b) => date(b.enrolledAtMs).getTime() - date(a.enrolledAtMs).getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const progress = decode<{ userId: string; contentId: string; revision: string }>(result[2]);
      if (progress.length > 100000) throw new AnalyticsError('Zu viele Fortschrittsdaten für eine verlässliche Analyse.', 413);
      const rawAttempts = decode<{ id: string; userId: string; contentId: string; revision: string; score: number;
        passed: number; submittedAtMs: number | null }>(result[3]);
      if (rawAttempts.length > 20000) throw new AnalyticsError('Zu viele Quizversuche für eine verlässliche Analyse.', 413);
      rawAttempts.sort((a, b) => date(b.submittedAtMs).getTime() - date(a.submittedAtMs).getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const assignments = decode<{ userId: string; contentId: string; passed: number }>(result[4]);
      const rawCertificates = decode<{ userId: string; issuedAtMs: number | null; clockInvalid: number }>(result[5]);
      if (rawCertificates.some(c => c.clockInvalid)) throw new AnalyticsError('Zeitangaben der Kursanalyse sind beschädigt.', 409);
      return { ...context,
        enrollments: rawEnrollments.map(e => ({ id: e.id, userId: e.userId, user: { name: e.name },
          enrolledAt: date(e.enrolledAtMs), completedAt: e.hasCompletedAt ? date(e.completedAtMs) : null })),
        progress, assignmentPasses: assignments.filter(s => s.passed === 1), assignmentActivity: assignments.map(s => s.userId),
        attempts: rawAttempts.map(a => ({ ...a, passed: a.passed === 1, submittedAt: date(a.submittedAtMs) })),
        certificates: rawCertificates.map(c => ({ userId: c.userId, _min: { issuedAt: date(c.issuedAtMs) } })) };
    } catch (error) {
      if (!conflict(error)) throw error;
      if (retry === 3) throw new AnalyticsError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
    }
  }
  throw new AnalyticsError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
