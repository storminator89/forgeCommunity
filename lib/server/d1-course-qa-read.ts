import 'server-only';

import { env } from 'cloudflare:workers';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import type { CourseQaLessonContext, CourseQaLessonContextPair, CourseQaScope } from '@/lib/course-qa-context-contract';
import { CourseQAError } from '@/lib/server/course-qa';
import { courseContentRevision, courseLeaves, type ProgressContent } from '@/lib/server/course-progress';
import { CoursePathError, coursePathAccess, publicationPathNodes, type PathNode } from '@/lib/server/course-path';

type Actor = { id: string; role?: string | null };
type Cursor = { createdAt: Date; id: string };
type Query = { filter: string; q: string; pair: CourseQaLessonContextPair | null };
type Mode = 'list' | 'revalidate' | 'detail';
type ReadInput = Query & { mode: Mode; cursor: Cursor | null; ids: string[]; questionId: string };
type Content = ProgressContent & { title: string; order: number; progressRevision: string | null; assignmentPassed: number };

// Typed scalar rows avoid escaping a complete publication inside an aggregate
// JSON object. Every potentially large value is budgeted in SQLite BEFORE it
// is selected for transport. These are response limits, never truncation.
const MAX_PUBLICATION_BYTES = 512 * 1024;
const MAX_SEARCH_FIELD_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 1536 * 1024;
const MAX_ROW_BYTES = 1900 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const unavailable = { status: 'unavailable' } as const;

type Row = {
  kind: 'access' | 'question' | 'answer' | 'content' | 'publication';
  id: string | null; title: string | null; body: string | null; createdAtMs: number | null;
  hidden: number | null; revision: string | null; authorId: string | null; authorName: string | null;
  authorExists: number | null; answerId: string | null; answerCount: number | null;
  contextPublicationId: string | null; contextContentId: string | null; parentId: string | null;
  type: string | null; content: string | null; order: number | null; progressRevision: string | null;
  assignmentPassed: number | null; payload: string | null; payloadCourseId: string | null;
  accountExists: number | null; courseExists: number | null; activePublicationId: string | null;
  canModerate: number | null; enrolled: number | null; hasMore: number | null;
  answersOverflow: number | null; oversize: number | null; contextNeeded: number | null; contentCount: number | null;
  published: number | null; questionExists: number | null;
};
type Column = Exclude<keyof Row, 'kind'>;
const columns: Column[] = ['id', 'title', 'body', 'createdAtMs', 'hidden', 'revision', 'authorId', 'authorName',
  'authorExists', 'answerId', 'answerCount', 'contextPublicationId', 'contextContentId', 'parentId', 'type',
  'content', 'order', 'progressRevision', 'assignmentPassed', 'payload', 'payloadCourseId', 'accountExists',
  'courseExists', 'activePublicationId', 'canModerate', 'enrolled', 'hasMore', 'answersOverflow', 'oversize',
  'contextNeeded', 'contentCount', 'published', 'questionExists'];
function selectRow(kind: Row['kind'], fields: Partial<Record<Column, string>>) {
  return `SELECT '${kind}' AS kind, ${columns.map(key => `${fields[key] ?? 'NULL'} AS "${key}"`).join(', ')}`;
}
// Six times the UTF-8 byte count bounds JSON escaping, including control
// characters. The fixed allowance covers keys, scalar numbers and null fields.
function cost(fields: string[], allowance = 2048) {
  return `${allowance} + 6 * (${fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)), 0)`).join(' + ') || '0'})`;
}
function milliseconds(field: string) {
  return `CASE WHEN typeof(${field}) IN ('integer', 'real') THEN CAST(${field} AS INTEGER)
    ELSE ROUND((julianday(${field}) - 2440587.5) * 86400000) END`;
}

/* Prisma 7.10.0's pinned engine (0edf323efd1d98336f3f0a68684b56f689b900d3),
 * query-compiler/query-builders/sql-query-builder/src/filter/visitor.rs,
 * like_contains_pattern, wraps the UNESCAPED value in %. Thus % and _ remain
 * wildcards and backslash is literal. D1 limits a LIKE pattern to 50 bytes.
 * Longer patterns use a deterministic greedy wildcard machine below, not an
 * unordered collection of LIKE chunks or Unicode-changing JS lowercasing.
 *
 * One recursive successor per state: % remembers its input position; mismatch
 * advances that position and retries after the most recent %. substr advances
 * Unicode code points; lower folds ASCII only, as SQLite LIKE does. length(text)
 * stops at its first NUL, also matching LIKE. The implicit final % accepts the
 * remaining text immediately. Field bytes are bounded before either matcher.
 */
const snapshotSql = `WITH RECURSIVE
  viewer AS (SELECT id, role FROM User WHERE id = ?1),
  course_row AS (
    SELECT c.id, c.activePublicationId,
      (c.instructorId = ?1 OR (?3 = 'ADMIN' AND EXISTS (SELECT 1 FROM viewer WHERE role = 'ADMIN'))) AS canModerate,
      EXISTS (SELECT 1 FROM Enrollment e WHERE e.courseId = c.id AND e.userId = ?1) AS enrolled
    FROM Course c WHERE c.id = ?2
  ), authorized AS (
    SELECT c.* FROM course_row c WHERE EXISTS (SELECT 1 FROM viewer)
      AND (c.canModerate OR (c.activePublicationId IS NOT NULL AND c.enrolled))
  ), candidates AS (
    SELECT q.*, s.answerId, a.name AS authorName, a.id IS NOT NULL AS authorExists,
      ${milliseconds('q.createdAt')} AS createdAtMs,
      length(CAST(q.title AS BLOB)) AS titleBytes, length(CAST(q.body AS BLOB)) AS bodyBytes
    FROM CourseQuestion q JOIN authorized c ON c.id = q.courseId
    LEFT JOIN CourseQuestionSolution s ON s.questionId = q.id
    LEFT JOIN User a ON a.id = q.authorId
    WHERE CASE WHEN ?11 = 'detail' THEN q.id = ?10 AND (q.hiddenAt IS NULL OR c.canModerate)
      ELSE (CASE WHEN ?4 = 'hidden' THEN q.hiddenAt IS NOT NULL AND c.canModerate ELSE q.hiddenAt IS NULL END)
        AND (?4 NOT IN ('open', 'answered') OR (?4 = 'open' AND s.questionId IS NULL) OR (?4 = 'answered' AND s.questionId IS NOT NULL))
        AND (?6 IS NULL OR (q.contextPublicationId = ?6 AND q.contextContentId = ?7))
        AND (?11 <> 'revalidate' OR q.id IN (SELECT value FROM json_each(?12))) END
  ), search_texts AS (
    SELECT id, 0 AS part, title AS text FROM candidates
      WHERE ?11 <> 'detail' AND ?5 <> '' AND ?14 = 0 AND titleBytes <= ${MAX_SEARCH_FIELD_BYTES} AND bodyBytes <= ${MAX_SEARCH_FIELD_BYTES}
    UNION ALL SELECT id, 1, body FROM candidates
      WHERE ?11 <> 'detail' AND ?5 <> '' AND ?14 = 0 AND titleBytes <= ${MAX_SEARCH_FIELD_BYTES} AND bodyBytes <= ${MAX_SEARCH_FIELD_BYTES}
  ), search_states(id, part, i, j, star, mark) AS (
    SELECT id, part, 1, 1, 0, 1 FROM search_texts
    UNION ALL
    SELECT state.id, state.part,
      CASE WHEN substr(?5, j, 1) = '%' THEN i
        WHEN i <= length(text) AND (substr(?5, j, 1) = '_' OR lower(substr(text, i, 1)) = lower(substr(?5, j, 1))) THEN i + 1
        ELSE mark + 1 END,
      CASE WHEN substr(?5, j, 1) = '%' THEN j + 1
        WHEN i <= length(text) AND (substr(?5, j, 1) = '_' OR lower(substr(text, i, 1)) = lower(substr(?5, j, 1))) THEN j + 1
        ELSE star + 1 END,
      CASE WHEN substr(?5, j, 1) = '%' THEN j ELSE star END,
      CASE WHEN substr(?5, j, 1) = '%' THEN i
        WHEN i <= length(text) AND (substr(?5, j, 1) = '_' OR lower(substr(text, i, 1)) = lower(substr(?5, j, 1))) THEN mark
        ELSE mark + 1 END
    FROM search_states state JOIN search_texts source ON source.id = state.id AND source.part = state.part
    WHERE j < length(?5) AND (substr(?5, j, 1) = '%'
      OR (i <= length(text) AND (substr(?5, j, 1) = '_' OR lower(substr(text, i, 1)) = lower(substr(?5, j, 1))))
      OR (star > 0 AND mark < length(text)))
  ), searched AS (
    SELECT * FROM candidates q WHERE CASE
      WHEN ?11 = 'detail' OR ?5 = '' THEN 1
      WHEN titleBytes > ${MAX_SEARCH_FIELD_BYTES} OR bodyBytes > ${MAX_SEARCH_FIELD_BYTES} THEN 0
      WHEN ?14 = 1 THEN q.title LIKE ?5 OR q.body LIKE ?5
      ELSE EXISTS (SELECT 1 FROM search_states state WHERE state.id = q.id AND state.j = length(?5)) END
  ), selected_questions AS (
    SELECT * FROM searched WHERE ?11 <> 'list' OR ?8 IS NULL OR createdAtMs < ?8 OR (createdAtMs = ?8 AND id < ?9)
    ORDER BY createdAtMs DESC, id DESC LIMIT CASE WHEN ?11 = 'list' THEN 21 WHEN ?11 = 'detail' THEN 1 ELSE 200 END
  ), page_questions AS (
    SELECT * FROM selected_questions ORDER BY createdAtMs DESC, id DESC LIMIT CASE WHEN ?11 = 'list' THEN 20 ELSE 200 END
  ), answer_page AS (
    SELECT a.id, a.body, ${milliseconds('a.createdAt')} AS createdAtMs, a.hiddenAt IS NOT NULL AS hidden,
      a.authorId, person.name AS authorName, person.id IS NOT NULL AS authorExists
    FROM CourseAnswer a JOIN page_questions q ON q.id = a.questionId JOIN authorized c ON c.id = q.courseId
    LEFT JOIN User person ON person.id = a.authorId
    WHERE ?11 = 'detail' AND (c.canModerate OR a.hiddenAt IS NULL)
    ORDER BY createdAtMs ASC, a.id ASC LIMIT 101
  ), context_needed AS (
    SELECT c.* FROM authorized c WHERE c.activePublicationId IS NOT NULL
      AND (?11 <> 'list' OR ?4 <> 'hidden' OR c.canModerate)
      AND (SELECT COUNT(*) FROM answer_page) <= 100 AND (
        (?6 IS NOT NULL AND ?6 = c.activePublicationId) OR
        EXISTS (SELECT 1 FROM page_questions q WHERE q.contextPublicationId = c.activePublicationId))
  ), context_publication AS (
    SELECT p.id, p.courseId, p.payload, length(CAST(p.payload AS BLOB)) AS payloadBytes
    FROM CoursePublication p JOIN context_needed c ON c.activePublicationId = p.id AND p.courseId = c.id
  ), live_count AS (
    SELECT COUNT(*) AS n FROM CourseContent x JOIN context_needed c ON c.id = x.courseId
      JOIN context_publication p ON p.courseId = c.id WHERE x.archivedAt IS NULL
  ), live_contents AS (
    SELECT x.id, x.title, x.parentId, x.type, x.content, x."order", progress.revision AS progressRevision,
      EXISTS (SELECT 1 FROM AssignmentSubmission s
        JOIN json_each(?13) manifest ON json_extract(manifest.value, '$.id') = s.contentId
          AND json_extract(manifest.value, '$.revision') = s.revision
        JOIN AssignmentGradeDecision g ON g.id = (SELECT newest.id FROM AssignmentGradeDecision newest
          WHERE newest.submissionId = s.id ORDER BY newest.sequence DESC LIMIT 1)
        WHERE x.type = 'ASSIGNMENT' AND s.contentId = x.id AND s.courseId = ?2 AND s.userId = ?1
          AND s.attemptNumber = (SELECT MAX(newer.attemptNumber) FROM AssignmentSubmission newer
            WHERE newer.courseId = s.courseId AND newer.userId = s.userId AND newer.contentId = s.contentId AND newer.revision = s.revision)
          AND g.action = 'GRADED' AND g.score >= s.passingScore) AS assignmentPassed
    FROM CourseContent x JOIN context_needed c ON c.id = x.courseId
      JOIN context_publication p ON p.courseId = c.id AND p.payloadBytes <= ${MAX_PUBLICATION_BYTES}
    LEFT JOIN CourseContentProgress progress ON progress.userId = ?1 AND progress.courseId = x.courseId AND progress.contentId = x.id
    WHERE x.archivedAt IS NULL AND (SELECT n FROM live_count) <= 500
    ORDER BY x.id LIMIT 500
  ), question_costs AS (
    SELECT q.id, CASE WHEN ?11 = 'revalidate' THEN ${cost(['q.id', 'q.contextPublicationId', 'q.contextContentId'])}
      ELSE ${cost(['q.id', 'q.title', 'q.body', 'q.solutionRevision', 'q.authorId', 'q.authorName', 'q.answerId', 'q.contextPublicationId', 'q.contextContentId'])} END AS bytes
    FROM page_questions q
  ), answer_costs AS (
    SELECT ${cost(['id', 'body', 'authorId', 'authorName'])} AS bytes FROM answer_page
      WHERE (SELECT COUNT(*) FROM answer_page) <= 100
  ), content_costs AS (
    SELECT ${cost(['id', 'title', 'parentId', 'type', 'content', 'progressRevision'])} AS bytes FROM live_contents
  ), context_costs AS (
    SELECT ${cost(['x.title', 'x.id', 'c.activePublicationId', 'c.id', 'x.id', 'c.id', 'x.id'])} AS bytes
      FROM page_questions q JOIN context_needed c ON q.contextPublicationId = c.activePublicationId
      JOIN live_contents x ON x.id = q.contextContentId
    UNION ALL SELECT ${cost(['x.title', 'x.id', 'c.activePublicationId', 'c.id', 'x.id', 'c.id', 'x.id'])}
      FROM context_needed c JOIN live_contents x ON x.id = ?7 WHERE ?6 = c.activePublicationId
  ), costs AS (
    SELECT bytes FROM question_costs UNION ALL SELECT bytes FROM answer_costs UNION ALL SELECT bytes FROM content_costs
    UNION ALL SELECT bytes FROM context_costs
    UNION ALL SELECT ${cost(['payload', 'id', 'courseId'])} FROM context_publication
    UNION ALL SELECT ${cost(['activePublicationId'])} FROM authorized
  ), transport_costs AS (
    SELECT bytes FROM question_costs UNION ALL SELECT bytes FROM answer_costs UNION ALL SELECT bytes FROM content_costs
    UNION ALL SELECT 2048 + payloadBytes + length(CAST(id AS BLOB)) + length(CAST(courseId AS BLOB)) FROM context_publication
    UNION ALL SELECT ${cost(['activePublicationId'])} FROM authorized
  ), budget AS (
    SELECT ((SELECT COALESCE(SUM(bytes), 0) FROM costs) > ${MAX_RESPONSE_BYTES}
      OR (SELECT COALESCE(MAX(bytes), 0) FROM transport_costs) > ${MAX_ROW_BYTES}
      OR EXISTS (SELECT 1 FROM context_publication WHERE payloadBytes > ${MAX_PUBLICATION_BYTES})
      OR (?11 <> 'detail' AND ?5 <> '' AND EXISTS (SELECT 1 FROM candidates
        WHERE titleBytes > ${MAX_SEARCH_FIELD_BYTES} OR bodyBytes > ${MAX_SEARCH_FIELD_BYTES}))) AS oversize
  )
  ${selectRow('access', {
    accountExists: 'EXISTS (SELECT 1 FROM viewer)', courseExists: 'EXISTS (SELECT 1 FROM course_row)',
    activePublicationId: 'CASE WHEN NOT budget.oversize THEN (SELECT activePublicationId FROM authorized) END',
    canModerate: 'COALESCE((SELECT canModerate FROM course_row), 0)', enrolled: 'COALESCE((SELECT enrolled FROM course_row), 0)',
    hasMore: "(?11 = 'list' AND (SELECT COUNT(*) FROM selected_questions) > 20)",
    answersOverflow: '(SELECT COUNT(*) FROM answer_page) > 100', oversize: 'budget.oversize',
    contextNeeded: 'EXISTS (SELECT 1 FROM context_needed)', contentCount: '(SELECT n FROM live_count)',
    published: 'EXISTS (SELECT 1 FROM course_row WHERE activePublicationId IS NOT NULL)',
    questionExists: 'EXISTS (SELECT 1 FROM page_questions)',
  })} FROM budget
  UNION ALL ${selectRow('question', {
    id: 'q.id', title: "CASE WHEN ?11 <> 'revalidate' THEN q.title END", body: "CASE WHEN ?11 <> 'revalidate' THEN q.body END",
    createdAtMs: "CASE WHEN ?11 <> 'revalidate' THEN q.createdAtMs END", hidden: "CASE WHEN ?11 <> 'revalidate' THEN q.hiddenAt IS NOT NULL END",
    revision: "CASE WHEN ?11 <> 'revalidate' THEN q.solutionRevision END", authorId: "CASE WHEN ?11 <> 'revalidate' THEN q.authorId END",
    authorName: "CASE WHEN ?11 <> 'revalidate' THEN q.authorName END", authorExists: "CASE WHEN ?11 <> 'revalidate' THEN q.authorExists END",
    answerId: "CASE WHEN ?11 <> 'revalidate' THEN q.answerId END",
    answerCount: "CASE WHEN ?11 = 'list' THEN (SELECT COUNT(*) FROM CourseAnswer a WHERE a.questionId = q.id AND a.hiddenAt IS NULL) ELSE 0 END",
    contextPublicationId: 'q.contextPublicationId', contextContentId: 'q.contextContentId',
  })} FROM page_questions q, budget WHERE NOT budget.oversize
  UNION ALL ${selectRow('answer', { id: 'a.id', body: 'a.body', createdAtMs: 'a.createdAtMs', hidden: 'a.hidden',
    authorId: 'a.authorId', authorName: 'a.authorName', authorExists: 'a.authorExists' })}
    FROM answer_page a, budget WHERE NOT budget.oversize AND (SELECT COUNT(*) FROM answer_page) <= 100
  UNION ALL ${selectRow('content', { id: 'x.id', title: 'x.title', parentId: 'x.parentId', type: 'x.type', content: 'x.content',
    order: 'x."order"', progressRevision: 'x.progressRevision', assignmentPassed: 'x.assignmentPassed' })}
    FROM live_contents x, budget WHERE NOT budget.oversize
  UNION ALL ${selectRow('publication', { id: 'p.id', payload: 'p.payload', payloadCourseId: 'p.courseId' })}
    FROM context_publication p, budget WHERE NOT budget.oversize`;

function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
function required(value: string | null, label: string) {
  if (typeof value !== 'string') throw new Error(`Invalid stored Q&A ${label}`);
  return value;
}
function date(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid stored Q&A timestamp');
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid stored Q&A timestamp');
  return result;
}
function author(row: Row) {
  if (!row.authorExists || typeof row.authorId !== 'string' || !row.authorId ||
      (row.authorName !== null && typeof row.authorName !== 'string')) throw new Error('Missing stored Q&A author');
  return { id: row.authorId, name: row.authorName?.trim() || 'Unbenannte Person' };
}
function storedPair(row: Row): CourseQaLessonContextPair | null {
  return row.contextPublicationId === null && row.contextContentId === null ? null : {
    publicationId: row.contextPublicationId ?? '', contentId: row.contextContentId ?? '',
  };
}

type Snapshot = { rows: Row[]; access: Row; contents: Content[]; nodes: PathNode[] | null; now: number };
function contextTopology(rows: Row[], access: Row, courseId: string): { contents: Content[]; nodes: PathNode[] | null } {
  if (!access.contextNeeded) return { contents: [], nodes: null };
  const publication = rows.find(row => row.kind === 'publication');
  if (!publication || publication.id !== access.activePublicationId || publication.payloadCourseId !== courseId) return { contents: [], nodes: null };
  let nodes: PathNode[];
  try { nodes = publicationPathNodes(required(publication.payload, 'publication')); }
  catch (error) {
    if (error instanceof CoursePathError) return { contents: [], nodes: null };
    throw error;
  }
  if ((access.contentCount ?? 0) > 500) return { contents: [], nodes: null };
  const contents = rows.filter(row => row.kind === 'content').map(row => {
    if (!Number.isSafeInteger(row.order)) throw new Error('Invalid stored Q&A course ordering');
    return { id: required(row.id, 'content ID'), courseId, title: required(row.title, 'content title'),
      parentId: row.parentId, type: row.type, content: required(row.content, 'content'), order: row.order!,
      progressRevision: row.progressRevision, assignmentPassed: row.assignmentPassed ?? 0 };
  });
  const byId = new Map(contents.map(row => [row.id, row]));
  if (contents.length !== nodes.length || nodes.some(node => {
    const row = byId.get(node.id);
    return !row || row.parentId !== node.parentId || row.order !== node.order;
  })) return { contents: [], nodes: null };
  return { contents, nodes };
}

async function readSnapshot(courseId: string, actor: Actor, input: ReadInput): Promise<Snapshot> {
  if (!idPattern.test(courseId)) throw new CourseQAError('Kurs nicht gefunden.', 404);
  const db = database();
  const pattern = input.q ? `%${input.q}%` : '';
  const shortPattern = Buffer.byteLength(pattern, 'utf8') <= 50 ? 1 : 0;
  let manifest = '[]';
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await db.prepare(snapshotSql).bind(actor.id, courseId, actor.role ?? '', input.filter, pattern,
      input.pair?.publicationId ?? null, input.pair?.contentId ?? null, input.cursor?.createdAt.getTime() ?? null,
      input.cursor?.id ?? '', input.questionId, input.mode, JSON.stringify(input.ids), manifest, shortPattern).all<Row>();
    if (!result.success) throw new Error('D1 Q&A snapshot failed.');
    const access = result.results.find(row => row.kind === 'access');
    if (!access) throw new Error('Missing D1 Q&A snapshot');
    if (!access.accountExists) throw new CourseQAError('Nicht authentifiziert.', 401);
    if (!access.courseExists) throw new CourseQAError('Kurs nicht gefunden.', 404);
    if (!access.published && !access.canModerate) throw new CourseQAError('Kurs nicht gefunden.', 404);
    if (!access.canModerate && !access.enrolled) throw new CourseQAError('Kein Zugriff auf diesen Kurs.', 403);
    if (input.mode === 'list' && input.filter === 'hidden' && !access.canModerate) throw new CourseQAError('Kein Zugriff auf diesen Filter.', 403);
    if (input.mode === 'detail' && !access.questionExists) throw new CourseQAError('Frage nicht gefunden.', 404);
    if (access.answersOverflow) throw new CourseQAError('Zu viele Antworten für diese Ansicht.', 413);
    if (access.oversize) throw new CourseQAError('Diese Ansicht ist zu groß.', 413);
    const topology = contextTopology(result.results, access, courseId);
    const next = topology.nodes === null ? '[]' : JSON.stringify(topology.contents.map(row => ({ id: row.id,
      revision: courseContentRevision(row) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (Buffer.byteLength(next, 'utf8') > MAX_MANIFEST_BYTES) throw new CourseQAError('Diese Ansicht ist zu groß.', 413);
    // Only this final SQL read supplies identity, access, Q&A, private lesson
    // bytes, current-revision progress and latest-grade evidence. A bootstrap
    // manifest never authorizes a returned row or substitutes stale evidence.
    if (next === manifest) return { rows: result.results, access, ...topology, now: Date.now() };
    manifest = next;
  }
  throw new CourseQAError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}

function projection(snapshot: Snapshot, courseId: string) {
  let projected: Map<string, CourseQaLessonContext> | undefined;
  const project = () => {
    if (projected) return projected;
    projected = new Map();
    const { nodes, contents, access, now } = snapshot;
    if (!nodes) return projected;
    const leaves = courseLeaves(contents);
    // Legacy assignmentPassedContentIds excludes invalid/blank assignment
    // prompts before considering the latest current-revision grade decision.
    const rawCompleted = leaves.filter(row => row.type === 'ASSIGNMENT'
      ? Boolean(parseAssignmentContent(row.content)?.prompt.trim() && (row as Content).assignmentPassed)
      : (row as Content).progressRevision === courseContentRevision(row)).map(row => row.id);
    const completion = coursePathAccess(nodes, rawCompleted, now);
    const completedIds = leaves.filter(row => completion.get(row.id)?.completed).map(row => row.id);
    const gates = coursePathAccess(nodes, completedIds, now);
    const byId = new Map(contents.map(row => [row.id, row]));
    const parents = new Set(nodes.map(node => node.parentId));
    for (const node of nodes) {
      const row = byId.get(node.id)!;
      const target = node as PathNode & { type?: unknown; content?: unknown };
      const type = target.type === 'QUIZ' ? 'TEXT' : target.type;
      if (!parents.has(node.id) && typeof target.content === 'string' &&
          [null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'ASSIGNMENT'].includes(type as string | null) &&
          row.title === node.title && row.type === type && row.content === target.content && gates.get(node.id)?.locked === false) {
        projected.set(node.id, { status: 'current', publicationId: access.activePublicationId!, contentId: node.id,
          title: row.title, href: `/courses/${encodeURIComponent(courseId)}/contents?content=${encodeURIComponent(node.id)}` });
      }
    }
    return projected;
  };
  function context(pair: CourseQaLessonContextPair | null): CourseQaLessonContext {
    if (!pair) return null;
    if (pair.publicationId !== snapshot.access.activePublicationId) return unavailable;
    return project().get(pair.contentId) ?? unavailable;
  }
  return { context, scope(pair: CourseQaLessonContextPair | null): CourseQaScope {
    return pair ? { kind: 'lesson', lessonContext: context(pair) ?? unavailable } : { kind: 'course' };
  } };
}
function permissions(access: Row) {
  const canModerate = Boolean(access.canModerate);
  const canAsk = !canModerate && Boolean(access.enrolled) && access.activePublicationId !== null;
  return { canModerate, canAsk, canReply: canModerate || canAsk };
}
function summary(row: Row, lessonContext: CourseQaLessonContext) {
  return { id: required(row.id, 'question ID'), title: required(row.title, 'question title'), body: required(row.body, 'question body'),
    createdAt: date(row.createdAtMs).toISOString(), author: author(row), answerCount: row.answerCount ?? 0,
    acceptedAnswerId: row.answerId, revision: row.revision, hidden: Boolean(row.hidden), lessonContext };
}

export async function listD1CourseQuestions(courseId: string, actor: Actor, input: Query & { cursor: Cursor | null }) {
  const snapshot = await readSnapshot(courseId, actor, { ...input, mode: 'list', questionId: '', ids: [] });
  const project = projection(snapshot, courseId);
  const scope = project.scope(input.pair);
  const access = permissions(snapshot.access);
  const page = snapshot.rows.filter(row => row.kind === 'question').sort((a, b) => date(b.createdAtMs).getTime() - date(a.createdAtMs).getTime() ||
    (a.id! < b.id! ? 1 : a.id! > b.id! ? -1 : 0));
  const last = page[page.length - 1];
  return { items: page.map(row => summary(row, project.context(storedPair(row)))), scope,
    canAskInScope: access.canAsk && (scope.kind === 'course' || scope.lessonContext.status === 'current'),
    nextCursor: snapshot.access.hasMore && last ? Buffer.from(JSON.stringify({ v: 2, courseId, filter: input.filter,
      q: input.q, id: last.id, createdAt: date(last.createdAtMs).toISOString(), lessonContext: input.pair })).toString('base64url') : null,
    ...access };
}

export async function revalidateD1CourseQuestionIds(courseId: string, actor: Actor, input: Query & { ids: string[] }) {
  const snapshot = await readSnapshot(courseId, actor, { ...input, mode: 'revalidate', cursor: null, questionId: '' });
  const project = projection(snapshot, courseId);
  const scope = project.scope(input.pair);
  const access = permissions(snapshot.access);
  const rows = snapshot.rows.filter(row => row.kind === 'question');
  return { visibleIds: rows.map(row => required(row.id, 'question ID')),
    contexts: rows.map(row => ({ id: required(row.id, 'question ID'), lessonContext: project.context(storedPair(row)) })),
    scope, canAskInScope: access.canAsk && (scope.kind === 'course' || scope.lessonContext.status === 'current'), ...access };
}

export async function readD1CourseQuestion(courseId: string, questionId: string, actor: Actor) {
  if (!idPattern.test(questionId)) throw new CourseQAError('Frage nicht gefunden.', 404);
  const snapshot = await readSnapshot(courseId, actor, { mode: 'detail', questionId, ids: [], filter: 'all', q: '', pair: null, cursor: null });
  const question = snapshot.rows.find(row => row.kind === 'question')!;
  const project = projection(snapshot, courseId);
  const answers = snapshot.rows.filter(row => row.kind === 'answer').sort((a, b) => date(a.createdAtMs).getTime() - date(b.createdAtMs).getTime() ||
    (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0));
  return { question: summary(question, project.context(storedPair(question))), answers: answers.map(row => ({
    id: required(row.id, 'answer ID'), body: required(row.body, 'answer body'), createdAt: date(row.createdAtMs).toISOString(),
    author: author(row), hidden: Boolean(row.hidden),
  })), ...permissions(snapshot.access) };
}
