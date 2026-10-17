import 'server-only';

import { env } from 'cloudflare:workers';
import type { D1Result } from '@cloudflare/workers-types';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { AssignmentError } from '@/lib/server/assignment-errors';
import { courseContentRevision, courseLeaves, type ProgressContent } from '@/lib/server/course-progress';
import { CoursePathError, coursePathAccess, publicationPathNodes } from '@/lib/server/course-path';
import { chapterReleaseLabel } from '@/lib/course-release';
import { d1CourseContentVersionToken } from '@/lib/server/d1-course-version';

type Actor = { id: string; role?: string | null };
type Mode = 'own' | 'staff';
type Content = ProgressContent & { title: string; order: number; hasChildren: number };
type Context = {
  course: { id: string; title: string; description: string; instructorId: string; activePublicationId: string | null };
  publication: { id: string; courseId: string; payload: string } | null;
  contents: Content[];
  progress: { contentId: string; revision: string }[];
  assignmentPasses: { contentId: string }[];
};
type ContextRow = { accountExists: number; courseExists: number; published: number; enrolled: number; staff: number;
  oversize: number; contentCount: number; snapshot: string | null };
type Snapshot = { raw: string; context: Context; manifest: string; actor: Actor; courseId: string; mode: Mode };
const ID = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_PUBLICATION_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 1536 * 1024;
const MAX_ROW_BYTES = 1900 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_DATE_MS = 8640000000000000;

function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
function bytes(fields: string[]) {
  return fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)), 0)`).join(' + ') || '0';
}
function cost(fields: string[], allowance = 2048) { return `${allowance} + 6 * (${bytes(fields)})`; }

// JS/Prisma numeric dates are milliseconds. Normalize UTC ISO/SQLite text
// before ordering or comparing cursors; mixed SQLite storage classes are not
// chronological. Truncate fractional seconds exactly as JS Date does.
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

// Only the context needed to authorize this read is captured. In particular,
// no submission response, request/digest, grader or unrelated account fields
// enter this snapshot. Scalar byte accounting runs before JSON serialization.
// The outer D1 response escapes this JSON once more, hence its separate bound.
const contextSql = `WITH
  viewer AS MATERIALIZED (SELECT id, role FROM User WHERE id = ?1),
  course_row AS MATERIALIZED (SELECT id, CASE WHEN ?5 = 'own' THEN title ELSE '' END AS title,
    CASE WHEN ?5 = 'own' THEN description ELSE '' END AS description, instructorId, activePublicationId FROM Course WHERE id = ?2),
  authority AS MATERIALIZED (SELECT EXISTS (SELECT 1 FROM viewer) AS accountExists,
    EXISTS (SELECT 1 FROM course_row) AS courseExists,
    EXISTS (SELECT 1 FROM course_row WHERE activePublicationId IS NOT NULL) AS published,
    EXISTS (SELECT 1 FROM Enrollment WHERE userId = ?1 AND courseId = ?2) AS enrolled,
    EXISTS (SELECT 1 FROM course_row c, viewer v WHERE c.instructorId = v.id OR (?3 = 'ADMIN' AND v.role = 'ADMIN')) AS staff),
  authorized AS MATERIALIZED (SELECT c.id, c.title, c.description, c.instructorId, c.activePublicationId FROM course_row c, authority a WHERE a.accountExists
    AND CASE WHEN ?5 = 'own' THEN a.published AND a.enrolled ELSE a.staff END),
  publication AS MATERIALIZED (SELECT p.id, p.courseId, p.payload FROM CoursePublication p JOIN authorized c
    ON p.id = c.activePublicationId WHERE ?5 = 'own'),
  content_count AS MATERIALIZED (SELECT COUNT(*) AS n FROM CourseContent x JOIN authorized c ON c.id = x.courseId
    WHERE x.archivedAt IS NULL AND c.activePublicationId IS NOT NULL AND (?5 = 'own' OR x.type = 'ASSIGNMENT')),
  live_contents AS MATERIALIZED (SELECT x.id, x.courseId, x.parentId, x.title, x.type, x.content, x."order",
      EXISTS (SELECT 1 FROM CourseContent child WHERE child.parentId = x.id AND child.archivedAt IS NULL) AS hasChildren
    FROM CourseContent x JOIN authorized c ON c.id = x.courseId
    WHERE x.archivedAt IS NULL AND c.activePublicationId IS NOT NULL AND (?5 = 'own' OR x.type = 'ASSIGNMENT')
      AND (SELECT n FROM content_count) <= 500
    ORDER BY x.id LIMIT 500),
  progress AS MATERIALIZED (SELECT p.contentId, p.revision FROM CourseContentProgress p
    JOIN live_contents x ON x.id = p.contentId AND x.courseId = p.courseId
    WHERE ?5 = 'own' AND p.userId = ?1 ORDER BY p.contentId),
  assignment_passes AS MATERIALIZED (SELECT x.id AS contentId FROM live_contents x
    WHERE ?5 = 'own' AND x.type = 'ASSIGNMENT' AND EXISTS (SELECT 1 FROM AssignmentSubmission s
      JOIN json_each(?4) m ON json_extract(m.value, '$.id') = s.contentId AND json_extract(m.value, '$.revision') = s.revision
      JOIN AssignmentGradeDecision g ON g.id = (SELECT latest.id FROM AssignmentGradeDecision latest
        WHERE latest.submissionId = s.id ORDER BY latest.sequence DESC LIMIT 1)
      WHERE s.courseId = ?2 AND s.userId = ?1 AND s.contentId = x.id
        AND s.attemptNumber = (SELECT MAX(newer.attemptNumber) FROM AssignmentSubmission newer
          WHERE newer.courseId = s.courseId AND newer.userId = s.userId AND newer.contentId = s.contentId AND newer.revision = s.revision)
        AND g.action = 'GRADED' AND g.score >= s.passingScore) ORDER BY x.id),
  scope_costs AS MATERIALIZED (
    SELECT ${cost(['id', 'title', 'description', 'instructorId', 'activePublicationId'])} AS n FROM authorized
    UNION ALL SELECT ${cost(['id', 'courseId', 'payload'])} FROM publication
    UNION ALL SELECT ${cost(['id', 'courseId', 'parentId', 'title', 'type', 'content', '"order"'])} FROM live_contents
    UNION ALL SELECT ${cost(['contentId', 'revision'])} FROM progress
    UNION ALL SELECT ${cost(['contentId'])} FROM assignment_passes
  ), budget AS MATERIALIZED (SELECT ((SELECT n FROM content_count) > 500
    OR EXISTS (SELECT 1 FROM publication WHERE length(CAST(payload AS BLOB)) > ${MAX_PUBLICATION_BYTES})
    OR 4096 + (SELECT COALESCE(SUM(n), 0) FROM scope_costs) > ${MAX_ROW_BYTES}
    OR 4096 + 6 * (4096 + (SELECT COALESCE(SUM(n), 0) FROM scope_costs)) > ${MAX_RESPONSE_BYTES}) AS oversize)
  SELECT a.accountExists, a.courseExists, a.published, a.enrolled, a.staff, b.oversize, (SELECT n FROM content_count) AS contentCount,
    CASE WHEN NOT b.oversize AND EXISTS (SELECT 1 FROM authorized) THEN json_object(
      'course', (SELECT json_object('id', id, 'title', title, 'description', description, 'instructorId', instructorId,
        'activePublicationId', activePublicationId) FROM authorized),
      'publication', (SELECT json_object('id', id, 'courseId', courseId, 'payload', payload) FROM publication),
      'contents', json((SELECT json_group_array(json_object('id', id, 'courseId', courseId, 'parentId', parentId,
        'title', title, 'type', type, 'content', content, 'order', "order", 'hasChildren', hasChildren)) FROM live_contents)),
      'progress', json((SELECT json_group_array(json_object('contentId', contentId, 'revision', revision)) FROM progress)),
      'assignmentPasses', json((SELECT json_group_array(json_object('contentId', contentId)) FROM assignment_passes))
    ) END AS snapshot FROM authority a CROSS JOIN budget b`;

function contextStatement(db: ReturnType<typeof database>, actor: Actor, courseId: string, manifest: string, mode: Mode) {
  return db.prepare(contextSql).bind(actor.id, courseId, actor.role === 'ADMIN' ? 'ADMIN' : '', manifest, mode);
}
function revisionManifest(contents: Content[]) {
  const manifest = JSON.stringify(contents.map(row => ({ id: row.id, revision: courseContentRevision(row) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (Buffer.byteLength(manifest) > MAX_MANIFEST_BYTES) throw new AssignmentError('Diese Aufgabenansicht ist zu groß.', 413);
  return manifest;
}
async function readContext(db: ReturnType<typeof database>, actor: Actor, courseId: string, mode: Mode): Promise<Snapshot> {
  let manifest = '[]';
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await contextStatement(db, actor, courseId, manifest, mode).first<ContextRow>();
    if (!row) throw new Error('Missing D1 assignment context.');
    if (!row.accountExists) throw new AssignmentError('Unauthorized', 401);
    if (!row.courseExists || (mode === 'own' && !row.published)) throw new AssignmentError('Course not found', 404);
    if (mode === 'own' && !row.enrolled) throw new AssignmentError('Enrollment required', 403);
    if (mode === 'staff' && !row.staff) throw new AssignmentError('Unauthorized', 403);
    if (row.oversize) throw new AssignmentError('Diese Aufgabenansicht ist zu groß.', 413);
    if (typeof row.snapshot !== 'string') throw new Error('Missing authorized D1 assignment context.');
    const context = JSON.parse(row.snapshot) as Context;
    const next = revisionManifest(context.contents);
    if (next === manifest) return { raw: row.snapshot, context, manifest, actor, courseId, mode };
    manifest = next;
  }
  throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
function contextGuard(db: ReturnType<typeof database>, snapshot: Snapshot) {
  // The batch is read-only but transactional: a false guard throws before its
  // history statement, rather than merely yielding a no-op row.
  return db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM (${contextSql}) current
    WHERE current.snapshot IS ?6 AND NOT current.oversize) THEN 1
    ELSE json('D1_ASSIGNMENT_READ_CONFLICT') END AS guarded`)
    .bind(snapshot.actor.id, snapshot.courseId, snapshot.actor.role === 'ADMIN' ? 'ADMIN' : '', snapshot.manifest, snapshot.mode, snapshot.raw);
}
function isConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (/malformed JSON|D1_ASSIGNMENT_READ_CONFLICT/i.test(message)) return true;
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return false;
}

function ownContext(snapshot: Snapshot, contentId: string) {
  const { context } = snapshot;
  const content = context.contents.find(row => row.id === contentId);
  if (!content || content.type !== 'ASSIGNMENT' || content.hasChildren) {
    throw new AssignmentError('Assignment not found', 404);
  }
  const assignment = parseAssignmentContent(content.content);
  if (!assignment?.prompt.trim()) throw new AssignmentError('Assignment is not ready', 409);
  const publicationId = context.course.activePublicationId!;
  const publication = context.publication;
  if (!publication || publication.id !== publicationId || publication.courseId !== snapshot.courseId) {
    throw new CoursePathError('Course publication is unavailable', 409);
  }
  const nodes = publicationPathNodes(publication.payload);
  const published = JSON.parse(publication.payload) as { title: unknown; description: unknown;
    contents: Array<{ id: string; title: string; type: string | null; content: string }> };
  const live = new Map(context.contents.map(row => [row.id, row]));
  if (live.size !== nodes.length || published.title !== context.course.title || published.description !== context.course.description || nodes.some(node => {
    const row = live.get(node.id);
    const item = published.contents.find(value => value.id === node.id)!;
    return !row || row.parentId !== node.parentId || row.order !== node.order || row.title !== item.title ||
      row.type !== (item.type === 'QUIZ' ? 'TEXT' : item.type) || row.content !== item.content;
  })) throw new CoursePathError('Published course contents do not match the active publication', 409);
  const leaves = courseLeaves(context.contents);
  const progress = new Map(context.progress.map(row => [row.contentId, row.revision]));
  const assignmentPasses = new Set(context.assignmentPasses.map(row => row.contentId));
  const completed = leaves.filter(row => row.type === 'ASSIGNMENT'
    ? Boolean(parseAssignmentContent(row.content)?.prompt.trim() && assignmentPasses.has(row.id))
    : progress.get(row.id) === courseContentRevision(row)).map(row => row.id);
  const gate = coursePathAccess(nodes, completed).get(contentId);
  if (!gate) throw new CoursePathError('Content not found', 404);
  if (gate.releaseLocked) throw new CoursePathError(`Freigabe ab ${chapterReleaseLabel(gate.releaseOn!)}`, 423);
  if (gate.missingPrerequisites.length) throw new CoursePathError('Complete the required earlier content before continuing', 423);
  return { content, assignment, publicationId, revision: courseContentRevision(content) };
}

type HistoryRow = { kind: 'access' | 'submission' | 'decision'; id: string | null; contentId: string | null;
  response: string | null; attemptNumber: number | null; submittedAtMs: number | null; revision: string | null;
  passingScore: number | null; learnerId: string | null; learnerName: string | null; isLatest: number | null;
  submissionId: string | null; action: string | null; score: number | null; feedback: string | null;
  createdAtMs: number | null; sequence: number | null; oversize: number | null; hasMore: number | null; anchorValid: number | null; forcedCurrent: number | null; clockInvalid: number | null };
type HistoryColumn = Exclude<keyof HistoryRow, 'kind'>;
const historyColumns: HistoryColumn[] = ['id', 'contentId', 'response', 'attemptNumber', 'submittedAtMs', 'revision',
  'passingScore', 'learnerId', 'learnerName', 'isLatest', 'submissionId', 'action', 'score', 'feedback',
  'createdAtMs', 'sequence', 'oversize', 'hasMore', 'anchorValid', 'forcedCurrent', 'clockInvalid'];
function historyRow(kind: HistoryRow['kind'], fields: Partial<Record<HistoryColumn, string>>) {
  return `SELECT '${kind}' AS kind, ${historyColumns.map(key => `${fields[key] ?? 'NULL'} AS "${key}"`).join(', ')}`;
}

// History is a separate statement in the SAME native batch as contextGuard.
// There are no pre-read history/cursor queries and no dynamic bind expansion.
// The own selection preserves 25 newest across all revisions and additionally
// forces the latest current-revision submission into that same 25-row limit.
const historySql = `WITH
  active AS MATERIALIZED (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.revision') AS revision FROM json_each(?4)),
  anchor AS MATERIALIZED (SELECT id, courseId, ${milliseconds('submittedAt')} AS submittedAtMs FROM AssignmentSubmission WHERE ?6 <> '' AND id = ?6),
  candidates AS MATERIALIZED (SELECT s.id, s.contentId, s.userId, s.revision, s.attemptNumber, s.passingScore,
      ${milliseconds('s.submittedAt')} AS submittedAtMs,
      NOT EXISTS (SELECT 1 FROM AssignmentSubmission newer WHERE newer.courseId = s.courseId
        AND newer.userId = s.userId AND newer.contentId = s.contentId AND newer.revision = s.revision
        AND newer.attemptNumber > s.attemptNumber) AS isLatest
    FROM AssignmentSubmission s
    WHERE s.courseId = ?2 AND CASE WHEN ?5 = 'own' THEN s.userId = ?1 AND s.contentId = ?3
      ELSE EXISTS (SELECT 1 FROM active a WHERE a.id = s.contentId AND a.revision = s.revision) END),
  own_newest AS MATERIALIZED (SELECT id FROM candidates WHERE ?5 = 'own' ORDER BY attemptNumber DESC LIMIT 25),
  own_current AS MATERIALIZED (SELECT id FROM candidates WHERE ?5 = 'own' AND revision = ?8 ORDER BY attemptNumber DESC LIMIT 1),
  own_page AS MATERIALIZED (SELECT s.id, s.contentId, s.userId, s.revision, s.attemptNumber, s.passingScore, s.submittedAtMs, s.isLatest FROM candidates s WHERE ?5 = 'own'
      AND (s.id IN (SELECT id FROM own_newest) OR s.id IN (SELECT id FROM own_current))
    ORDER BY CASE WHEN s.id IN (SELECT id FROM own_current) AND s.id NOT IN (SELECT id FROM own_newest) THEN 0 ELSE 1 END,
      s.attemptNumber DESC LIMIT 25),
  staff_selected AS MATERIALIZED (SELECT s.id, s.contentId, s.userId, s.revision, s.attemptNumber, s.passingScore, s.submittedAtMs, s.isLatest FROM candidates s WHERE ?5 = 'staff'
      AND (?6 = '' OR EXISTS (SELECT 1 FROM anchor a WHERE a.courseId = ?2
        AND (s.submittedAtMs < a.submittedAtMs OR (s.submittedAtMs = a.submittedAtMs AND s.id < a.id))))
      AND (?7 = 'all' OR (s.isLatest AND (SELECT g.action FROM AssignmentGradeDecision g
        WHERE g.submissionId = s.id ORDER BY g.sequence DESC LIMIT 1) IS DISTINCT FROM 'GRADED'))
    ORDER BY submittedAtMs DESC, id DESC LIMIT 51),
  page AS MATERIALIZED (SELECT id, contentId, userId, revision, attemptNumber, passingScore, submittedAtMs, isLatest FROM own_page UNION ALL
    SELECT id, contentId, userId, revision, attemptNumber, passingScore, submittedAtMs, isLatest FROM (SELECT id, contentId, userId, revision, attemptNumber, passingScore, submittedAtMs, isLatest FROM staff_selected ORDER BY submittedAtMs DESC, id DESC LIMIT 50)),
  page_details AS MATERIALIZED (SELECT p.id, p.contentId, p.userId, p.revision, p.attemptNumber, p.passingScore, p.submittedAtMs, p.isLatest, s.response,
      CASE WHEN ?5 = 'staff' THEN person.id END AS learnerId,
      CASE WHEN ?5 = 'staff' THEN person.name END AS learnerName,
      CASE WHEN ?5 = 'staff' THEN content.title END AS titleForCost
    FROM page p JOIN AssignmentSubmission s ON s.id = p.id LEFT JOIN User person ON person.id = p.userId
    LEFT JOIN CourseContent content ON content.id = p.contentId AND content.courseId = ?2),
  ranked_decisions AS MATERIALIZED (SELECT g.id, g.submissionId,
      ROW_NUMBER() OVER (PARTITION BY g.submissionId ORDER BY g.sequence DESC) AS position
    FROM AssignmentGradeDecision g JOIN page s ON s.id = g.submissionId),
  decisions AS MATERIALIZED (SELECT g.id, g.submissionId, g.action, g.score, g.feedback, g.sequence,
      ${milliseconds('g.createdAt')} AS createdAtMs FROM AssignmentGradeDecision g
    JOIN ranked_decisions ranked ON ranked.id = g.id
    WHERE ranked.position <= CASE WHEN ?5 = 'own' THEN 10 ELSE 20 END),
  -- The public DTO repeats the current title for EACH queue submission.
  -- Count that multiplicity here, even though D1 need not transport it again.
  row_costs AS MATERIALIZED (SELECT ${cost(['id', 'contentId', 'response', 'revision', 'learnerId', 'learnerName', 'attemptNumber', 'passingScore', 'submittedAtMs', 'isLatest', 'titleForCost'])} AS n FROM page_details
    UNION ALL SELECT ${cost(['id', 'submissionId', 'action', 'feedback', 'score', 'sequence', 'createdAtMs'])} FROM decisions),
  budget AS MATERIALIZED (SELECT (EXISTS (SELECT 1 FROM row_costs WHERE n > ${MAX_ROW_BYTES})
    OR 4096 + (SELECT COALESCE(SUM(n), 0) FROM row_costs) > ${MAX_RESPONSE_BYTES}) AS oversize,
    (EXISTS (SELECT 1 FROM page WHERE submittedAtMs IS NULL)
      OR EXISTS (SELECT 1 FROM decisions WHERE createdAtMs IS NULL)
      OR (?5 = 'staff' AND EXISTS (SELECT 1 FROM candidates WHERE submittedAtMs IS NULL))
      OR EXISTS (SELECT 1 FROM anchor WHERE courseId = ?2 AND submittedAtMs IS NULL)) AS clockInvalid)
  ${historyRow('access', { oversize: 'b.oversize', hasMore: '(SELECT COUNT(*) FROM staff_selected) > 50',
    anchorValid: "(?6 = '' OR EXISTS (SELECT 1 FROM anchor WHERE courseId = ?2))", clockInvalid: 'b.clockInvalid' })} FROM budget b
  UNION ALL ${historyRow('submission', { id: 's.id', contentId: 's.contentId', response: 's.response', attemptNumber: 's.attemptNumber',
    submittedAtMs: 's.submittedAtMs', revision: 's.revision', passingScore: 's.passingScore', learnerId: 's.learnerId',
    learnerName: 's.learnerName', isLatest: 's.isLatest',
    forcedCurrent: "(?5 = 'own' AND s.id IN (SELECT id FROM own_current) AND s.id NOT IN (SELECT id FROM own_newest))" })} FROM page_details s, budget b WHERE NOT b.oversize AND NOT b.clockInvalid
  UNION ALL ${historyRow('decision', { id: 'g.id', submissionId: 'g.submissionId', action: 'g.action', score: 'g.score',
    feedback: 'g.feedback', createdAtMs: 'g.createdAtMs', sequence: 'g.sequence' })} FROM decisions g, budget b WHERE NOT b.oversize AND NOT b.clockInvalid`;

function string(value: string | null) {
  if (typeof value !== 'string') throw new AssignmentError('Aufgabendaten sind beschädigt.', 409);
  return value;
}
function integer(value: number | null, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AssignmentError('Aufgabendaten sind beschädigt.', 409);
  }
  return value;
}
function date(value: number | null) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_DATE_MS) {
    throw new AssignmentError('Abgabezeitpunkt ist beschädigt.', 409);
  }
  return new Date(value);
}
function decisionDto(row: HistoryRow, threshold: number) {
  if (row.action !== 'GRADED' && row.action !== 'WITHDRAWN') throw new AssignmentError('Aufgabendaten sind beschädigt.', 409);
  const score = row.score === null ? null : integer(row.score, 0, 100);
  if (row.feedback !== null && typeof row.feedback !== 'string') throw new AssignmentError('Aufgabendaten sind beschädigt.', 409);
  return { id: string(row.id), action: row.action, score, feedback: row.feedback,
    passed: row.action === 'GRADED' && score !== null && score >= threshold,
    createdAt: date(row.createdAtMs), sequence: integer(row.sequence, 1) };
}
async function history(db: ReturnType<typeof database>, snapshot: Snapshot, contentId: string, manifest: string,
  cursor = '', filter = 'pending', revision = '') {
  const result = await db.batch<HistoryRow>([contextGuard(db, snapshot), db.prepare(historySql)
    .bind(snapshot.actor.id, snapshot.courseId, contentId, manifest, snapshot.mode, cursor, filter, revision)]);
  const page: D1Result<HistoryRow> | undefined = result[1];
  if (!page?.success) throw new Error('D1 assignment history read failed.');
  const access = page.results.find(row => row.kind === 'access');
  if (!access) throw new Error('Missing D1 assignment history access.');
  if (!access.anchorValid) throw new AssignmentError('Ungültiger Seitenzeiger.', 400);
  if (access.oversize) throw new AssignmentError('Diese Aufgabenansicht ist zu groß.', 413);
  if (access.clockInvalid) throw new AssignmentError('Abgabezeitpunkt ist beschädigt.', 409);
  const submissions = page.results.filter(row => row.kind === 'submission');
  const decisions = page.results.filter(row => row.kind === 'decision');
  return { submissions, hasMore: Boolean(access.hasMore), decisions: (id: string, threshold: number) => decisions
    .filter(row => row.submissionId === id).sort((a, b) => integer(b.sequence, 1) - integer(a.sequence, 1))
    .map(row => decisionDto(row, threshold)) };
}

export async function d1ReadOwnAssignment(courseId: string, contentId: string, userId: string) {
  const db = database();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const snapshot = await readContext(db, { id: userId }, courseId, 'own');
      const current = ownContext(snapshot, contentId);
      const page = await history(db, snapshot, contentId, '[]', '', 'pending', current.revision);
      const rows = page.submissions.sort((a, b) => Number(Boolean(b.forcedCurrent)) - Number(Boolean(a.forcedCurrent)) ||
        integer(b.attemptNumber, 1) - integer(a.attemptNumber, 1));
      const latest = rows.find(row => row.revision === current.revision);
      const currentDecision = latest ? page.decisions(string(latest.id), integer(latest.passingScore, 1, 100))[0] ?? null : null;
      return { publicationId: current.publicationId, contentVersionToken: d1CourseContentVersionToken(current.publicationId, current.content.id),
        revision: current.revision, passingScore: current.assignment.passingScore,
        maySubmit: !latest || Boolean(currentDecision && (currentDecision.action === 'WITHDRAWN' ||
          (currentDecision.score !== null && currentDecision.score < current.assignment.passingScore))),
        submissions: rows.map(row => ({ id: string(row.id), response: string(row.response), attemptNumber: integer(row.attemptNumber, 1),
          submittedAt: date(row.submittedAtMs), currentRevision: row.revision === current.revision,
          decisions: page.decisions(string(row.id), integer(row.passingScore, 1, 100)) })) };
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (attempt === 4) throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
    }
  }
  throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}

export async function d1ReadAssignmentQueue(courseId: string, actor: Actor, cursor?: string | null, filter: 'pending' | 'all' = 'pending') {
  if (cursor !== undefined && cursor !== null && !ID.test(cursor)) throw new AssignmentError('Ungültiger Seitenzeiger.', 400);
  const db = database();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const snapshot = await readContext(db, actor, courseId, 'staff');
      if (!snapshot.context.course.activePublicationId) return { submissions: [], nextCursor: null };
      const available = snapshot.context.contents.filter(row => row.type === 'ASSIGNMENT' && !row.hasChildren &&
        parseAssignmentContent(row.content)?.prompt.trim());
      if (!available.length) return { submissions: [], nextCursor: null };
      const manifest = revisionManifest(available);
      const page = await history(db, snapshot, '', manifest, cursor ?? '', filter);
      const rows = page.submissions.sort((a, b) => date(b.submittedAtMs).getTime() - date(a.submittedAtMs).getTime() ||
        (string(a.id) < string(b.id) ? 1 : string(a.id) > string(b.id) ? -1 : 0));
      const contents = new Map(available.map(row => [row.id, row]));
      return { submissions: rows.map(row => {
        const threshold = integer(row.passingScore, 1, 100);
        const content = contents.get(string(row.contentId));
        if (!content || (row.learnerName !== null && typeof row.learnerName !== 'string')) throw new AssignmentError('Aufgabendaten sind beschädigt.', 409);
        return { id: string(row.id), contentId: content.id, title: content.title,
          learner: { id: string(row.learnerId), name: row.learnerName }, response: string(row.response),
          submittedAt: date(row.submittedAtMs), attemptNumber: integer(row.attemptNumber, 1),
          isLatest: Boolean(row.isLatest), passingScore: threshold, decisions: page.decisions(string(row.id), threshold) };
      }), nextCursor: page.hasMore && rows.length ? string(rows[rows.length - 1].id) : null };
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (attempt === 4) throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
    }
  }
  throw new AssignmentError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
