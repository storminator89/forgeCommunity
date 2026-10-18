import 'server-only';

import { env } from 'cloudflare:workers';
import { getQuizValidationError } from '@/app/courses/[courseId]/contents/types';
import { contentQuiz, courseLeaves } from '@/lib/server/course-progress';
import { courseQuizApprovalRevision } from '@/lib/server/rewards';
import { LearningPathwayError } from '@/lib/server/learning-pathways';

// Creation only. No publication payload, rewards, learner state, or schema writes.
// These are fail-closed operational byte budgets, never partial material reads
// or a product limit on content count. Large valid legacy sets can return 500.
type Scalar = string | number | null;
type Definition = { title: string; description: string; badgeLabel: string; courseIds: string[] };
type Content = { id: string; courseId: string; parentId: string | null; type: string | null; content: string; order: number };
type Course = { id: string; publicationId: string; price: number | null; rewardEligible: number;
  approvalRevision: string; title: string; contents: Content[] };
type Pathway = { id: string; title: string; description: string; badgeLabel: string; createdAt: Date;
  courses: { courseId: string; title: string; position: number }[] };
type Scope = { actorId: string; requestId: string; definition: Definition; header: string; now: string };
const ROW_BYTES = 200000;
const RESULT_BYTES = 1200000;
const MANIFEST_BYTES = 1400000; // Every cell is strictly below 1.5 MB.
const BATCH_BYTES = 8000000; // Own conservative complete SQL/binding wire budget.
const DATE_LIMIT = 8640000000000000;
const authorityMarker = 'D1_PATHWAY_CREATE_AUTHORITY_CHANGED';
const occupiedMarker = 'D1_PATHWAY_CREATE_REQUEST_OCCUPIED';
const snapshotMarker = 'D1_PATHWAY_CREATE_SNAPSHOT_CONFLICT';
const invariantMarker = 'D1_PATHWAY_CREATE_WRITE_INVARIANT';
const failure = (marker: string) => `json_extract('[]', '${marker}')`;
const ineligible = () => new LearningPathwayError('All courses must be currently published, free, and reward-approved', 409);
const missing = () => new LearningPathwayError('A course is no longer available', 409);
const collision = () => new LearningPathwayError('Request ID already used for another pathway', 409);

function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
type Database = ReturnType<typeof database>;
function bindingPlan(sql: string, values: Scalar[]) {
  const slots = [...sql.matchAll(/\?(\d+)/g)].map(match => Number(match[1]));
  const used = [...new Set(slots)].sort((left, right) => left - right);
  const highest = Math.max(0, ...slots);
  if (Buffer.byteLength(sql, 'utf8') > 100000 || highest > 100 || highest > values.length ||
    slots.some(slot => !Number.isSafeInteger(slot) || slot < 1)) throw new Error('Unsafe D1 Pathway creation statement');
  const bound = used.map(slot => values[slot - 1]);
  if (bound.some(value => value !== null && typeof value !== 'string' &&
    (typeof value !== 'number' || !Number.isFinite(value))) ||
    bound.some(value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 1500000)) {
    throw new Error('Unsafe D1 Pathway creation binding');
  }
  // Only numbered source-owned placeholders occur. Bind holes are removed so
  // unrelated statements never resend the large complete material manifest.
  const dense = new Map(used.map((slot, index) => [slot, index + 1]));
  return { sql: sql.replace(/\?(\d+)/g, (_match, slot: string) => `?${dense.get(Number(slot))}`), values: bound };
}
function statement(db: Database, sql: string, values: Scalar[]) {
  const planned = bindingPlan(sql, values);
  const prepared = db.prepare(planned.sql);
  return planned.values.length ? prepared.bind(...planned.values) : prepared;
}
function textBytes(fields: readonly string[]) {
  return fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)), 0)`).join(' + ');
}
function scalarTypes(fields: readonly string[]) {
  return fields.map(field => `typeof(${field}) IN ('null', 'text', 'integer', 'real')`).join(' AND ');
}
function basic(alias: string) {
  return `${alias}.activePublicationId IS NOT NULL AND ${alias}.activePublicationId <> ''
    AND (${alias}.price IS NULL OR ${alias}.price <= 0) AND ${alias}.rewardEligible <> 0
    AND ${alias}.rewardApprovalRevision IS NOT NULL AND ${alias}.rewardApprovalRevision <> ''`;
}
function keys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length ||
    expected.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid D1 Pathway creation projection');
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > ROW_BYTES) throw new Error('Invalid D1 Pathway creation text');
}
function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid D1 Pathway creation integer');
}
function bit(value: unknown): asserts value is number {
  if (value !== 0 && value !== 1) throw new Error('Invalid D1 Pathway creation bit');
}
function storedDate(value: unknown): Date {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < -DATE_LIMIT || value > DATE_LIMIT) throw new Error('Invalid D1 Pathway creation numeric date');
    const result = new Date(value);
    if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 Pathway creation date');
    return result;
  }
  text(value);
  if (!value.length || Buffer.byteLength(value, 'utf8') > 1024) throw new Error('Oversized D1 Pathway creation date');
  // Same bounded absolute normalizer as the delivered moderation helper. Raw
  // dates remain unmodified in SQL receipts/guards; zero is a present date.
  const dateOnly = /^\d{4}-\d\d-\d\d$/.exec(value);
  let normalized: string;
  if (dateOnly && dateOnly[0] === value) normalized = `${value}T00:00:00Z`;
  else {
    const absolute = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(value);
    if (!absolute || absolute[0] !== value || value.includes('\0')) throw new Error('Invalid D1 Pathway creation date');
    normalized = value.replace(' ', 'T');
    if (absolute[1] === undefined) normalized += 'Z';
    else if (absolute[1] !== 'Z' && absolute[1].length === 3) normalized += ':00';
  }
  const result = new Date(normalized);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 Pathway creation date');
  return result;
}

// Exact JSON string size, including control escapes and lone surrogates,
// without constructing an encoded string or invoking application helpers.
function jsonStringBytes(value: string) {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else bytes += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
  }
  return bytes;
}
// Count complete escaped JSON before constructing the aggregate string. Every
// string is independently bounded before its small JSON encoding is measured.
function boundedJson(value: unknown): string {
  let bytes = 0;
  const add = (amount: number) => { bytes += amount; if (bytes > MANIFEST_BYTES) throw new Error('D1 Pathway creation JSON exceeds safe byte limits'); };
  const visit = (item: unknown): void => {
    if (item === null) { add(4); return; }
    if (typeof item === 'string') { text(item); add(jsonStringBytes(item)); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw new Error('Invalid D1 Pathway creation JSON number'); add(String(item).length); return; }
    if (typeof item === 'boolean') { add(item ? 4 : 5); return; }
    if (Array.isArray(item)) { add(2 + Math.max(0, item.length - 1)); for (const entry of item) visit(entry); return; }
    if (item && typeof item === 'object') {
      const entries = Object.entries(item);
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, entry] of entries) { add(jsonStringBytes(key) + 1); visit(entry); }
      return;
    }
    throw new Error('Invalid D1 Pathway creation JSON value');
  };
  visit(value);
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result, 'utf8') !== bytes) throw new Error('Invalid D1 Pathway creation JSON size');
  return result;
}
function parsed(value: unknown): unknown {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > RESULT_BYTES) throw new Error('Oversized D1 Pathway creation result');
  return JSON.parse(value) as unknown;
}
function one(result: unknown, fields: readonly string[]) {
  keys(result, ['success', 'results', 'meta']);
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) throw new Error('Incomplete D1 Pathway creation read');
  const row: unknown = result.results[0]; keys(row, fields);
  return row;
}

/** Authority and exact receipt classification are deliberately small. The full
 * historical child count/position-sorted IDs are compared before any payload
 * transport. Receipt-only SQL contains no Course/CourseContent reads at all.
 * Material and title JSON are built only behind raw type/byte/aggregate gates. */
function contextSql(receiptOnly: boolean) {
  const missingCount = receiptOnly ? '0' : `(SELECT COUNT(*) FROM requested r LEFT JOIN Course c ON c.id = r.id WHERE c.id IS NULL)`;
  const courseBasics = receiptOnly ? `'[]'` : `(SELECT json_group_array(json_object('id', r.id, 'basic', r.basic))
      FROM (SELECT r.id, CASE WHEN ${basic('c')} THEN 1 ELSE 0 END AS basic
        FROM requested r JOIN Course c ON c.id = r.id ORDER BY r.ordinal) r)`;
  const headerFields = ['d.id', 'd.title', 'd.description', 'd.badgeLabel', 'd.createdById', 'd.createdAt', 'd.sealedAt'];
  const childFields = ['c.courseId', 'c.title', 'c.position'];
  return `WITH requested AS (
      SELECT CAST(j.key AS INTEGER) AS ordinal, j.value AS id FROM json_each(?3, '$.courseIds') j
    ), target AS (SELECT d.* FROM LearningPathway d WHERE d.id = ?2), authority AS (
      SELECT EXISTS(SELECT 1 FROM User u WHERE u.id = ?1 AND u.role = 'ADMIN') AS authorized
    ), ordered_children AS (
      SELECT c.courseId, ROW_NUMBER() OVER (ORDER BY c.position ASC) - 1 AS ordinal
      FROM LearningPathwayCourse c WHERE c.pathwayId = ?2
    ), classification AS (
      SELECT a.authorized, EXISTS(SELECT 1 FROM target) AS found,
        EXISTS(SELECT 1 FROM target d WHERE d.sealedAt IS NOT NULL AND d.createdById IS ?1
          AND d.title IS json_extract(?3, '$.title') AND d.description IS json_extract(?3, '$.description')
          AND d.badgeLabel IS json_extract(?3, '$.badgeLabel')
          AND (SELECT COUNT(*) FROM LearningPathwayCourse c WHERE c.pathwayId = ?2) = (SELECT COUNT(*) FROM requested)
          AND NOT EXISTS(SELECT 1 FROM requested r LEFT JOIN ordered_children c ON c.ordinal = r.ordinal
            WHERE c.courseId IS NOT r.id)) AS matches FROM authority a
    ), receipt_access AS (SELECT * FROM classification WHERE authorized = 1 AND matches = 1), sizes AS (
      SELECT ${textBytes(headerFields)} AS bytes, (${scalarTypes(headerFields)}
        AND typeof(d.createdAt) IN ('text', 'integer', 'real') AND typeof(d.sealedAt) IN ('text', 'integer', 'real')
        AND length(CAST(d.createdAt AS BLOB)) <= 1024 AND length(CAST(d.sealedAt AS BLOB)) <= 1024) AS typed
        FROM receipt_access a CROSS JOIN target d
      UNION ALL SELECT ${textBytes(childFields)} AS bytes, (${scalarTypes(childFields)}) AS typed
        FROM receipt_access a CROSS JOIN LearningPathwayCourse c WHERE c.pathwayId = ?2
    ), budget AS (
      SELECT (COALESCE(MIN(typed), 1) = 1 AND COALESCE(MAX(bytes), 0) <= ${ROW_BYTES}
        AND COALESCE(SUM(6 * bytes + 4096), 0) + 4096 <= ${RESULT_BYTES}) AS fits FROM sizes
    ) SELECT a.authorized, a.found, a.matches,
      CASE WHEN a.authorized = 1 AND a.found = 0 THEN ${missingCount} ELSE 0 END AS missing,
      b.fits AS receiptFits,
      CASE WHEN a.authorized = 1 AND a.matches = 1 AND b.fits = 1 THEN (
        SELECT json_object('id', d.id, 'title', d.title, 'description', d.description, 'badgeLabel', d.badgeLabel,
          'createdById', d.createdById, 'createdAt', d.createdAt, 'sealedAt', d.sealedAt,
          'courses', json((SELECT json_group_array(json_object('courseId', c.courseId, 'title', c.title, 'position', c.position))
            FROM (SELECT courseId, title, position FROM LearningPathwayCourse WHERE pathwayId = ?2 ORDER BY position ASC) c))) FROM target d
      ) END AS receipt,
      CASE WHEN a.authorized = 1 AND a.found = 0 THEN ${courseBasics} ELSE '[]' END AS courseBasics
      FROM classification a CROSS JOIN budget b`;
}
function receipt(value: unknown, scope: Scope): Pathway {
  keys(value, ['id', 'title', 'description', 'badgeLabel', 'createdById', 'createdAt', 'sealedAt', 'courses']);
  for (const field of ['id', 'title', 'description', 'badgeLabel', 'createdById']) text(value[field]);
  if (value.id !== scope.requestId || value.createdById !== scope.actorId || value.title !== scope.definition.title ||
    value.description !== scope.definition.description || value.badgeLabel !== scope.definition.badgeLabel ||
    value.sealedAt === null || !Array.isArray(value.courses) || value.courses.length !== scope.definition.courseIds.length) {
    throw new Error('Unexpected D1 Pathway creation receipt');
  }
  storedDate(value.sealedAt);
  const createdAt = storedDate(value.createdAt);
  let previous = Number.NEGATIVE_INFINITY;
  const seen = new Set<string>();
  const courses = value.courses.map((child: unknown, index: number) => {
    keys(child, ['courseId', 'title', 'position']); text(child.courseId); text(child.title); integer(child.position);
    if (child.courseId !== scope.definition.courseIds[index] || child.position <= previous || seen.has(child.courseId)) {
      throw new Error('Unexpected D1 Pathway creation course receipt');
    }
    previous = child.position; seen.add(child.courseId);
    return { courseId: child.courseId, title: child.title, position: child.position };
  });
  const pathway = { id: value.id as string, title: value.title as string, description: value.description as string,
    badgeLabel: value.badgeLabel as string, createdAt, courses };
  boundedJson({ ...pathway, createdAt: createdAt.toISOString() });
  return pathway;
}
async function readContext(db: Database, scope: Scope, receiptOnly: boolean): Promise<{ pathway: Pathway | null; basics: boolean[] }> {
  const raw = one(await statement(db, contextSql(receiptOnly), [scope.actorId, scope.requestId, scope.header]).all(),
    ['authorized', 'found', 'matches', 'missing', 'receiptFits', 'receipt', 'courseBasics']);
  for (const field of ['authorized', 'found', 'matches', 'receiptFits']) bit(raw[field]);
  if (raw.authorized !== 1) throw new LearningPathwayError('Forbidden', 403);
  if (raw.found === 1 && raw.matches !== 1) throw collision();
  if (raw.found === 1) {
    if (raw.receiptFits !== 1) throw new Error('D1 Pathway creation receipt exceeds safe byte limits');
    return { pathway: receipt(parsed(raw.receipt), scope), basics: [] };
  }
  if (receiptOnly) throw new LearningPathwayError('Pathway creation changed concurrently; retry', 409);
  integer(raw.missing, 0);
  if (raw.missing !== 0) throw missing();
  const basics = parsed(raw.courseBasics);
  if (!Array.isArray(basics) || basics.length !== scope.definition.courseIds.length) throw new Error('Incomplete D1 Pathway creation course context');
  return { pathway: null, basics: basics.map((value: unknown, index: number) => {
    keys(value, ['id', 'basic']); bit(value.basic);
    if (value.id !== scope.definition.courseIds[index]) throw new Error('Unordered D1 Pathway creation course context');
    return value.basic === 1;
  }) };
}

function materialSql() {
  const contentFields = ['n.id', 'n.courseId', 'n.parentId', 'n.type', 'n.content', 'n."order"'];
  // A revision longer than 1024 UTF-8 bytes cannot equal the fixed 64-character
  // source fingerprint. Keep that mismatch until AFTER valid-quiz evaluation;
  // never transport the irrelevant oversized revision or hide an earlier 409.
  const courseFields = ['c.id', 'c.activePublicationId', 'c.price', 'c.rewardEligible',
    'CASE WHEN length(CAST(c.rewardApprovalRevision AS BLOB)) <= 1024 THEN c.rewardApprovalRevision END'];
  return `WITH target AS (SELECT c.* FROM Course c WHERE c.id = ?1), access AS (
      SELECT c.* FROM target c WHERE ${basic('c')}
    ), material AS (
      SELECT n.id, n.courseId, n.parentId, n.type, n.content, n."order" FROM CourseContent n
      JOIN access c ON c.id = n.courseId WHERE n.archivedAt IS NULL AND c.activePublicationId IS NOT NULL
    ), sizes AS (
      SELECT ${textBytes(contentFields)} AS bytes, (${scalarTypes(contentFields)}) AS typed FROM material n
      UNION ALL SELECT ${textBytes(courseFields)} AS bytes,
        (typeof(c.id) = 'text' AND typeof(c.activePublicationId) = 'text' AND typeof(c.price) IN ('null', 'integer', 'real')
          AND typeof(c.rewardEligible) = 'integer' AND c.rewardEligible IN (0, 1)
          AND typeof(c.rewardApprovalRevision) = 'text') AS typed FROM access c
    ), budget AS (
      SELECT (COALESCE(MIN(typed), 1) = 1 AND COALESCE(MAX(bytes), 0) <= ${ROW_BYTES}
        AND COALESCE(SUM(6 * bytes + 4096), 0) + 4096 <= ${RESULT_BYTES}) AS fits FROM sizes
    ) SELECT EXISTS(SELECT 1 FROM target) AS found, EXISTS(SELECT 1 FROM access) AS basic,
      b.fits, COALESCE((SELECT length(CAST(c.rewardApprovalRevision AS BLOB)) <= 1024 FROM access c), 0) AS revisionFits,
      CASE WHEN b.fits = 1 THEN (SELECT json_object('id', c.id, 'publicationId', c.activePublicationId,
        'price', c.price, 'rewardEligible', c.rewardEligible,
        'approvalRevision', CASE WHEN length(CAST(c.rewardApprovalRevision AS BLOB)) <= 1024 THEN c.rewardApprovalRevision END,
        'contents', json((SELECT json_group_array(json_object('id', n.id, 'courseId', n.courseId, 'parentId', n.parentId,
          'type', n.type, 'content', n.content, 'order', n."order")) FROM material n))) FROM access c) END AS payload
      FROM budget b`;
}
async function readMaterial(db: Database, courseId: string): Promise<Omit<Course, 'title'>> {
  const raw = one(await statement(db, materialSql(), [courseId]).all(), ['found', 'basic', 'fits', 'revisionFits', 'payload']);
  for (const field of ['found', 'basic', 'fits', 'revisionFits']) bit(raw[field]);
  if (raw.found !== 1) throw missing();
  if (raw.basic !== 1) throw ineligible();
  if (raw.fits !== 1) throw new Error('D1 Pathway creation material exceeds safe byte limits');
  const value = parsed(raw.payload);
  keys(value, ['id', 'publicationId', 'price', 'rewardEligible', 'approvalRevision', 'contents']);
  text(value.id); text(value.publicationId); bit(value.rewardEligible);
  if (value.id !== courseId || !value.publicationId || value.rewardEligible !== 1 ||
    (value.price !== null && (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price > 0)) ||
    !Array.isArray(value.contents)) throw new Error('Invalid D1 Pathway creation course');
  if (raw.revisionFits === 1) text(value.approvalRevision);
  else if (value.approvalRevision !== null) throw new Error('Invalid D1 Pathway creation revision projection');
  const seen = new Set<string>();
  const contents: Content[] = value.contents.map((item: unknown) => {
    keys(item, ['id', 'courseId', 'parentId', 'type', 'content', 'order']);
    text(item.id); text(item.courseId); text(item.content); integer(item.order);
    if (item.parentId !== null) text(item.parentId);
    if (item.type !== null) text(item.type);
    if (item.courseId !== courseId || seen.has(item.id)) throw new Error('Incomplete D1 Pathway creation material set');
    seen.add(item.id);
    return item as Content;
  });
  // Preserve original orphan/cycle behavior and raw QUIZ/assignment material.
  boundedJson(value);
  if (!courseLeaves(contents).some(content => { const quiz = contentQuiz(content); return quiz !== null && getQuizValidationError(quiz) === null; })) throw ineligible();
  const revision = courseQuizApprovalRevision(contents);
  if (raw.revisionFits !== 1 || value.approvalRevision !== revision) throw ineligible();
  return { id: value.id, publicationId: value.publicationId, price: value.price as number | null,
    rewardEligible: value.rewardEligible, approvalRevision: revision,
    contents: [...contents].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0) };
}

function titlesSql() {
  return `WITH requested AS (SELECT CAST(j.key AS INTEGER) AS ordinal, j.value AS id FROM json_each(?1) j),
    records AS (SELECT r.ordinal, c.id, c.title FROM requested r JOIN Course c ON c.id = r.id), sizes AS (
      SELECT (${textBytes(['r.id', 'r.title'])}) AS bytes, (typeof(r.id) = 'text' AND typeof(r.title) = 'text') AS typed FROM records r
    ), budget AS (
      SELECT (COALESCE(MIN(typed), 1) = 1 AND COALESCE(MAX(bytes), 0) <= ${ROW_BYTES}
        AND COALESCE(SUM(6 * bytes + 4096), 0) + 4096 <= ${RESULT_BYTES}) AS fits FROM sizes
    ) SELECT (SELECT COUNT(*) FROM records) AS total, b.fits,
      CASE WHEN b.fits = 1 THEN (SELECT json_group_array(json_object('id', r.id, 'title', r.title))
        FROM (SELECT id, title FROM records ORDER BY ordinal) r) END AS payload FROM budget b`;
}
async function readPlan(db: Database, scope: Scope, basics: boolean[]): Promise<Course[]> {
  const material: Omit<Course, 'title'>[] = [];
  for (const [index, id] of scope.definition.courseIds.entries()) {
    if (!basics[index]) throw ineligible();
    material.push(await readMaterial(db, id));
  }
  const raw = one(await statement(db, titlesSql(), [boundedJson(scope.definition.courseIds)]).all(), ['total', 'fits', 'payload']);
  integer(raw.total, 0); bit(raw.fits);
  if (raw.total !== material.length) throw missing();
  if (raw.fits !== 1) throw new Error('D1 Pathway creation titles exceed safe byte limits');
  const titles = parsed(raw.payload);
  if (!Array.isArray(titles) || titles.length !== material.length) throw new Error('Incomplete D1 Pathway creation titles');
  return material.map((course, index) => {
    const title: unknown = titles[index]; keys(title, ['id', 'title']); text(title.title);
    if (title.id !== course.id) throw new Error('Unordered D1 Pathway creation titles');
    return { ...course, title: title.title };
  });
}

function sourceSetPredicate() {
  return `(SELECT COUNT(*) FROM Course c WHERE EXISTS(SELECT 1 FROM json_each(?4) e WHERE json_extract(e.value, '$.id') IS c.id)) = json_array_length(?4)
    AND NOT EXISTS(SELECT 1 FROM json_each(?4) e LEFT JOIN Course c ON c.id = json_extract(e.value, '$.id')
      WHERE c.id IS NULL OR c.title IS NOT json_extract(e.value, '$.title')
        OR c.activePublicationId IS NOT json_extract(e.value, '$.publicationId')
        OR c.price IS NOT json_extract(e.value, '$.price') OR c.rewardEligible IS NOT json_extract(e.value, '$.rewardEligible')
        OR c.rewardApprovalRevision IS NOT json_extract(e.value, '$.approvalRevision')
        OR (SELECT COUNT(*) FROM CourseContent n WHERE n.courseId = c.id AND n.archivedAt IS NULL AND c.activePublicationId IS NOT NULL)
          <> json_array_length(e.value, '$.contents')
        OR EXISTS(SELECT 1 FROM json_each(e.value, '$.contents') m LEFT JOIN CourseContent n ON n.id = json_extract(m.value, '$.id')
          WHERE n.id IS NULL OR n.courseId IS NOT c.id OR n.archivedAt IS NOT NULL OR c.activePublicationId IS NULL
            OR n.courseId IS NOT json_extract(m.value, '$.courseId') OR n.parentId IS NOT json_extract(m.value, '$.parentId')
            OR n.type IS NOT json_extract(m.value, '$.type') OR n.content IS NOT json_extract(m.value, '$.content')
            OR n."order" IS NOT json_extract(m.value, '$.order')))`;
}
function headerPredicate(sealed: boolean) {
  return `EXISTS(SELECT 1 FROM LearningPathway d WHERE d.id = ?2 AND d.createdById IS ?1
    AND d.title IS json_extract(?3, '$.title') AND d.description IS json_extract(?3, '$.description')
    AND d.badgeLabel IS json_extract(?3, '$.badgeLabel') AND d.createdAt IS ?5
    AND d.sealedAt ${sealed ? 'IS ?5' : 'IS NULL'})`;
}
function childrenPredicate() {
  return `(SELECT COUNT(*) FROM LearningPathwayCourse c WHERE c.pathwayId = ?2) = json_array_length(?6)
    AND NOT EXISTS(SELECT 1 FROM json_each(?6) e LEFT JOIN LearningPathwayCourse c
      ON c.pathwayId = ?2 AND c.position IS json_extract(e.value, '$.position')
      WHERE c.pathwayId IS NULL OR c.courseId IS NOT json_extract(e.value, '$.courseId') OR c.title IS NOT json_extract(e.value, '$.title'))`;
}
function batch(db: Database, scope: Scope, courses: Course[]) {
  const manifest = boundedJson(courses);
  const children = courses.map((course, position) => ({ courseId: course.id, title: course.title, position }));
  const expectedReceipt = boundedJson({ id: scope.requestId, title: scope.definition.title, description: scope.definition.description,
    badgeLabel: scope.definition.badgeLabel, createdById: scope.actorId, createdAt: scope.now, sealedAt: scope.now, courses: children });
  if (Buffer.byteLength(expectedReceipt, 'utf8') > RESULT_BYTES) throw new Error('D1 Pathway creation receipt exceeds safe byte limits');
  const values: Scalar[] = [scope.actorId, scope.requestId, scope.header, manifest, scope.now, boundedJson(children)];
  const before = `SELECT CASE
    WHEN NOT EXISTS(SELECT 1 FROM User u WHERE u.id = ?1 AND u.role = 'ADMIN') THEN ${failure(authorityMarker)}
    WHEN EXISTS(SELECT 1 FROM LearningPathway d WHERE d.id = ?2) THEN ${failure(occupiedMarker)}
    WHEN NOT (${sourceSetPredicate()}) THEN ${failure(snapshotMarker)} ELSE 1 END AS guarded`;
  const unsealed = `SELECT CASE WHEN changes() = 1 AND ${headerPredicate(false)}
    AND NOT EXISTS(SELECT 1 FROM LearningPathwayCourse c WHERE c.pathwayId = ?2)
    THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
  const childrenGuard = `SELECT CASE WHEN changes() = json_array_length(?6) AND ${headerPredicate(false)}
    AND ${childrenPredicate()} THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
  const sealed = `SELECT CASE WHEN changes() = 1 AND ${headerPredicate(true)} AND ${childrenPredicate()}
    THEN 1 ELSE ${failure(invariantMarker)} END AS guarded`;
  // The last SELECT always emits its assertion, even when a trigger removed or
  // changed the target. Its payload comes from actual persisted rows, not plan.
  const afterPredicate = `EXISTS(SELECT 1 FROM User u WHERE u.id = ?1 AND u.role = 'ADMIN')
      AND ${headerPredicate(true)} AND ${childrenPredicate()} AND (${sourceSetPredicate()})`;
  const after = `SELECT CASE WHEN ${afterPredicate} THEN 1 ELSE ${failure(invariantMarker)} END AS guarded,
    CASE WHEN ${afterPredicate} THEN (SELECT json_object('id', d.id, 'title', d.title, 'description', d.description, 'badgeLabel', d.badgeLabel,
      'createdById', d.createdById, 'createdAt', d.createdAt, 'sealedAt', d.sealedAt,
      'courses', json((SELECT json_group_array(json_object('courseId', c.courseId, 'title', c.title, 'position', c.position))
        FROM (SELECT courseId, title, position FROM LearningPathwayCourse WHERE pathwayId = ?2 ORDER BY position ASC) c)))
      FROM LearningPathway d WHERE d.id = ?2) END AS payload`;
  const queries = [
    before,
    `INSERT INTO LearningPathway (id, title, description, badgeLabel, createdById, createdAt, sealedAt)
      VALUES (?2, json_extract(?3, '$.title'), json_extract(?3, '$.description'), json_extract(?3, '$.badgeLabel'), ?1, ?5, NULL)`,
    unsealed,
    `INSERT INTO LearningPathwayCourse (pathwayId, position, courseId, title)
      SELECT ?2, json_extract(e.value, '$.position'), json_extract(e.value, '$.courseId'), json_extract(e.value, '$.title') FROM json_each(?6) e`,
    childrenGuard,
    `UPDATE LearningPathway SET sealedAt = ?5 WHERE id = ?2 AND sealedAt IS NULL`,
    sealed,
    after,
  ];
  // Bound the complete batch before preparing/submitting it. The allowance
  // includes SQL/parameter JSON quoting, array punctuation and ample fixed
  // per-statement wrapper overhead, not just unescaped material bytes.
  let wireBytes = 2;
  for (const query of queries) {
    const planned = bindingPlan(query, values);
    wireBytes += jsonStringBytes(planned.sql) + 128 + 2 + Math.max(0, planned.values.length - 1);
    for (const value of planned.values) wireBytes += typeof value === 'string' ? jsonStringBytes(value) : value === null ? 4 : String(value).length;
    if (wireBytes > BATCH_BYTES) throw new Error('D1 Pathway creation batch exceeds safe byte limits');
  }
  const statements = queries.map(query => statement(db, query, values));
  if (statements.length !== 8) throw new Error('Unexpected D1 Pathway creation batch size');
  return { statements, manifest, children, expectedReceipt };
}

/** Only a bounded whole-cause SQL-qualified marker from our first throwing
 * preguard proves rollback. Deny constraints, arbitrary P2004, invariants,
 * BUSY, transport, unknown commit, malformed success and other markers first.
 * Receipt occupancy has a separate sticky receipt-only resolution branch. */
function sqlRollback(error: unknown, marker: string) {
  const details: string[] = [], seen = new Set<unknown>();
  let current = error, total = 0;
  try {
    for (let depth = 0; current !== null && current !== undefined; depth++) {
      if (depth >= 32 || seen.has(current)) return false;
      seen.add(current);
      if (typeof current === 'string') {
        if (current.length > 65536 || (total += current.length) > 262144) return false;
        details.push(current); break;
      }
      if (typeof current !== 'object') return false;
      const record = current as Record<string, unknown>;
      for (const field of ['message', 'name', 'code']) if (field in record) {
        const value = record[field];
        if (typeof value !== 'string' || value.length > 65536 || (total += value.length) > 262144) return false;
        if (field === 'code' && !/^(?:D1_ERROR|SQLITE_ERROR)$/.test(value)) return false;
        if (field === 'name' && !['Error', 'D1Error', 'D1_ERROR', 'SqliteError'].includes(value)) return false;
        details.push(value);
      }
      current = 'cause' in record ? record.cause : null;
    }
  } catch { return false; }
  if (details.some(value => /D1_[A-Z0-9_]*INVARIANT|\binvariant\b|constraint|\bunique\b|foreign[_\s-]*key|not[_\s-]*null|primary[_\s-]*key|\bCAS\b|\bP\d{4}\b|network|fetch|connection|transport|timeout|timed out|abort|cancel|\bcommit\b|unknown|socket|ECONN|EPIPE|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|\bRPC\b|\bHTTP\b|\bTLS\b|\bSSL\b|\bDNS\b|disconnect|broken pipe|unexpected token|invalid response|syntax error|no such (?:table|column|function)|datatype mismatch|out of memory|\bBUSY\b|\blocked\b/i.test(value))) return false;
  if (details.some(value => (value.match(/\bD1_[A-Z0-9_]+\b/g) ?? []).some(value => !['D1_ERROR', marker].includes(value)))) return false;
  if (details.some(value => (value.match(/\bSQLITE_[A-Z0-9_]+\b/g) ?? []).some(value => value !== 'SQLITE_ERROR'))) return false;
  const qualified = new RegExp(`\\b(?:D1_ERROR|SQLITE_ERROR)\\b[^\\n]*\\b${marker}\\b|\\b${marker}\\b[^\\n]*\\b(?:D1_ERROR|SQLITE_ERROR)\\b`);
  return details.some(value => qualified.test(value));
}
function committed(results: unknown, scope: Scope, expectedReceipt: string): Pathway {
  if (!Array.isArray(results) || results.length !== 8 || results.some(result => !result || typeof result !== 'object' ||
    result.success !== true || !Array.isArray(result.results))) throw new Error('Incomplete D1 Pathway creation batch');
  for (const index of [0, 2, 4, 6]) {
    const rows: unknown[] = results[index].results;
    if (rows.length !== 1) throw new Error('Missing D1 Pathway creation assertion');
    keys(rows[0], ['guarded']);
    if (rows[0].guarded !== 1) throw new Error('Invalid D1 Pathway creation assertion');
  }
  for (const index of [1, 3, 5]) if (results[index].results.length !== 0) throw new Error('Unexpected D1 Pathway creation mutation projection');
  const rows: unknown[] = results[7].results;
  if (rows.length !== 1) throw new Error('Missing committed D1 Pathway creation receipt');
  keys(rows[0], ['guarded', 'payload']);
  if (rows[0].guarded !== 1) throw new Error('Invalid committed D1 Pathway creation assertion');
  const raw = parsed(rows[0].payload);
  keys(raw, ['id', 'title', 'description', 'badgeLabel', 'createdById', 'createdAt', 'sealedAt', 'courses']);
  if (boundedJson(raw) !== expectedReceipt) {
    throw new Error('Unexpected committed D1 Pathway creation receipt');
  }
  return receipt(raw, scope);
}

/** Maximum THREE complete attempts, each <=1 context +4 material +1 titles
 * +8 batch statements =14. A SQL-proven occupancy gets at most one extra
 * receipt-only SELECT, including on the last attempt: <=43 helper statements,
 * <=46 including <=2 existing authentication +1 unchanged route availability.
 * The normal final snapshot conflict performs NO fourth plan/read. Successful
 * result decoding and route postcommit availability errors never write-retry. */
export async function createD1LearningPathwayDefinition(actorId: string, requestId: string, definition: Definition): Promise<{ pathway: Pathway; created: boolean }> {
  text(actorId); text(requestId);
  if (!Array.isArray(definition.courseIds) || definition.courseIds.length < 2 || definition.courseIds.length > 4) throw new Error('Invalid parsed D1 Pathway creation input');
  // Canonical request validation belongs to the unchanged route. IDs stay raw.
  const scope: Scope = { actorId, requestId, definition, header: boundedJson(definition),
    now: new Date().toISOString().replace(/Z$/, '+00:00') };
  storedDate(scope.now);
  const db = database();
  let previousManifest: string | null = null;
  let previousError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const context = await readContext(db, scope, false);
    if (context.pathway) return { pathway: context.pathway, created: false };
    const courses = await readPlan(db, scope, context.basics);
    // Validate complete scalar/date/DTO and manifest inputs BEFORE native write.
    boundedJson({ id: requestId, title: definition.title, description: definition.description, badgeLabel: definition.badgeLabel,
      createdAt: storedDate(scope.now).toISOString(), courses: courses.map((course, position) => ({ courseId: course.id, title: course.title, position })) });
    const prepared = batch(db, scope, courses);
    // Fresh authorization, receipt and source-ordered eligibility precede this
    // unchanged-plan invariant. A marker alone never grants another write.
    if (previousManifest !== null && previousManifest === prepared.manifest) throw previousError;
    let results: unknown;
    try { results = await db.batch(prepared.statements); }
    catch (error) {
      if (sqlRollback(error, authorityMarker)) throw new LearningPathwayError('Forbidden', 403);
      if (sqlRollback(error, occupiedMarker)) {
        const replay = await readContext(db, scope, true);
        if (!replay.pathway) throw new Error('Missing D1 Pathway creation collision receipt');
        return { pathway: replay.pathway, created: false };
      }
      if (!sqlRollback(error, snapshotMarker) || attempt === 2) throw error;
      previousManifest = prepared.manifest; previousError = error;
      continue;
    }
    return { pathway: committed(results, scope, prepared.expectedReceipt), created: true };
  }
  throw new Error('D1 Pathway creation retries exhausted');
}
