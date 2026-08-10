import { defineConfig, devices } from 'playwright/test';
import { statSync } from 'fs';
import { join } from 'path';

/**
 * Browser resolution strategy
 * ----------------------------
 * CI (GitHub Actions):  Uses the Playwright-managed Chromium installed by
 *   `npx playwright install chromium` in the CI workflow.  Standard Playwright
 *   browser resolution applies (PLAYWRIGHT_BROWSERS_PATH or the default cache).
 *
 * Replit dev container: The Playwright-managed browsers (chromium-1208,
 *   firefox-1509) are present in .cache/ms-playwright but cannot launch
 *   because the NixOS container lacks the required GTK / glib system libraries.
 *   Instead, we use the Nix-packaged Chromium that ships with the Replit
 *   workspace — it is linked against the correct Nix runtime libraries and
 *   runs reliably with the --no-sandbox flags.
 *
 * Worker / parallelism notes:
 *   All UI tests mock every API route via page.route(), making them fully
 *   isolated across browser contexts.  Running them in parallel is safe.
 *   CI is kept at 1 worker to avoid contention on the shared test database.
 *   Local runs use up to 4 workers (capped so Replit containers don't OOM).
 */
const isCI = !!process.env.CI;

/** Path to the Nix-managed Playwright Chromium binary in the Replit container. */
const NIX_CHROMIUM =
  '/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome';

function nixChromiumAvailable(): boolean {
  try { statSync(NIX_CHROMIUM); return true; } catch { return false; }
}

/** Replit local-run Chromium project — uses the Nix binary to avoid GTK issues. */
const nixChromiumProject = {
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: {
      executablePath: NIX_CHROMIUM,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
    },
  },
};

/** CI Chromium project — uses the Playwright-managed browser (installed by CI). */
const ciChromiumProject = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
};

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
    ? [ciChromiumProject]
    : [nixChromiumProject],
  webServer: {
    command: 'PORT=5000 pnpm --filter @workspace/fnb-cost-pro run dev',
    url: 'http://localhost:5000',
    reuseExistingServer: !isCI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
