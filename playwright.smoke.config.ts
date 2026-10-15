import { defineConfig, devices } from '@playwright/test';
import browserConfig from './playwright.config';

// Keep this bounded suite separate from the full three-viewport Chromium run.
// CI runs it afterward: the full run clears the parent test-results directory.
export default defineConfig({
  ...browserConfig,
  testMatch: 'cross-engine.smoke.ts',
  outputDir: 'test-results/cross-engine-smoke',
  timeout: 90_000,
  globalTimeout: 300_000,
  workers: 1,
  retries: 0,
  use: {
    ...browserConfig.use,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-firefox-smoke',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'desktop-webkit-smoke',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
