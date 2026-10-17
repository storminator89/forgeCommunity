import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('drizzle/meta', { recursive: true });
await writeFile('drizzle/meta/_journal.json', `${JSON.stringify({
  version: '7',
  dialect: 'sqlite',
  entries: [{ idx: 0, version: '7', when: 1792195200000, tag: '0000_forgecommunity', breakpoints: true }],
}, null, 2)}\n`);
