import 'server-only';

import { env } from 'cloudflare:workers';
import { parseAssignmentContent } from '@/app/courses/[courseId]/contents/assignment-content';
import { activeAssetContentIds, activeAssetReference, courseAssetUrl } from '@/lib/server/course-assets';
import { getCourseImage, type CourseImageRowMetadata } from '@/lib/server/course-image-r2';
import { courseContentRevision, courseLeaves, type ProgressContent } from '@/lib/server/course-progress';
import { coursePathAccess, publicationPathNodes } from '@/lib/server/course-path';

// Publication size matches course-authoring's 512 KiB payload ceiling. A
// 100,000-UTF-16-unit authored content fits the conservative 400,000-byte field
// ceiling. Other ceilings are operational fail-closed read limits, including
// for unsupported legacy data, not measured platform costs or legacy parity.
// Limits reject a complete response; none are pagination or truncation. Large
// scalar fields are checked inside the same SELECT before transport.
const MAX_PUBLICATION_BYTES = 512 * 1024;
const MAX_CONTENT_BYTES = 400000;
const MAX_LIVE_BYTES = 768 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_ROW_BYTES = 1900 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_READS = 5;

type Row = {
  kind: 'metadata' | 'publication' | 'content';
  actorExists: number | null; role: string | null; courseExists: number | null; instructorId: string | null;
  activePublicationId: string | null; imageUrl: string | null; assetExists: number | null;
  assetId: string | null; assetCourseId: string | null; storageKey: string | null; contentType: string | null; byteSize: number | null;
  enrolled: number | null; learningReady: number | null; contentCount: number | null; oversize: number | null;
  id: string | null; parentId: string | null; type: string | null; content: string | null; order: number | null;
  progressRevision: string | null; assignmentPassed: number | null; payload: string | null; payloadCourseId: string | null;
};
type Column = Exclude<keyof Row, 'kind'>;
const columns: Column[] = ['actorExists', 'role', 'courseExists', 'instructorId', 'activePublicationId', 'imageUrl',
  'assetExists', 'assetId', 'assetCourseId', 'storageKey', 'contentType', 'byteSize', 'enrolled', 'learningReady', 'contentCount',
  'oversize', 'id', 'parentId', 'type', 'content', 'order', 'progressRevision', 'assignmentPassed', 'payload', 'payloadCourseId'];
function selectRow(kind: Row['kind'], fields: Partial<Record<Column, string>>) {
  return `SELECT '${kind}' AS kind, ${columns.map(key => `${fields[key] ?? 'NULL'} AS "${key}"`).join(', ')}`;
}

// Six times UTF-8 source bytes bounds JSON escaping, including control bytes.
// The allowance covers every fixed key, null, boolean and integer in a typed
// row, with room for the D1 result envelope. Raw row limits are separate.
function wireCost(fields: string[]) {
  return `2048 + 6 * (${rawCost(fields)})`;
}
function rawCost(fields: string[]) {
  return fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)), 0)`).join(' + ') || '0';
}

// ?1 raw actor ID (or NULL), ?2 course, ?3 asset; ?4..?8 are a previously
// JS-confirmed CONTENT context, never an authorization grant. ?9 is its bounded
// current-revision manifest. Each execution obtains a FRESH first-primary
// session: subsequent queries on an old handle are not assumed primary reads.
// Declared unique(userId,contentId,attemptNumber) and unique(submissionId,
// sequence) make the latest attempt/decision singular. This port does not
// inspect or repair live DDL/unsupported legacy ties.
const snapshotSql = `WITH
  viewer AS (SELECT id, role FROM User WHERE id = ?1),
  course_row AS (SELECT id, instructorId, activePublicationId, imageUrl FROM Course WHERE id = ?2),
  asset_row AS (SELECT id, courseId, storageKey, contentType, byteSize FROM CourseAsset WHERE id = ?3),
  base AS MATERIALIZED (
    SELECT v.id IS NOT NULL AS actorExists, v.role, c.id IS NOT NULL AS courseExists, c.instructorId,
      c.activePublicationId, c.imageUrl, a.id IS NOT NULL AS assetExists, a.id AS assetId, a.courseId AS assetCourseId,
      a.storageKey, a.contentType, a.byteSize,
      (v.id IS NOT NULL AND (c.instructorId = ?1 OR v.role = 'ADMIN')) AS canAuthor,
      (c.id IS NOT NULL AND a.id IS NOT NULL AND a.courseId = c.id) AS sameCourseAsset
    FROM (SELECT 1) seed LEFT JOIN viewer v ON 1 = 1 LEFT JOIN course_row c ON 1 = 1 LEFT JOIN asset_row a ON 1 = 1
  ), metadata_source AS MATERIALIZED (
    SELECT b.*, CASE WHEN b.sameCourseAsset AND NOT b.canAuthor THEN b.activePublicationId END AS selectedPublicationId,
      CASE WHEN b.sameCourseAsset AND NOT b.canAuthor THEN b.imageUrl END AS selectedImageUrl,
      EXISTS (SELECT 1 FROM Enrollment e WHERE b.actorExists AND b.sameCourseAsset AND NOT b.canAuthor
        AND e.userId = ?1 AND e.courseId = ?2) AS enrolled
    FROM base b
  ), publication_source AS MATERIALIZED (
    SELECT p.id, p.courseId, p.payload FROM CoursePublication p JOIN metadata_source m
      ON p.id = m.selectedPublicationId AND p.courseId = ?2
    WHERE typeof(m.selectedPublicationId) = 'text' AND m.selectedPublicationId <> ''
  ), metadata_cost AS MATERIALIZED (
    SELECT CASE WHEN
      (m.actorExists AND (typeof(m.role) <> 'text' OR length(CAST(m.role AS BLOB)) > 128))
      OR (m.courseExists AND (typeof(m.instructorId) <> 'text' OR length(CAST(m.instructorId AS BLOB)) > 1024))
      OR (m.assetExists AND (typeof(m.assetId) <> 'text' OR length(CAST(m.assetId AS BLOB)) > 80
        OR typeof(m.assetCourseId) <> 'text' OR length(CAST(m.assetCourseId AS BLOB)) > 100
        OR typeof(m.storageKey) <> 'text' OR length(CAST(m.storageKey AS BLOB)) > 128
        OR typeof(m.contentType) <> 'text' OR length(CAST(m.contentType AS BLOB)) > 128 OR typeof(m.byteSize) <> 'integer'))
      OR (m.selectedPublicationId IS NOT NULL AND (typeof(m.selectedPublicationId) <> 'text'
        OR length(CAST(m.selectedPublicationId AS BLOB)) > 100))
      OR (m.selectedImageUrl IS NOT NULL AND (typeof(m.selectedImageUrl) <> 'text'
        OR length(CAST(m.selectedImageUrl AS BLOB)) > 8192))
      THEN ${MAX_RESPONSE_BYTES + 1}
      ELSE ${wireCost(['m.role', 'm.instructorId', 'm.selectedPublicationId', 'm.selectedImageUrl',
        'm.assetId', 'm.assetCourseId', 'm.storageKey', 'm.contentType'])} END AS wireBytes FROM metadata_source m
  ), publication_cost AS MATERIALIZED (
    SELECT CASE WHEN typeof(p.id) <> 'text' OR length(CAST(p.id AS BLOB)) > 100
      OR typeof(p.courseId) <> 'text' OR length(CAST(p.courseId AS BLOB)) > 100
      OR typeof(p.payload) <> 'text' OR length(CAST(p.payload AS BLOB)) > ${MAX_PUBLICATION_BYTES}
      THEN ${MAX_RESPONSE_BYTES + 1} ELSE ${wireCost(['p.id', 'p.courseId', 'p.payload'])} END AS wireBytes
    FROM publication_source p
  ), metadata_budget AS MATERIALIZED (
    SELECT (SELECT wireBytes FROM metadata_cost) AS metadataBytes,
      COALESCE((SELECT wireBytes FROM publication_cost), 0) AS publicationBytes,
      ((SELECT wireBytes FROM metadata_cost) > ${MAX_RESPONSE_BYTES}
        OR COALESCE((SELECT wireBytes FROM publication_cost), 0) > ${MAX_RESPONSE_BYTES}
        OR (SELECT 2048 + ${rawCost(['m.role', 'm.instructorId', 'm.selectedPublicationId', 'm.selectedImageUrl',
          'm.assetId', 'm.assetCourseId', 'm.storageKey', 'm.contentType'])} FROM metadata_source m) > ${MAX_ROW_BYTES}
        OR COALESCE((SELECT 2048 + ${rawCost(['p.id', 'p.courseId', 'p.payload'])} FROM publication_source p), 0) > ${MAX_ROW_BYTES}) AS oversize
  ), learning_context AS MATERIALIZED (
    SELECT m.* FROM metadata_source m JOIN publication_source p ON p.id = m.selectedPublicationId
    JOIN metadata_budget b ON NOT b.oversize
    WHERE m.actorExists AND m.sameCourseAsset AND NOT m.canAuthor AND m.enrolled
      AND p.id IS ?4 AND CAST(p.payload AS BLOB) IS CAST(?5 AS BLOB)
      AND m.selectedImageUrl IS ?6 AND m.instructorId IS ?7 AND m.role IS ?8
  ), live_source AS MATERIALIZED (
    SELECT x.id, x.parentId, x.type, x.content, x."order", progress.revision AS progressRevision
    FROM CourseContent x JOIN learning_context c ON x.courseId = ?2
    LEFT JOIN CourseContentProgress progress
      ON progress.userId = ?1 AND progress.courseId = ?2 AND progress.contentId = x.id
    WHERE x.archivedAt IS NULL
  ), live_cost AS MATERIALIZED (
    SELECT x.*, ${rawCost(['x.id', 'x.parentId', 'x.type', 'x.content', 'x.progressRevision'])} AS rawBytes,
      CASE WHEN typeof(x.id) <> 'text' OR length(CAST(x.id AS BLOB)) > 100
        OR (x.parentId IS NOT NULL AND (typeof(x.parentId) <> 'text' OR length(CAST(x.parentId AS BLOB)) > 100))
        OR (x.type IS NOT NULL AND (typeof(x.type) <> 'text' OR length(CAST(x.type AS BLOB)) > 32))
        OR typeof(x.content) <> 'text' OR length(CAST(x.content AS BLOB)) > ${MAX_CONTENT_BYTES}
        OR typeof(x."order") <> 'integer' OR x."order" < -9007199254740991 OR x."order" > 9007199254740991
        OR (x.progressRevision IS NOT NULL AND (typeof(x.progressRevision) <> 'text'
          OR length(CAST(x.progressRevision AS BLOB)) > 1024))
        THEN ${MAX_RESPONSE_BYTES + 1}
        ELSE ${wireCost(['x.id', 'x.parentId', 'x.type', 'x.content', 'x.progressRevision'])} END AS wireBytes
    FROM live_source x
  ), live_budget AS MATERIALIZED (
    SELECT COUNT(*) AS contentCount, COALESCE(SUM(rawBytes), 0) AS rawBytes,
      COALESCE(SUM(wireBytes), 0) AS wireBytes, COALESCE(MAX(2048 + rawBytes), 0) AS largestRow FROM live_cost
  ), budget AS MATERIALIZED (
    SELECT b.oversize OR l.contentCount > 500 OR l.rawBytes > ${MAX_LIVE_BYTES} OR l.largestRow > ${MAX_ROW_BYTES}
      OR b.metadataBytes + b.publicationBytes + l.wireBytes > ${MAX_RESPONSE_BYTES} AS oversize,
      l.contentCount FROM metadata_budget b, live_budget l
  )
  ${selectRow('metadata', {
    actorExists: 'CASE WHEN NOT b.oversize THEN m.actorExists END', role: 'CASE WHEN NOT b.oversize THEN m.role END',
    courseExists: 'CASE WHEN NOT b.oversize THEN m.courseExists END', instructorId: 'CASE WHEN NOT b.oversize THEN m.instructorId END',
    activePublicationId: 'CASE WHEN NOT b.oversize THEN m.selectedPublicationId END', imageUrl: 'CASE WHEN NOT b.oversize THEN m.selectedImageUrl END',
    assetExists: 'CASE WHEN NOT b.oversize THEN m.assetExists END', assetId: 'CASE WHEN NOT b.oversize THEN m.assetId END',
    assetCourseId: 'CASE WHEN NOT b.oversize THEN m.assetCourseId END',
    storageKey: 'CASE WHEN NOT b.oversize THEN m.storageKey END', contentType: 'CASE WHEN NOT b.oversize THEN m.contentType END',
    byteSize: 'CASE WHEN NOT b.oversize THEN m.byteSize END', enrolled: 'CASE WHEN NOT b.oversize THEN m.enrolled END',
    learningReady: 'EXISTS (SELECT 1 FROM learning_context)', contentCount: 'b.contentCount', oversize: 'b.oversize',
  })} FROM metadata_source m, budget b
  UNION ALL ${selectRow('publication', { id: 'p.id', payloadCourseId: 'p.courseId', payload: 'p.payload' })}
    FROM publication_source p, budget b WHERE NOT b.oversize
  UNION ALL ${selectRow('content', {
    id: 'x.id', parentId: 'x.parentId', type: 'x.type', content: 'x.content', order: 'x."order"', progressRevision: 'x.progressRevision',
    assignmentPassed: `EXISTS (SELECT 1 FROM AssignmentSubmission s
      JOIN json_each(?9) manifest ON json_extract(manifest.value, '$.id') = s.contentId
        AND json_extract(manifest.value, '$.revision') = s.revision
      JOIN AssignmentGradeDecision g ON g.id = (SELECT newest.id FROM AssignmentGradeDecision newest
        WHERE newest.submissionId = s.id ORDER BY newest.sequence DESC LIMIT 1)
      WHERE x.type = 'ASSIGNMENT' AND s.userId = ?1 AND s.courseId = ?2 AND s.contentId = x.id
        AND s.attemptNumber = (SELECT MAX(newer.attemptNumber) FROM AssignmentSubmission newer
          WHERE newer.userId = s.userId AND newer.courseId = s.courseId
            AND newer.contentId = s.contentId AND newer.revision = s.revision)
        AND g.action = 'GRADED' AND g.score >= s.passingScore)`,
  })} FROM live_cost x, budget b WHERE NOT b.oversize`;

type Context = { publicationId: string; payload: string; imageUrl: string | null; instructorId: string; role: string };
type Content = ProgressContent & { order: number; progressRevision: string | null; assignmentPassed: number };
type Asset = CourseImageRowMetadata;

function storedString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid course asset snapshot');
  return value;
}
function flag(value: unknown): number {
  if (value !== 0 && value !== 1) throw new Error('Invalid course asset snapshot');
  return value;
}
function assetMetadata(row: Row, courseId: string, assetId: string): Asset {
  if (row.assetId !== assetId || row.assetCourseId !== courseId || !Number.isSafeInteger(row.byteSize)) throw new Error('Invalid course asset snapshot');
  return { id: storedString(row.assetId), courseId: storedString(row.assetCourseId), storageKey: storedString(row.storageKey), contentType: storedString(row.contentType), byteSize: row.byteSize! };
}
function contentRow(row: Row, courseId: string): Content {
  if ((row.parentId !== null && typeof row.parentId !== 'string') || (row.type !== null && typeof row.type !== 'string') ||
      (row.progressRevision !== null && typeof row.progressRevision !== 'string') || !Number.isSafeInteger(row.order)) {
    throw new Error('Invalid course asset snapshot');
  }
  return { id: storedString(row.id), courseId, parentId: row.parentId, type: row.type, content: storedString(row.content),
    order: row.order!, progressRevision: row.progressRevision, assignmentPassed: flag(row.assignmentPassed) };
}
function revisionManifest(contents: Content[]) {
  const manifest = JSON.stringify(contents.map(content => ({ id: content.id, revision: courseContentRevision(content) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (Buffer.byteLength(manifest, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('Course asset manifest exceeds read budget');
  return manifest;
}
async function loadBytes(courseId: string, assetId: string, asset: Asset) {
  // These identities and row fields come from the final fresh-primary ACL
  // snapshot. The R2 reader verifies the private derived key, exact scope,
  // immutable identity, MIME, size and canonical bytes; it grants no authority.
  // A missing new-prefix object is not evidence of a legacy filesystem asset.
  return getCourseImage(courseId, assetId, asset);
}

/** Each GET/HEAD reauthorizes. Only the final single, fresh-primary SELECT is
 * the ACL linearization point. Earlier snapshots merely prepare context and
 * hashes; no previous authority is retained, and storage is never retried. */
export async function loadD1CourseAsset(actorId: string | null, courseId: string, assetId: string) {
  if (actorId !== null && (typeof actorId !== 'string' || Buffer.byteLength(actorId, 'utf8') > 1024)) {
    throw new Error('Invalid course asset actor');
  }
  const rawActorId = actorId || null;
  const url = courseAssetUrl(courseId, assetId);
  let context: Context | null = null;
  let manifest = '[]';
  for (let attempt = 0; attempt < MAX_SNAPSHOT_READS; attempt++) {
    // completionState's inner clock was taken before its completion reads.
    // Completed flags ignore releases; the decisive outer release clock below
    // is intentionally taken only after the final snapshot and completion.
    const completionNow = Date.now();
    let rows: Row[];
    try {
      if (!env.DB) throw new Error('Unavailable database');
      const result = await env.DB.withSession('first-primary').prepare(snapshotSql).bind(rawActorId, courseId, assetId,
        context?.publicationId ?? null, context?.payload ?? null, context?.imageUrl ?? null,
        context?.instructorId ?? null, context?.role ?? null, manifest).all<Row>();
      if (!result.success || !Array.isArray(result.results)) throw new Error('Incomplete database response');
      rows = result.results;
    } catch {
      // Provider failures can contain SQL/bindings. Do not pass those to the
      // existing route logger; this is a read failure, never a retry trigger.
      throw new Error('Course asset snapshot read failed');
    }
    const metadataRows = rows.filter(row => row.kind === 'metadata');
    const publicationRows = rows.filter(row => row.kind === 'publication');
    const contentRows = rows.filter(row => row.kind === 'content');
    if (metadataRows.length !== 1 || publicationRows.length > 1 || contentRows.length > 500 ||
        rows.length !== metadataRows.length + publicationRows.length + contentRows.length) throw new Error('Invalid course asset snapshot');
    const metadata = metadataRows[0];
    if (flag(metadata.oversize)) throw new Error('Course asset snapshot exceeds read budget');
    if (!flag(metadata.courseExists) || !flag(metadata.assetExists) || metadata.assetCourseId !== courseId) return null;
    const asset = assetMetadata(metadata, courseId, assetId);
    const actorExists = flag(metadata.actorExists) === 1;
    const instructorId = storedString(metadata.instructorId);
    if (actorExists && (instructorId === rawActorId || metadata.role === 'ADMIN')) return loadBytes(courseId, assetId, asset);
    if (!metadata.activePublicationId) return null;
    const publication = publicationRows[0];
    if (!publication || publication.id !== metadata.activePublicationId || publication.payloadCourseId !== courseId) return null;
    const payload = storedString(publication.payload);
    let parsed: unknown;
    let reference: 'cover' | 'content' | null;
    try { parsed = JSON.parse(payload); reference = activeAssetReference(parsed, url); }
    catch { return null; }
    if (!reference) return null;
    // Cover precedence is absolute, including when that asset is also inline.
    // This anonymous branch consumes no path, topology, progress or grade proof.
    if (reference === 'cover') return metadata.imageUrl === url ? loadBytes(courseId, assetId, asset) : null;
    if (!actorExists || !rawActorId || !flag(metadata.enrolled)) return null;
    const nodes = publicationPathNodes(payload);
    const nextContext: Context = { publicationId: metadata.activePublicationId, payload,
      imageUrl: metadata.imageUrl, instructorId, role: storedString(metadata.role) };
    if (!flag(metadata.learningReady)) {
      context = nextContext;
      manifest = '[]';
      continue;
    }
    if (!Number.isSafeInteger(metadata.contentCount) || metadata.contentCount !== contentRows.length) throw new Error('Incomplete course asset snapshot');
    const contents = contentRows.map(row => contentRow(row, courseId));
    const projected = new Map(contents.map(content => [content.id, content]));
    // The original completionState compares topology only. Live type/content
    // drive revision and grading; no published/live body or title equality gate.
    if (projected.size !== nodes.length || nodes.some(node => {
      const content = projected.get(node.id);
      return !content || content.parentId !== node.parentId || content.order !== node.order;
    })) throw new Error('Course asset publication topology mismatch');
    const nextManifest = revisionManifest(contents);
    if (nextManifest !== manifest) {
      context = nextContext;
      manifest = nextManifest;
      continue;
    }
    // Grade bits become usable only after this complete current source snapshot
    // reproduces the exact manifest bound to this very SELECT.
    const leaves = courseLeaves(contents).map(leaf => projected.get(leaf.id)!);
    const rawCompleted = leaves.filter(content => content.type === 'ASSIGNMENT'
      ? Boolean(parseAssignmentContent(content.content)?.prompt.trim() && content.assignmentPassed)
      : content.progressRevision === courseContentRevision(content)).map(content => content.id);
    const inner = coursePathAccess(nodes, rawCompleted, completionNow);
    const completedContentIds = leaves.filter(content => inner.get(content.id)?.completed).map(content => content.id);
    const access = coursePathAccess(nodes, completedContentIds);
    const referencedIds = activeAssetContentIds(parsed, url);
    // Referencing published parents/containers are eligible too; only the
    // completion evidence is leaf-based. Reference classification remains in
    // the separately reviewed course-assets helper, never in the byte adapter.
    if (!referencedIds.some(id => access.get(id)?.locked === false)) return null;
    return loadBytes(courseId, assetId, asset);
  }
  throw new Error('Course asset changed during snapshot preparation');
}
