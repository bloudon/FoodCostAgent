import { useAuth } from "@/lib/auth-context";
import { type Tier, type Feature, hasFeature, tierMeetsMinimum } from "@shared/tier-config";

export function useTier() {
  const { user } = useAuth();

  const isGlobalAdmin = user?.role === "global_admin";
  const tier: Tier = isGlobalAdmin
    ? "pro"
    : ((user?.subscriptionTier as Tier) || "free");

  return {
    tier,
    isGlobalAdmin,
    hasFeature: (feature: Feature) => isGlobalAdmin || hasFeature(tier, feature),
    meetsMinimum: (min: Tier) => isGlobalAdmin || tierMeetsMinimum(tier, min),
  };
}
