export const PRICING = {
  starter: { monthly: 149, annual: 129 },
  pro: {
    monthly: { platform: 79, perStore: 149, total: 228 },
    annual: { platform: 69, perStore: 129, total: 198 },
  },
} as const;

export type BillingTerm = "monthly" | "annual";
