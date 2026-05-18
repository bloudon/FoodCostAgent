/**
 * Helpers for skipping tests that require optional external API credentials.
 *
 * Call these at the top of a test or inside a describe block when the test
 * makes real calls to a third-party service.  When the corresponding GitHub
 * repository secret is not configured the test is skipped gracefully instead
 * of failing the CI run.
 *
 * Usage:
 *
 *   import { skipIfNoOpenAI, skipIfNoStripe } from './helpers/ci-skip';
 *
 *   test('AI extracts recipe names from an image', async ({ request }) => {
 *     skipIfNoOpenAI();
 *     // ... test body that calls /api/recipes/scan or similar AI endpoint
 *   });
 *
 * Required GitHub repository secrets (Settings → Secrets and variables → Actions):
 *   OPENAI_API_KEY       — OpenAI API key used by GPT-4o Vision and chat endpoints
 *   STRIPE_SECRET_KEY    — Stripe secret key (sk_test_… for CI)
 *   STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret (whsec_…)
 *
 * See docs/ci-github-secrets.md for full setup instructions.
 */

import { test } from 'playwright/test';

/**
 * Skip the enclosing test when OPENAI_API_KEY is not set.
 * Use in any test that calls an endpoint backed by GPT-4o or GPT-4o-mini.
 */
export function skipIfNoOpenAI(): void {
  test.skip(
    !process.env.OPENAI_API_KEY,
    'OPENAI_API_KEY is not configured — add it as a GitHub repository secret to run this test',
  );
}

/**
 * Skip the enclosing test when STRIPE_SECRET_KEY is not set.
 * Use in any test that calls Stripe-backed billing endpoints.
 */
export function skipIfNoStripe(): void {
  test.skip(
    !process.env.STRIPE_SECRET_KEY,
    'STRIPE_SECRET_KEY is not configured — add it as a GitHub repository secret to run this test',
  );
}

/**
 * Skip the enclosing test when STRIPE_WEBHOOK_SECRET is not set.
 * Use in any test that exercises Stripe webhook event handling.
 */
export function skipIfNoStripeWebhook(): void {
  test.skip(
    !process.env.STRIPE_WEBHOOK_SECRET,
    'STRIPE_WEBHOOK_SECRET is not configured — add it as a GitHub repository secret to run this test',
  );
}
