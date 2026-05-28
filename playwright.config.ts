import { defineConfig, devices } from 'playwright/test';

/**
 * In the Replit development container, Chromium crashes with SIGSEGV due to
 * the --unsafe-swiftshader GPU emulation bug. Firefox does not have this
 * problem and is used for all local (non-CI) test runs instead.
 *
 * CI (GitHub Actions) uses Chromium — that environment works correctly.
 *
 * Worker / parallelism notes:
 *   All UI tests mock every API route via page.route(), making them fully
 *   isolated across browser contexts.  Running them in parallel is safe.
 *   CI is kept at 1 worker to avoid contention on the shared test database.
 *   Local runs use up to 4 workers (capped so Replit containers don't OOM).
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: !isCI,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : 4,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: isCI
    ? [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        {
          name: 'firefox',
          use: { ...devices['Desktop Firefox'] },
        },
      ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5000',
    reuseExistingServer: !isCI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
