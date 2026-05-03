import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, '..', '.env') });
loadEnv({ path: path.join(__dirname, '.env') });

const HUB_PORT = process.env.PLAYWRIGHT_HUB_PORT ?? '18999';
const baseURL = `http://127.0.0.1:${HUB_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 360_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --import tsx src/cli.ts hub',
    cwd: __dirname,
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      SHINGEKI_HUB_PORT: HUB_PORT,
      SHINGEKI_HUB_HOST: '127.0.0.1',
      CI: '1',
    },
    timeout: 90_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
