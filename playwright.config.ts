import { defineConfig, devices } from 'playwright/test';

/**
 * In the Replit development container, Chromium crashes with SIGSEGV due to
 * the --unsafe-swiftshader GPU emulation bug. Firefox does not have this
 * problem and is preferred for local (non-CI) test runs.
 *
 * When Firefox is not installed (e.g. first-time Replit clone), Chromium is
 * used as a fallback with --no-sandbox / --disable-gpu flags that avoid the
 * SwiftShader SIGSEGV crash.  Set PLAYWRIGHT_BROWSER=chromium to force
 * Chromium locally even if Firefox is present.
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

/**
 * Use Chromium locally when the Firefox binary is not present or when
 * PLAYWRIGHT_BROWSER=chromium is explicitly set.
 */
const useLocalChromium =
  process.env.PLAYWRIGHT_BROWSER === 'chromium' ||
  (!isCI &&
    (() => {
      try {
        require('fs').statSync(
          require('path').join(
            process.env.HOME ?? '/home/runner',
            '.cache/ms-playwright/firefox-1509/firefox/firefox',
          ),
        );
        return false; // Firefox exists, use it
      } catch {
        return true; // Firefox not found, fall back to Chromium
      }
    })());

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
    : useLocalChromium
    ? [
        {
          name: 'chromium',
          use: {
            ...devices['Desktop Chrome'],
            launchOptions: {
              args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
              ],
            },
          },
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
