/**
 * tier-config.ts — re-exports from plan-catalog.ts for the new platform/enterprise model.
 *
 * The old "basic" / "pro" / "free" tier keys have been retired.
 * All subscription gating now uses "platform" and "enterprise".
 *
 * Feature-gate mechanics (#810) will be refactored in a follow-up task.
 * Until then, this file provides a thin compatibility layer so existing
 * call-sites continue to compile.
 */

export { type SubscriptionPlan, type BillingInterval, PLAN_CATALOG } from "./plan-catalog";

export const TIERS = ["platform", "enterprise"] as const;
export type Tier = (typeof TIERS)[number];

/** DbTier is now identical to Tier — "free" has been retired. */
export type DbTier = Tier;

const TIER_RANK: Record<string, number> = {
  platform: 1,
  enterprise: 2,
  // Legacy values mapped for backward compatibility during cut-over
  free: 0,
  basic: 1,
  pro: 1,
};

export function tierMeetsMinimum(current: DbTier | string | null | undefined, minimum: Tier): boolean {
  if (!current) return false;
  const rank = TIER_RANK[current as string] ?? 0;
  return rank >= TIER_RANK[minimum];
}

export type Feature =
  | "recipe_costing"
  | "brand_background"
  | "power_inventory"
  | "transfer_orders"
  | "tfc_variance"
  | "pos_import"
  | "cross_shop_vendor_pricing"
  | "smart_dashboard"
  | "unlimited_locations"
  | "no_ads"
  | "order_reminders"
  | "custom_security_levels"
  | "enterprise_analytics"
  | "ai_assistant"
  | "prep_chart"
  | "quickbooks_integration";

// All features now require at minimum the "platform" plan.
// enterprise_analytics is the only enterprise-only feature.
const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  order_reminders: "platform",
  recipe_costing: "platform",
  brand_background: "platform",
  no_ads: "platform",
  tfc_variance: "platform",
  pos_import: "platform",
  smart_dashboard: "platform",
  power_inventory: "platform",
  transfer_orders: "platform",
  cross_shop_vendor_pricing: "platform",
  unlimited_locations: "platform",
  custom_security_levels: "platform",
  prep_chart: "platform",
  quickbooks_integration: "platform",
  enterprise_analytics: "enterprise",
  ai_assistant: "platform",
};

export function featureMinTier(feature: Feature): Tier {
  return FEATURE_MIN_TIER[feature];
}

export function hasFeature(currentTier: DbTier | string | null | undefined, feature: Feature): boolean {
  return tierMeetsMinimum(currentTier, FEATURE_MIN_TIER[feature]);
}

export const TIER_LABELS: Record<Tier, string> = {
  platform: "Platform",
  enterprise: "Enterprise",
};

export const TIER_COLORS: Record<Tier, string> = {
  platform: "default",
  enterprise: "outline",
};

export function getTierLabel(tier: DbTier | string | null | undefined): string {
  if (!tier) return "No Plan";
  return TIER_LABELS[tier as Tier] ?? tier;
}
