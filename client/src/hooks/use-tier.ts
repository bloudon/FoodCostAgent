import { useAuth } from "@/lib/auth-context";
import { type Tier, type DbTier, type Feature, hasFeature, tierMeetsMinimum } from "@shared/tier-config";

export function useTier() {
  const { user } = useAuth();

  const isGlobalAdmin = user?.role === "global_admin";
  const dbTier: DbTier | null = isGlobalAdmin
    ? "enterprise"
    : ((user?.subscriptionTier as DbTier) ?? null);

  return {
    tier: dbTier,
    isGlobalAdmin,
    hasFeature: (feature: Feature) => isGlobalAdmin || hasFeature(dbTier, feature),
    meetsMinimum: (min: Tier) => isGlobalAdmin || tierMeetsMinimum(dbTier, min),
  };
}
