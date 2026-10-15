// The standalone server changes its working directory. Load the project's
// local settings first, without overriding environment supplied by a deployer.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

process.env.PORT ??= '3013';
process.env.HOSTNAME ??= '0.0.0.0';

let phase = 'artifact';
try {
  const inDocker = existsSync(fileURLToPath(new URL('../server.js', import.meta.url)));
  const serverImport = inDocker ? '../server.js' : '../.next/standalone/server.js';
  if (!existsSync(fileURLToPath(new URL(serverImport, import.meta.url)))) {
    throw new Error('Standalone server artifact is missing. Build before starting.');
  }
  phase = 'readiness';
  const { assertCoursePublicationReady } = await import('./assert-course-publication-ready.mjs');
  await assertCoursePublicationReady(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER ?? 'postgresql');

  // The retention worker must complete its initial sweep before a learner can
  // create private practice data. A worker failure refuses production startup.
  phase = 'retention';
  const { startPracticeRetentionScheduler } = await import('./formative-practice-retention-scheduler.mjs');
  await startPracticeRetentionScheduler();

  phase = 'server';
  await import(serverImport);
} catch (error) {
  // Readiness errors can include course IDs. Keep startup output aggregate-only.
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,16}$/.test(error.code) ? error.code : 'unknown';
  console.error('practice_startup', JSON.stringify({ event: 'failed', phase, code }));
  process.exitCode = 1;
}
