import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('CI workflow expression scope', () => {
  it('avoids runner context in job-level env, where GitHub does not expose it', () => {
    const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const lines = workflow.split(/\r?\n/);
    const jobEnv: string[] = [];
    let insideJobEnv = false;

    for (const line of lines) {
      if (/^    env:\s*$/.test(line)) {
        insideJobEnv = true;
        continue;
      }
      if (insideJobEnv && /^    \S/.test(line)) insideJobEnv = false;
      if (insideJobEnv) jobEnv.push(line);
    }

    expect(jobEnv.length).toBeGreaterThan(0);
    expect(jobEnv.join('\n')).not.toMatch(/\$\{\{\s*runner\./);
    expect(workflow).toContain('DATABASE_URL: file:${{ github.workspace }}/forge-browser-qa.db');
  });
});
