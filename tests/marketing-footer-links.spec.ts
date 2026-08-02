/**
 * Playwright tests for marketing site footer navigation.
 *
 * Verifies that each footer link on the marketing site performs client-side
 * navigation (via wouter <Link>) to the correct URL and that the target
 * page's h1 heading is visible after navigation.
 *
 * The test starts on /for-chefs (a deep path) to exercise the scenario
 * described in the task: footer links navigating away from a non-root page.
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
// Footer link matrix
// Each entry: the label text visible in the footer, the expected URL path,
// a substring of the h1 heading that uniquely identifies the target page,
// and an optional startPath override (defaults to /for-chefs).
//
// h1Substring notes:
//   • for-chefs uses newPageTranslations (forChefs.headline), not the
//     marketingTranslations string — its hero h1 is
//     "The platform that works the way you work."
//   • pricing also uses marketingTranslations (pricing.headline):
//     "Built for the way chefs work."
// ---------------------------------------------------------------------------

const FOOTER_LINKS: Array<{
  label: string;
  expectedPath: string;
  h1Substring: string;
  startPath?: string;
}> = [
  {
    label: 'Platform',
    expectedPath: '/platform',
    h1Substring: 'Every capability your operation needs',
  },
  {
    label: 'For Chefs',
    expectedPath: '/for-chefs',
    // for-chefs.tsx uses newPageTranslations: forChefs.headline (not marketingTranslations)
    h1Substring: 'The platform that works the way you work',
  },
  {
    label: 'For F&B Leaders',
    expectedPath: '/for-fb-leaders',
    h1Substring: 'Operational intelligence for every kitchen you run',
  },
  {
    label: 'Pricing',
    expectedPath: '/pricing',
    // Pricing page reuses the same hero headline as For Chefs
    h1Substring: 'Built for the way chefs work',
  },
  {
    label: 'About',
    expectedPath: '/about',
    h1Substring: 'The kitchen should not have to adapt to the software',
  },
  {
    label: 'Contact',
    expectedPath: '/contact',
    h1Substring: 'Schedule a Culinary Review',
  },
];

// ---------------------------------------------------------------------------
// Helper: navigate to a marketing page and wait for the footer to render
// ---------------------------------------------------------------------------

async function goToMarketingPage(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`);
  // Wait for the footer to mount — it's always rendered by MarketingLayout
  await page.locator('footer').waitFor({ state: 'visible', timeout: 20000 });
}

// ---------------------------------------------------------------------------
// Suite: each footer link navigates correctly
// ---------------------------------------------------------------------------

test.describe('Marketing footer link navigation', () => {
  for (const { label, expectedPath, h1Substring, startPath } of FOOTER_LINKS) {
    test(`footer "${label}" link → ${expectedPath}`, async ({ page }) => {
      await stubAuthEndpoint(page);
      // Use the entry's startPath if provided, otherwise default to /for-chefs
      await goToMarketingPage(page, startPath ?? '/for-chefs');

      // Locate the footer link by its exact label text inside the <footer>
      const footer = page.locator('footer');
      const link = footer.getByRole('link', { name: label, exact: true });

      await expect(link).toBeVisible({ timeout: 10000 });

      // Scroll the link into view (footer may be below the fold)
      await link.scrollIntoViewIfNeeded();

      // Click — wouter handles this as client-side pushState
      await link.click();

      // URL must change to the expected path
      await expect(page).toHaveURL(new RegExp(`${expectedPath}$`), {
        timeout: 10000,
      });

      // The page h1 must contain the expected heading substring
      const h1 = page.locator('h1').first();
      await expect(h1).toContainText(h1Substring, { timeout: 10000 });
    });
  }
});

// ---------------------------------------------------------------------------
// Suite: Get Started column links navigate correctly
//
// These two <Link> elements share their destinations with the Company column
// ("Contact" and "Pricing"), so we scope each lookup to the sibling <div>
// whose <h4> reads "Get Started" to avoid ambiguity.
// ---------------------------------------------------------------------------

test.describe('Marketing footer Get Started column links', () => {
  test('footer Get Started "Schedule a Culinary Review" link → /contact', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToMarketingPage(page, '/for-chefs');

    // Scope to the footer section whose heading is "Get Started"
    const footer = page.locator('footer');
    const getStartedSection = footer.locator('div', { has: page.locator('h4', { hasText: 'Get Started' }) });

    const link = getStartedSection.getByRole('link', { name: 'Schedule a Culinary Review', exact: true });
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(page).toHaveURL(new RegExp('/contact$'), { timeout: 10000 });
    const h1 = page.locator('h1').first();
    await expect(h1).toContainText('Schedule a Culinary Review', { timeout: 10000 });
  });

  test('footer Get Started "View Pricing" link → /pricing', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToMarketingPage(page, '/for-chefs');

    // Scope to the footer section whose heading is "Get Started"
    const footer = page.locator('footer');
    const getStartedSection = footer.locator('div', { has: page.locator('h4', { hasText: 'Get Started' }) });

    const link = getStartedSection.getByRole('link', { name: 'View Pricing', exact: true });
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(page).toHaveURL(new RegExp('/pricing$'), { timeout: 10000 });
    const h1 = page.locator('h1').first();
    await expect(h1).toContainText('Built for the way chefs work', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Suite: Spanish footer Get Started column links navigate correctly
//
// The Spanish footer renders the Get Started column with the heading
// "Comenzar". The two action links use translated labels and point to
// /es/contact and /es/pricing respectively.
// ---------------------------------------------------------------------------

test.describe('Spanish footer Get Started column links', () => {
  test('Spanish footer Get Started "Agendar una Revisión Culinaria" link → /es/contact', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToMarketingPage(page, '/es/for-chefs');

    // Scope to the footer section whose heading is "Comenzar" (Spanish "Get Started")
    const footer = page.locator('footer');
    const getStartedSection = footer.locator('div', { has: page.locator('h4', { hasText: 'Comenzar' }) });

    const link = getStartedSection.getByRole('link', { name: 'Agendar una Revisión Culinaria', exact: true });
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(page).toHaveURL(new RegExp('/es/contact$'), { timeout: 10000 });
    const h1 = page.locator('h1').first();
    await expect(h1).toContainText('Agendar una Revisión Culinaria', { timeout: 10000 });
  });

  test('Spanish footer Get Started "Ver precios" link → /es/pricing', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToMarketingPage(page, '/es/for-chefs');

    // Scope to the footer section whose heading is "Comenzar" (Spanish "Get Started")
    const footer = page.locator('footer');
    const getStartedSection = footer.locator('div', { has: page.locator('h4', { hasText: 'Comenzar' }) });

    const link = getStartedSection.getByRole('link', { name: 'Ver precios', exact: true });
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(page).toHaveURL(new RegExp('/es/pricing$'), { timeout: 10000 });
    const h1 = page.locator('h1').first();
    await expect(h1).toContainText('Construida para la forma en que los chefs trabajan', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Suite: Spanish footer Company column links navigate correctly
//
// The Spanish footer renders the Company column with the heading "Empresa".
// The two links use translated labels and point to /es/about and /es/contact.
// ---------------------------------------------------------------------------

test.describe('Spanish footer Company column links', () => {
  test('Spanish footer Company "Nosotros" link → /es/about', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToMarketingPage(page, '/es/for-chefs');

    // Scope to the footer section whose heading is "Empresa" (Spanish "Company")
    const footer = page.locator('footer');
    const companySection = footer.locator('div', { has: page.locator('h4', { hasText: 'Empresa' }) });

    const link = companySection.getByRole('link', { name: 'Nosotros', exact: true });
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(page).toHaveURL(new RegExp('/es/about$'), { timeout: 10000 });
    const h1 = page.locator('h1').first();
    await expect(h1).toContainText('La cocina no debería adaptarse al software', { timeout: 10000 });
  });

  test('Spanish footer Company "Contacto" link → /es/contact', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToMarketingPage(page, '/es/for-chefs');

    // Scope to the footer section whose heading is "Empresa" (Spanish "Company")
    const footer = page.locator('footer');
    const companySection = footer.locator('div', { has: page.locator('h4', { hasText: 'Empresa' }) });

    const link = companySection.getByRole('link', { name: 'Contacto', exact: true });
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.scrollIntoViewIfNeeded();
    await link.click();

    await expect(page).toHaveURL(new RegExp('/es/contact$'), { timeout: 10000 });
    const h1 = page.locator('h1').first();
    await expect(h1).toContainText('Agendar una Revisión Culinaria', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Suite: Spanish "Nosotros" footer link from additional marketing pages
//
// The tasks requires verifying the Company column "Nosotros" link works from
// /es/platform, /es/pricing, and /es/for-fb-leaders (not just /es/for-chefs).
// "Contacto" is also verified from /es/platform as an additional start page.
// ---------------------------------------------------------------------------

test.describe('Spanish footer Company column links from additional pages', () => {
  const nosotrosStartPages = [
    { path: '/es/platform', label: '/es/platform' },
    { path: '/es/pricing', label: '/es/pricing' },
    { path: '/es/for-fb-leaders', label: '/es/for-fb-leaders' },
  ];

  for (const { path } of nosotrosStartPages) {
    test(`Spanish footer "Nosotros" link → /es/about (from ${path})`, async ({ page }) => {
      await stubAuthEndpoint(page);
      await goToMarketingPage(page, path);

      const footer = page.locator('footer');
      const companySection = footer.locator('div', { has: page.locator('h4', { hasText: 'Empresa' }) });

      const link = companySection.getByRole('link', { name: 'Nosotros', exact: true });
      await expect(link).toBeVisible({ timeout: 10000 });
      await link.scrollIntoViewIfNeeded();
      await link.click();

      await expect(page).toHaveURL(new RegExp('/es/about$'), { timeout: 10000 });
      const h1 = page.locator('h1').first();
      await expect(h1).toContainText('La cocina no debería adaptarse al software', { timeout: 10000 });
    });
  }

  const contactoStartPages = [
    { path: '/es/platform', label: '/es/platform' },
    { path: '/es/pricing', label: '/es/pricing' },
    { path: '/es/for-fb-leaders', label: '/es/for-fb-leaders' },
  ];

  for (const { path } of contactoStartPages) {
    test(`Spanish footer "Contacto" link → /es/contact (from ${path})`, async ({ page }) => {
      await stubAuthEndpoint(page);
      await goToMarketingPage(page, path);

      const footer = page.locator('footer');
      const companySection = footer.locator('div', { has: page.locator('h4', { hasText: 'Empresa' }) });

      const link = companySection.getByRole('link', { name: 'Contacto', exact: true });
      await expect(link).toBeVisible({ timeout: 10000 });
      await link.scrollIntoViewIfNeeded();
      await link.click();

      await expect(page).toHaveURL(new RegExp('/es/contact$'), { timeout: 10000 });
      const h1 = page.locator('h1').first();
      await expect(h1).toContainText('Agendar una Revisión Culinaria', { timeout: 10000 });
    });
  }
});

// ---------------------------------------------------------------------------
// Suite: footer links produce a URL change (not a scroll-to-top no-op)
// ---------------------------------------------------------------------------

test.describe('Marketing footer links change the URL', () => {
  test('clicking a footer link from /for-chefs changes the URL path', async ({ page }) => {
    await stubAuthEndpoint(page);
    await goToMarketingPage(page, '/for-chefs');

    // Start URL must be /for-chefs
    await expect(page).toHaveURL(`${BASE_URL}/for-chefs`);

    // Click a link that navigates away (About)
    const footer = page.locator('footer');
    const aboutLink = footer.getByRole('link', { name: 'About', exact: true });
    await aboutLink.scrollIntoViewIfNeeded();
    await aboutLink.click();

    // URL must change — not stay on /for-chefs
    await expect(page).not.toHaveURL(`${BASE_URL}/for-chefs`, { timeout: 5000 });
    await expect(page).toHaveURL(`${BASE_URL}/about`, { timeout: 5000 });
  });
});
