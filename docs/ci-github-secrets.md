# CI GitHub Repository Secrets

This document lists every GitHub repository secret that the Playwright CI workflow
can consume, explains what each one is used for, and shows where to set them up —
including the extra steps needed to run AI tests on pull requests from forks.

---

## How the workflow handles secrets

The workflow at `.github/workflows/playwright.yml` has **two jobs**:

| Job | Trigger | Secrets available? |
|-----|---------|-------------------|
| `playwright` | `push` to main/master and `pull_request` | Yes for same-repo PRs and push; **empty for fork PRs** |
| `playwright-ai` | `pull_request_target` for fork PRs only | Yes — after a maintainer approves the `ci-secrets` environment |

For fork PRs, the `playwright` job runs but AI-dependent tests skip gracefully
(using the `skipIfNoOpenAI()` / `skipIfNoStripe()` helpers).  Once a maintainer
reviews the PR code and approves the environment run, `playwright-ai` runs the
full suite including AI tests.

---

## Where to add repository secrets

1. Open the repository on GitHub.
2. Go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret** for each key listed below.

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

## Setting up the `ci-secrets` environment (required for fork PRs)

The `playwright-ai` job uses a GitHub **environment** called `ci-secrets` to
safely expose secrets to code from fork pull requests.  Without this environment
(and its protection rules), GitHub will not pass secrets to fork PRs at all.

### Why this is safe

`pull_request_target` runs with the **base branch's** workflow file, which means
the workflow itself cannot be tampered with by a fork.  The `ci-secrets`
environment adds a **required reviewer** gate so secrets are only injected after
a maintainer has inspected the fork's code and approved the run.

### One-time setup steps

1. Go to **Settings → Environments** in your GitHub repository.
2. Click **New environment** and name it exactly `ci-secrets`.
3. Under **Environment protection rules**, enable **Required reviewers** and add
   one or more maintainers (e.g. yourself).
4. Under **Environment secrets**, add the same secrets listed in the table above
   (`OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
   *(You can reuse the same values from repository secrets — environment secrets
   take precedence when the environment is active.)*
5. Save the environment.

### Approving a fork PR run

When a fork PR is opened:
1. The `playwright` job starts immediately (AI tests skip — no secrets).
2. The `playwright-ai` job is queued and shows **"Waiting for approval"**.
3. A maintainer reviews the PR **before approving**. Check:
   - The PR diff itself for any obvious malicious code.
   - `package.json` and `package-lock.json` for unexpected added packages or
     tampered install scripts (e.g. `preinstall`, `postinstall`) that could
     exfiltrate secrets during `npm ci`.
   - Any changes to `scripts/ci-seed.ts`, `server/seed.ts`, or test fixture
     scripts that run before the main test suite.
4. Once satisfied, click **Review deployments → Approve and deploy** on the
   Actions run page.
5. `playwright-ai` starts, secrets are injected, and AI tests run with real keys.

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

Both jobs in `.github/workflows/playwright.yml` map secrets to environment
variables the same way:

```yaml
env:
  OPENAI_API_KEY:        ${{ secrets.OPENAI_API_KEY }}
  STRIPE_SECRET_KEY:     ${{ secrets.STRIPE_SECRET_KEY }}
  STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}
```

For the `playwright` job on fork PRs, GitHub passes empty strings and the
`skipIf*` helpers skip the tests automatically.  For the `playwright-ai` job,
GitHub injects the real values from the `ci-secrets` environment after a
maintainer approves.
