import 'server-only';

import { randomUUID } from 'node:crypto';
import type { CertificateSnapshot } from '@/lib/server/certificate-pdf';
import { CoursePathError } from '@/lib/server/course-path';
import { courseLearningDatabase, readD1CourseSnapshot, assertD1LearnerSnapshot,
  d1CompletionState, d1CourseSnapshotGuard, isD1CourseSnapshotConflict, d1LearningDate,
  type D1LearningActor } from '@/lib/server/d1-course-learning';
import { d1CourseRewardStatements, d1RewardNodes } from '@/lib/server/d1-course-rewards';

type CertificateRow = { id: string; userName: string; courseName: string; issuedAt: string | number };

const certificateSql = `SELECT cert.id, cert.userName, cert.courseName, cert.issuedAt
  FROM Certificate cert JOIN User u ON u.id = cert.userId JOIN Course c ON c.id = cert.courseId
  WHERE cert.userId = ? AND cert.courseId = ? ORDER BY cert.issuedAt DESC, cert.id DESC LIMIT 1`;

function present(row: CertificateRow): CertificateSnapshot {
  return { ...row, issuedAt: d1LearningDate(row.issuedAt) };
}

/** Existing credentials are historical, even after publication or enrollment
 * changes. New issuance, completion evidence and reward mirrors share a real
 * D1 batch guarded by the exact current learning snapshot. */
export async function issueD1CourseCertificate(actor: D1LearningActor, courseId: string) {
  const db = courseLearningDatabase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.prepare(certificateSql).bind(actor.id, courseId).first<CertificateRow>();
    if (existing) return present(existing);

    const snapshot = await readD1CourseSnapshot(db, actor, courseId);
    if (snapshot.certificate) {
      const issued = await db.prepare(certificateSql).bind(actor.id, courseId).first<CertificateRow>();
      if (issued) return present(issued);
      continue;
    }
    assertD1LearnerSnapshot(snapshot, { requireEnrollment: true, requirePublication: true });
    const state = d1CompletionState(snapshot);
    const now = new Date().toISOString().replace(/Z$/, '+00:00');
    const operationId = `certificate_${randomUUID()}`;
    const statements = [d1CourseSnapshotGuard(db, snapshot)];
    if (state.canIssueCertificate) statements.push(db.prepare(`
      INSERT INTO Certificate (id, userId, courseId, issuedAt, courseName, userName, publicationId)
      SELECT ?, u.id, c.id, ?, c.title, COALESCE(NULLIF(u.name, ''), u.email), c.activePublicationId
      FROM User u JOIN Course c ON c.id = ?
      WHERE u.id = ? AND NOT EXISTS (
        SELECT 1 FROM Certificate cert WHERE cert.userId = u.id AND cert.courseId = c.id)
    `).bind(randomUUID(), now, courseId, actor.id));
    statements.push(...d1CourseRewardStatements(db, {
      courseId, operationId, now, gate: { sql: 'SELECT 1', values: [] },
      nodes: d1RewardNodes(snapshot.contents), mode: { kind: 'learner', userId: actor.id },
    }));
    statements.push(db.prepare(certificateSql).bind(actor.id, courseId));
    try {
      const result = await db.batch(statements);
      const row = result[result.length - 1].results[0] as CertificateRow | undefined;
      if (row) return present(row);
      return false;
    } catch (error) {
      if (!isD1CourseSnapshotConflict(error)) throw error;
      if (attempt === 4) throw new CoursePathError('Course changed concurrently; retry', 409);
    }
  }
  throw new CoursePathError('Course changed concurrently; retry', 409);
}
