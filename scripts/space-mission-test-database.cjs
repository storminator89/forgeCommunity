'use strict';

/** Test-only boundary: pg-connection-string can override URL authority fields
 * with query parameters such as host, port, dbname, options and ssl settings.
 * Accept no parameters or fragments, then use only this canonical result for
 * every client and deployment subprocess in disposable integration tests. */
function disposablePostgresqlTestUrl(value) {
  let url;
  try { url = new URL(value); } catch { /* Reject below with the same message. */ }
  if (!url ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/forge_test' || url.search !== '' || url.hash !== '') {
    throw new Error('Disposable PostgreSQL tests require a local forge_test database without query parameters or fragments.');
  }
  return url.toString();
}

function missionTestDatabaseUrl(value, provider) {
  if (provider !== 'postgresql') throw new Error('Mission PostgreSQL tests require DATABASE_PROVIDER=postgresql.');
  return disposablePostgresqlTestUrl(value);
}

module.exports = { disposablePostgresqlTestUrl, missionTestDatabaseUrl };
