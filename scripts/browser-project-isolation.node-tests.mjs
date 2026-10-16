import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import yaml from 'js-yaml';

const root = new URL('../', import.meta.url);
const source = path => readFileSync(new URL(path, root), 'utf8');
const workflow = yaml.load(source('.github/workflows/ci.yml'));
const projects = ['desktop-chromium', 'mobile-320-chromium', 'mobile-390-chromium'];
const independentCondition = "${{ !cancelled() && steps.browser_build.outcome == 'success' && steps.browser_install.outcome == 'success' }}";

function isolatedChromiumSteps(value) {
  const steps = value.jobs['browser-qa'].steps;
  const chromium = steps.filter(step => /^npx playwright test --project=/.test(step.run ?? ''));
  assert.equal(chromium.length, projects.length, 'Keep every Chromium project in its own CLI invocation.');
  assert.deepEqual(chromium.map(step => step.run), projects.map(project =>
    `npx playwright test --project=${project} --output=test-results/${project}`));
  for (const step of chromium) {
    assert.equal(step.if, independentCondition, 'A preceding failed project must not skip the next project.');
  }
  assert.ok(!steps.some(step => /npm run test:browser/.test(step.run ?? '')), 'Do not combine projects behind one process-local login quota.');
  return { steps, chromium };
}

test('CI preserves all Chromium projects with fresh servers and independent screenshot directories', () => {
  isolatedChromiumSteps(workflow);
  const config = source('playwright.config.ts');
  assert.deepEqual([...config.matchAll(/name: '([^']+-chromium)'/g)].map(match => match[1]), projects);
  assert.match(config, /testDir: '\.\/e2e'/);
  assert.match(config, /testMatch: '\*\.pw\.ts'/);
  assert.match(config, /command: 'npm run start'/);
  assert.match(config, /reuseExistingServer: false/);
  const guard = workflow.jobs['browser-qa'].steps.find(step => step.run === 'node --test scripts/browser-project-isolation.node-tests.mjs');
  assert.ok(guard, 'Run this isolation regression in the official browser CI job.');
});

test('Firefox/WebKit still run after Chromium failures and all screenshot roots are uploaded', () => {
  const { steps, chromium } = isolatedChromiumSteps(workflow);
  const smoke = steps.find(step => step.run === 'npx playwright test --config=playwright.smoke.config.ts');
  assert.ok(smoke); assert.equal(smoke.if, independentCondition);
  assert.ok(steps.indexOf(smoke) > Math.max(...chromium.map(step => steps.indexOf(step))));
  const smokeConfig = source('playwright.smoke.config.ts');
  assert.match(smokeConfig, /name: 'desktop-firefox-smoke'/);
  assert.match(smokeConfig, /name: 'desktop-webkit-smoke'/);
  assert.match(smokeConfig, /outputDir: 'test-results\/cross-engine-smoke'/);
  const upload = steps.find(step => step.name === 'Upload browser screenshots');
  assert.ok(upload); assert.equal(upload.if, 'always()'); assert.equal(upload.with.path, 'test-results/**/*.png');
});

test('isolation guard rejects dropped projects, shared outputs and fail-fast conditions', () => {
  const copy = () => structuredClone(workflow);
  const dropped = copy(); dropped.jobs['browser-qa'].steps = dropped.jobs['browser-qa'].steps.filter(step => !step.run?.includes('--project=mobile-390-chromium'));
  assert.throws(() => isolatedChromiumSteps(dropped), /every Chromium project/);
  const sharedOutput = copy(); sharedOutput.jobs['browser-qa'].steps.find(step => step.run?.includes('--project=mobile-320-chromium')).run = 'npx playwright test --project=mobile-320-chromium --output=test-results';
  assert.throws(() => isolatedChromiumSteps(sharedOutput));
  const failFast = copy(); failFast.jobs['browser-qa'].steps.find(step => step.run?.includes('--project=mobile-390-chromium')).if = '${{ success() }}';
  assert.throws(() => isolatedChromiumSteps(failFast), /preceding failed project/);
});
