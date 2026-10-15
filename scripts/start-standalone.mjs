// The standalone server changes its working directory. Load the project's
// local settings first, without overriding environment supplied by a deployer.
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

process.env.PORT ??= '3013';
process.env.HOSTNAME ??= '0.0.0.0';

const { assertCoursePublicationReady } = await import('./assert-course-publication-ready.mjs');
await assertCoursePublicationReady(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER ?? 'postgresql');

await import('../.next/standalone/server.js');
