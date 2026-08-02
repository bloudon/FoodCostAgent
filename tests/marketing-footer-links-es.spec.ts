/**
 * Playwright tests for Spanish marketing site footer navigation.
 *
 * Verifies that each footer link on the /es marketing site performs
 * client-side navigation (via wouter <Link>) to the correct /es/* URL
 * and that the target page's h1 heading in Spanish is visible after
 * navigation.
 *
 * The test starts on /es/for-chefs — a deep /es/* path — to exercise the
 * scenario where the extra /es path segment could break nginx routing for
 * the Spanish locale.
 *
 * NOTE: This file imports from playwright/test directly — NOT from
 * test-helpers — because test-helpers injects forceAppMode=1 which
 * suppresses the marketing site and shows the app shell instead.
 *
 * Prerequisites:
 *   The app must be running at http://localhost:5000 (npm run dev) with
 *   VITE_SHOW_WEBSITE=true (the default Replit dev environment).
 */

import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';

const BASE_URL = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Minimal API stub — prevents 401 noise but doesn't trigger app-shell login
// ---------------------------------------------------------------------------

async function stubAuthEndpoint(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null',
    }),
  );
}

// ---------------------------------------------------------------------------
// Spanish footer link matrix
// Each entry: the label text visible in the footer (Spanish), the expected
// /es/* URL path, and a substring of the Spanish h1 heading on the target
// page.
//
// Label sources (marketing-translations.ts → es):
//   nav.platform       = "Plataforma"
//   nav.forChefs       = "Para Chefs"
//   nav.forFbLeaders   = "Para Líderes de A&B"
//   nav.pricing        = "Precios"
//   footer.about       = "Nosotros"
//   footer.contact     = "Contacto"
//
// h1 sources:
//   /es/platform     → new-page-translations.ts es.platform.headline
//   /es/for-chefs    → new-page-translations.ts es.forChefs.headline
//   /es/for-fb-leaders → new-page-translations.ts es.forFbLeaders.headline
//   /es/pricing      → marketing-translations.ts es.pricing.headline
//   /es/about        → marketing-translations.ts es.about.headline
//   /es/contact      → marketing-translations.ts es.contact.headline
// ---------------------------------------------------------------------------

const FOOTER_LINKS_ES: Array<{
  label: string;
  expectedPath: string;
  h1Substring: string;
}> = [
  {
    label: 'Plataforma',
    expectedPath: '/es/platform',
    h1Substring: 'Todas las capacidades que tu operación necesita',
  },
  {
    label: 'Para Chefs',
    expectedPath: '/es/for-chefs',
    h1Substring: 'La plataforma que trabaja como tú trabajas',
  },
  {
    label: 'Para Líderes de A&B',
    expectedPath: '/es/for-fb-leaders',
    h1Substring: 'Inteligencia operacional para cada cocina que diriges',
  },
  {
    label: 'Precios',
    expectedPath: '/es/pricing',
    h1Substring: 'Construida para la forma en que los chefs trabajan',
  },
  {
    label: 'Nosotros',
    expectedPath: '/es/about',
    h1Substring: 'La cocina no debería adaptarse al software',
  },
  {
    label: 'Contacto',
    expectedPath: '/es/contact',
    h1Substring: 'Agendar una Revisión Culinaria',
  },
];

// ---------------------------------------------------------------------------
// Helper: navigate to a Spanish marketing page and wait for the footer
// ---------------------------------------------------------------------------

async function goToSpanishMarketingPage(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`);
  // Wait for the footer to mount — it's always rendered by MarketingLayout
  await page.locator('footer').waitFor({ state: 'visible', timeout: 20000 });
}

// ---------------------------------------------------------------------------
// Suite: each Spanish footer link navigates correctly
// ---------------------------------------------------------------------------

test.describe('Spanish marketing footer link navigation (/es/for-chefs)', () => {
  for (const { label, expectedPath, h1Substring } of FOOTER_LINKS_ES) {
    test(`footer "${label}" link → ${expectedPath}`, async ({ page }) => {
      await stubAuthEndpoint(page);
      await goToSpanishMarketingPage(page, '/es/for-chefs');

      // Locate the footer link by its label text inside <footer>
      const footer = page.locator('footer');
      const link = footer.getByRole('link', { name: label, exact: true });

      await expect(link).toBeVisible({ timeout: 10000 });

      // Scroll the link into view (footer may be below the fold)
      await link.scrollIntoViewIfNeeded();

      // Click — wouter handles this as client-side pushState
      await link.click();

      // URL must change to the expected /es/* path
      await expect(page).toHaveURL(new RegExp(`${expectedPath}$`), {
        timeout: 10000,
      });

      // The page h1 must contain the expected Spanish heading substring
      const h1 = page.locator('h1').first();
      await expect(h1).toContainText(h1Substring, { timeout: 10000 });
    });
  }
});

// ---------------------------------------------------------------------------
// Suite: Spanish footer links produce a URL change (not a scroll no-op)
// ---------------------------------------------------------------------------

test.describe('Spanish marketing footer links change the URL', () => {
  test('clicking a footer link from /es/for-chefs changes the URL path', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToSpanishMarketingPage(page, '/es/for-chefs');

    // Start URL must be /es/for-chefs
    await expect(page).toHaveURL(`${BASE_URL}/es/for-chefs`);

    // Click a link that navigates away (Nosotros = About)
    const footer = page.locator('footer');
    const aboutLink = footer.getByRole('link', { name: 'Nosotros', exact: true });
    await aboutLink.scrollIntoViewIfNeeded();
    await aboutLink.click();

    // URL must change — not stay on /es/for-chefs
    await expect(page).not.toHaveURL(`${BASE_URL}/es/for-chefs`, { timeout: 5000 });
    await expect(page).toHaveURL(`${BASE_URL}/es/about`, { timeout: 5000 });
  });
});
