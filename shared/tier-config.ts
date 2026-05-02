export const TIERS = ["basic", "pro", "enterprise"] as const;
export type Tier = (typeof TIERS)[number];

export type DbTier = Tier | "free";

const TIER_RANK: Record<DbTier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  enterprise: 3,
};

export function tierMeetsMinimum(current: DbTier | null | undefined, minimum: Tier): boolean {
  if (!current) return false;
  const rank = TIER_RANK[current as DbTier] ?? 0;
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
  | "prep_chart";

const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  order_reminders: "basic",
  recipe_costing: "basic",
  brand_background: "basic",
  no_ads: "basic",
  tfc_variance: "basic",
  pos_import: "basic",
  smart_dashboard: "basic",
  power_inventory: "pro",
  transfer_orders: "pro",
  cross_shop_vendor_pricing: "pro",
  unlimited_locations: "pro",
  custom_security_levels: "pro",
  prep_chart: "pro",
  enterprise_analytics: "enterprise",
  ai_assistant: "basic",
};

export function featureMinTier(feature: Feature): Tier {
  return FEATURE_MIN_TIER[feature];
}

export function hasFeature(currentTier: DbTier | null | undefined, feature: Feature): boolean {
  return tierMeetsMinimum(currentTier, FEATURE_MIN_TIER[feature]);
}

export const TIER_LABELS: Record<Tier, string> = {
  basic: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

export const TIER_COLORS: Record<Tier, string> = {
  basic: "default",
  pro: "destructive",
  enterprise: "outline",
};

export function getTierLabel(tier: DbTier | null | undefined): string {
  if (!tier || tier === "free") return "Legacy";
  return TIER_LABELS[tier] ?? tier;
}
