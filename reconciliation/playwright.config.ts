import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const external = process.env.DASHBOARD_BASE_URL;
const baseURL = external || 'http://127.0.0.1:3100';
process.env.DASHBOARD_BASE_URL = baseURL;
export default defineConfig({
  testDir: './',
  testMatch: ['src/lib/dashboard/tests/dashboard.spec.ts', 'tests/e2e.spec.ts'],
  workers: 1,
  timeout: 45000,
  use: { baseURL, channel: 'chrome', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: 'node scripts/demo.mjs --port 3100', url: baseURL + '/api/reviews', reuseExistingServer: false,
    env: { NEXT_DIST_DIR: ".next-test", RECONCILIATION_INTAKE_DEMO_DIR: mkdtempSync(path.join(tmpdir(), 'reconciliation-e2e-')) },
  },
});
