export const TIERS = ["free", "basic", "pro"] as const;
export type Tier = (typeof TIERS)[number];

const TIER_RANK: Record<Tier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
};

export function tierMeetsMinimum(current: Tier | null | undefined, minimum: Tier): boolean {
  const effective: Tier = current && TIERS.includes(current as Tier) ? (current as Tier) : "free";
  return TIER_RANK[effective] >= TIER_RANK[minimum];
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
  | "no_ads";

const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  recipe_costing: "basic",
  brand_background: "basic",
  no_ads: "basic",
  power_inventory: "pro",
  transfer_orders: "pro",
  tfc_variance: "pro",
  pos_import: "pro",
  cross_shop_vendor_pricing: "pro",
  smart_dashboard: "pro",
  unlimited_locations: "pro",
};

export function featureMinTier(feature: Feature): Tier {
  return FEATURE_MIN_TIER[feature];
}

export function hasFeature(currentTier: Tier | null | undefined, feature: Feature): boolean {
  return tierMeetsMinimum(currentTier, FEATURE_MIN_TIER[feature]);
}

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

export const TIER_COLORS: Record<Tier, string> = {
  free: "secondary",
  basic: "default",
  pro: "destructive",
};
