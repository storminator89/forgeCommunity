import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

// Keep the pinned player self-hosted, including fonts and styles used by its frame.
const destination = path.join(process.cwd(), 'public', 'h5p-runtime');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(process.cwd(), 'node_modules', 'h5p-standalone', 'dist'), destination, { recursive: true });
