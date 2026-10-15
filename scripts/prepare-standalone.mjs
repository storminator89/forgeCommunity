import { copyFile, cp, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import nft from 'next/dist/compiled/@vercel/nft/index.js';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
await stat(path.join(standalone, 'server.js'));
await mkdir(path.join(standalone, '.next'), { recursive: true });
await cp(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
// The Docker H5P smoke constructs an actual package without a network fetch.
await cp(path.join(root, 'node_modules', 'fflate'), path.join(standalone, 'node_modules', 'fflate'), { recursive: true });

// Next traces application routes, but the retention scheduler is a separate
// Node entrypoint launched before the server. Trace its dependency closure too
// so the standalone image contains the exact driver packages it executes.
const { fileList, warnings } = await nft.nodeFileTrace([
  path.join(root, 'scripts', 'formative-practice-retention-scheduler.mjs'),
], { base: root, processCwd: root });
for (const warning of warnings) {
  // pg-native and Cloudflare sockets are optional drivers in the pg package.
  if (!/Failed to resolve dependency "(?:pg-native|cloudflare:sockets)"/.test(String(warning))) {
    throw warning;
  }
}
const dependencyFiles = [...fileList].filter(file => file.startsWith('node_modules/'));
for (const name of ['@prisma/client', '@prisma/adapter-better-sqlite3', '@prisma/adapter-pg',
  'better-sqlite3', 'pg']) {
  if (!dependencyFiles.some(file => file.startsWith(`node_modules/${name}/`))) {
    throw new Error(`Standalone retention worker dependency not traced: ${name}. Use a physical install.`);
  }
}
const realRoot = await realpath(root);
for (const file of dependencyFiles) {
  const source = path.resolve(root, file);
  const actual = await realpath(source);
  if (!actual.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('Standalone retention worker dependency escaped project root');
  }
  if (!(await stat(source)).isFile()) continue;
  const destination = path.join(standalone, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
