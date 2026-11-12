import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:3036', headless: true, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} },
  webServer: { command: 'node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3036', port: 3036, reuseExistingServer: false, timeout: 60_000,
    env: { DATABASE_PATH: `/tmp/billkeeper-e2e-${process.pid}/db.sqlite`, DOCUMENTS_PATH: `/tmp/billkeeper-e2e-${process.pid}/documents`, APP_URL: 'http://127.0.0.1:3036', GEMINI_API_KEY: '', HETZNER_OS_BUCKET: '', RESEND_API_KEY: '' } },
});
