import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sqlitePath } from './sqlite-init.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const reviewedSqlite = [
  '0001_initial.sql', '0002_skill_endorsements.sql', '0003_course_progress.sql',
  '0004_reports.sql', '0005_reward_ledger.sql', '0006_community_feed_indexes.sql',
  '0007_accepted_solutions.sql', '0008_notification_targets.sql',
  '0009_private_learning_goals.sql', '0010_staged_course_publication.sql',
  '0011_question_bank.sql', '0012_manual_assignments.sql',
  '0013_verified_learning_pathways.sql', '0014_quiz_confidence_evidence.sql',
  '0015_formative_practice_authoring.sql', '0016_formative_practice_learner.sql',
  '0017_chat_message_cursor_index.sql', '0018_chat_read_cursor.sql',
  '0019_course_qa.sql', '0020_spaces.sql', '0021_space_report_targets.sql',
  '0022_space_mission_foundation.sql', '0023_space_mission_contributions.sql',
  '0024_event_waitlist.sql', '0025_space_polls.sql',
];
const reviewedPostgresql = [
  '0001_skill_endorsements.sql', '0002_course_progress.sql', '0003_reports.sql',
  '0004_reward_ledger.sql', '0005_community_feed_indexes.sql',
  '0006_accepted_solutions.sql', '0007_notification_targets.sql',
  '0008_private_learning_goals.sql', '0009_staged_course_publication.sql',
  '0010_question_bank.sql', '0011_manual_assignments.sql',
  '0012_verified_learning_pathways.sql', '0013_quiz_confidence_evidence.sql',
  '0014_formative_practice_authoring.sql', '0015_formative_practice_learner.sql',
  '0016_chat_message_cursor_index.sql', '0017_chat_read_cursor.sql',
  '0018_course_qa.sql', '0019_spaces.sql', '0020_space_report_targets.sql',
  '0021_space_mission_foundation.sql', '0022_space_mission_contributions.sql',
  '0023_event_waitlist.sql', '0024_space_polls.sql',
];

function expectedHistory(provider) {
  const directory = resolve(root, provider === 'sqlite' ? 'prisma/sqlite-migrations' : 'prisma/postgresql-upgrades');
  const names = readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  const reviewed = provider === 'sqlite' ? reviewedSqlite : reviewedPostgresql;
  if (JSON.stringify(names) !== JSON.stringify(reviewed)) {
    throw new Error('Publication migration history is not the reviewed fresh-install sequence.');
  }
  return names.map(name => ({
    name,
    checksum: createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex'),
  }));
}

async function inspect(query, provider) {
  const historyTable = provider === 'sqlite' ? '_app_migrations' : '_app_schema_upgrades';
  let actual;
  try { actual = await query(`SELECT name, checksum FROM "${historyTable}" ORDER BY name`); }
  catch { throw new Error('Publication schema is missing or incomplete; run the reviewed database deployment on an empty database.'); }
  if (JSON.stringify(actual) !== JSON.stringify(expectedHistory(provider))) {
    throw new Error('Publication migration history is missing, divergent or has changed checksums; startup refused.');
  }
  const missingDraft = await query(`SELECT c."id" FROM "Course" c
    LEFT JOIN "CourseDraft" d ON d."courseId" = c."id"
    WHERE d."courseId" IS NULL LIMIT 1`);
  if (missingDraft.length) {
    throw new Error(`Legacy course ${missingDraft[0].id} has no saved draft. This release requires a fresh empty database; back up the existing database and do not serve it with phase 2.`);
  }
  const invalidPointer = await query(`SELECT c."id" FROM "Course" c
    LEFT JOIN "CoursePublication" p ON p."id" = c."activePublicationId" AND p."courseId" = c."id"
    WHERE c."activePublicationId" IS NOT NULL AND p."id" IS NULL LIMIT 1`);
  if (invalidPointer.length) throw new Error(`Course ${invalidPointer[0].id} has an invalid active publication; startup refused.`);
  return true;
}

export async function assertCoursePublicationReady(url, provider) {
  if (provider === 'sqlite') {
    const path = sqlitePath(url);
    if (!existsSync(path)) throw new Error('SQLite database does not exist; run npm run db:deploy on a fresh database first.');
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec('BEGIN');
      try {
        const result = await inspect(sql => db.prepare(sql).all(), provider);
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
  }
  if (provider !== 'postgresql' || !/^postgres(?:ql)?:\/\//.test(url ?? '')) {
    throw new Error('Set DATABASE_PROVIDER and DATABASE_URL for SQLite or PostgreSQL.');
  }
  const schema = new URL(url).searchParams.get('schema') ?? 'public';
  if (!schema) throw new Error('PostgreSQL schema must not be empty.');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await client.query(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
      const selected = (await client.query('SELECT current_schema() AS name')).rows[0].name;
      if (selected !== schema) throw new Error(`PostgreSQL schema ${schema} is unavailable.`);
      const result = await inspect(async sql => (await client.query(sql)).rows, provider);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  await assertCoursePublicationReady(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER ?? 'postgresql');
  console.log('Fresh-install course publication storage is ready.');
}
