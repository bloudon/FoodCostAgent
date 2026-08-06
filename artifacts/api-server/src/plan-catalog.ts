/**
 * Plan Catalog — single source of truth for FnB Cost Pro subscription plans.
 *
 * Two products:
 *   - platform   : Standard plan. First operating location included; additional
 *                  operating locations billed per seat.
 *   - enterprise : Custom terms, white-glove support, negotiated pricing.
 *
 * "Operating location" means a restaurant, branch, or separately operated unit.
 * Storage areas (walk-ins, freezers, prep rooms) do NOT count toward the seat
 * total — only companyStores records drive the count.
 */

// ─── Capability arrays ────────────────────────────────────────────────────────

export const CORE_PLATFORM_CAPABILITIES: string[] = [
  "Recipe costing & food cost %",
  "Inventory management",
  "Vendor & order guides",
  "AI invoice scanning",
  "Waste tracking",
  "Menu insights",
  "Theoretical food cost variance",
  "QuickBooks integration",
  "Barcode scanning",
  "Order reminders",
  "Prep charts",
];

export const MULTI_LOCATION_CAPABILITIES: string[] = [
  "All core platform features",
  "Cross-location inventory visibility",
  "Transfer orders between locations",
  "Per-location cost reporting",
  "Centralized vendor pricing",
];

export const ENTERPRISE_CAPABILITIES: string[] = [
  "All multi-location features",
  "Custom pricing & billing terms",
  "Dedicated onboarding & success manager",
  "Enterprise analytics & reporting",
  "Priority support SLA",
  "Custom integrations",
  "SSO / SAML support",
];

// ─── Plan catalog ─────────────────────────────────────────────────────────────

export type SubscriptionPlan = "platform" | "enterprise";
export type BillingInterval = "monthly" | "annual" | "custom";

export interface PlanDefinition {
  key: SubscriptionPlan;
  label: string;
  description: string;
  /** Price per month in USD cents when billed monthly (null = custom/enterprise) */
  monthlyPriceCents: number | null;
  /** Price per month in USD cents when billed annually (null = custom/enterprise) */
  annualPriceCents: number | null;
  /** Operating locations included in base price */
  includedLocationCount: number;
  /** Stripe lookup keys for checkout; null for enterprise */
  stripeLookupKeys: {
    monthly: string | null;
    annual: string | null;
  };
  capabilities: string[];
}

export const PLAN_CATALOG: Record<SubscriptionPlan, PlanDefinition> = {
  platform: {
    key: "platform",
    label: "Platform",
    description: "Complete food-cost management for independent operators and growing groups.",
    monthlyPriceCents: 14900,  // $149/month
    annualPriceCents: 12900,   // $129/month billed annually
    includedLocationCount: 1,
    stripeLookupKeys: {
      monthly: "fnb_platform_monthly",
      annual: "fnb_platform_annual",
    },
    capabilities: CORE_PLATFORM_CAPABILITIES,
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    description: "Custom pricing, dedicated support, and enterprise analytics for large groups.",
    monthlyPriceCents: null,
    annualPriceCents: null,
    includedLocationCount: 1,
    stripeLookupKeys: {
      monthly: null,
      annual: null,
    },
    capabilities: ENTERPRISE_CAPABILITIES,
  },
};

// ─── Additional-location pricing ──────────────────────────────────────────────

export interface AdditionalLocationPricing {
  /** Per additional operating location per month, in USD cents */
  monthlyCents: number;
  /** Per additional operating location per month when billed annually, in USD cents */
  annualCents: number;
  stripeLookupKeys: {
    monthly: string;
    annual: string;
  };
}

export const ADDITIONAL_LOCATION_PRICING: AdditionalLocationPricing = {
  monthlyCents: 14900,   // $149/location/month
  annualCents: 12900,    // $129/location/month billed annually
  stripeLookupKeys: {
    monthly: "fnb_location_monthly",
    annual: "fnb_location_annual",
  },
};

// ─── Operating-mode helper ────────────────────────────────────────────────────

export type OperatingMode = "single_location" | "multi_location" | "enterprise";

/**
 * Returns the operating mode for a company based on their plan and the number
 * of ACTIVE OPERATING locations (companyStores with status = 'active').
 *
 * Storage areas (walk-ins, freezers, prep rooms) are NOT operating locations
 * and must not be counted before calling this helper.
 *
 * @param subscriptionPlan  - The company's current plan key, or null/undefined
 * @param activeOperatingLocationCount - Count of active operating-location records
 */
export function getOperatingMode({
  subscriptionPlan,
  activeOperatingLocationCount,
}: {
  subscriptionPlan: SubscriptionPlan | string | null | undefined;
  activeOperatingLocationCount: number;
}): OperatingMode {
  if (subscriptionPlan === "enterprise") return "enterprise";
  if (activeOperatingLocationCount > 1) return "multi_location";
  return "single_location";
}

// ─── Re-exported pricing constants (for choose-plan.tsx / pricing.tsx) ───────

/** In-app plan-selection pricing (choose-plan.tsx) */
export const PRICING = {
  platform: { monthly: 149, annual: 129 },
} as const;

export type BillingTerm = "monthly" | "annual";

/** Marketing pricing page constants */
export const MARKETING_PRICING = {
  platform: {
    monthly: 149,
    annual: 129,
  },
  location: {
    monthly: 149,
    annual: 129,
  },
} as const;
