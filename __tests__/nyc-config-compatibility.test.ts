/** The scoped js-yaml override crosses a major version boundary in Istanbul's loader. */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { loadNycConfig } = require('@istanbuljs/load-nyc-config') as {
  loadNycConfig: (options: { cwd: string }) => Promise<Record<string, unknown>>;
};

describe('Istanbul YAML configuration compatibility', () => {
  it('resolves the reviewed YAML version without a sprintf-js lock entry', () => {
    const parentPath = require.resolve('@istanbuljs/load-nyc-config');
    const yamlPath = require.resolve('js-yaml/package.json', { paths: [parentPath] });
    const yamlPackage = JSON.parse(readFileSync(yamlPath, 'utf8')) as { version: string };
    const lock = JSON.parse(readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };

    expect(yamlPackage.version).toBe('4.3.2');
    expect(Object.keys(lock.packages).filter((name) => name.endsWith('/sprintf-js'))).toEqual([]);
  });

  it('loads and normalizes an ordinary .nycrc.yml with the scoped override', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'forge-nyc-config-'));

    try {
      await writeFile(path.join(directory, 'package.json'), '{"private":true}', 'utf8');
      await writeFile(
        path.join(directory, '.nycrc.yml'),
        'all: true\ncheck-coverage: true\ninclude:\n  - src/**/*.ts\nexclude:\n  - src/**/*.test.ts\n',
        'utf8',
      );

      const config = await loadNycConfig({ cwd: directory });
      expect(config).toMatchObject({
        cwd: directory,
        all: true,
        checkCoverage: true,
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
