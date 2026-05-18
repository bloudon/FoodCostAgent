# CI GitHub Repository Secrets

This document lists every GitHub repository secret that the Playwright CI workflow
can consume, explains what each one is used for, and shows where to set them.

---

## Where to add secrets

1. Open the repository on GitHub.
2. Go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret** for each key below.

---

## Required secrets (always needed for the CI run to pass)

None. The core Playwright test suite runs against a throwaway Postgres service
container whose credentials are hardcoded in the workflow (`fnbtest / fnbtest`).
No secret is needed for the database layer.

---

## Optional secrets (needed only for tests that call live APIs)

Tests that exercise real third-party integrations check for their secret at
runtime using the helpers in `tests/helpers/ci-skip.ts`.  When the secret is
absent the test is **skipped** rather than failing, so the CI run stays green
even without these keys configured.

| Secret name            | Used by                                         | Where to get it                                    |
|------------------------|-------------------------------------------------|----------------------------------------------------|
| `OPENAI_API_KEY`       | GPT-4o Vision (recipe scan, invoice scan, sweep scan, instruction extraction) and GPT-4o-mini (AI chat, CSV import) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `STRIPE_SECRET_KEY`    | Stripe Checkout session creation, subscription management | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) — use a **test-mode** key (`sk_test_…`) for CI |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification (`whsec_…`) | Stripe Dashboard → Webhooks → your endpoint → Signing secret |

> **Tip:** Always use Stripe **test-mode** keys (`sk_test_…` / `whsec_…`) in CI
> so no real charges can occur.

---

## Skipping tests that need a secret

Import the appropriate helper at the top of any test that makes real external
API calls:

```typescript
import { skipIfNoOpenAI, skipIfNoStripe } from './helpers/ci-skip';

test('AI extracts recipe names from a menu photo', async ({ request }) => {
  skipIfNoOpenAI();   // ← skips automatically when secret is absent
  // ... rest of test
});
```

Available helpers (see `tests/helpers/ci-skip.ts` for full JSDoc):

| Helper                  | Skips when missing           |
|-------------------------|------------------------------|
| `skipIfNoOpenAI()`      | `OPENAI_API_KEY`             |
| `skipIfNoStripe()`      | `STRIPE_SECRET_KEY`          |
| `skipIfNoStripeWebhook()` | `STRIPE_WEBHOOK_SECRET`    |

---

## Workflow env mapping

The workflow at `.github/workflows/playwright.yml` maps secrets to environment
variables like this:

```yaml
env:
  OPENAI_API_KEY:        ${{ secrets.OPENAI_API_KEY }}
  STRIPE_SECRET_KEY:     ${{ secrets.STRIPE_SECRET_KEY }}
  STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}
```

When a secret is not configured in the repository, GitHub passes an empty
string.  The `skipIf*` helpers treat an empty string as "not set" and skip the
test, so the build never fails due to a missing optional secret.
