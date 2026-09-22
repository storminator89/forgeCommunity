import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
await stat(path.join(standalone, 'server.js'));
await mkdir(path.join(standalone, '.next'), { recursive: true });
await cp(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
