// ─── In-app plan selection (choose-plan.tsx) ──────────────────────────────────
// These values drive the in-app upgrade flow and Stripe billing.
// Keep the old shape so choose-plan.tsx continues to work unchanged.
export const PRICING = {
  starter: { monthly: 149, annual: 129 },
  pro: {
    monthly: { platform: 79, perStore: 149, total: 228 },
    annual: { platform: 69, perStore: 129, total: 198 },
  },
} as const;

export type BillingTerm = "monthly" | "annual";

// ─── Marketing pricing page (pricing.tsx) ────────────────────────────────────
// Reflects the 4-component Option A model:
//   Platform (first location included) + Additional Locations + Guided Implementation + Enterprise
export const MARKETING_PRICING = {
  platform: {
    monthly: 149,
    annual:  129,
  },
  location: {
    monthly: 149,
    annual:  129,
  },
} as const;
