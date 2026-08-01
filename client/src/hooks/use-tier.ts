import { useAuth } from "@/lib/auth-context";
import { type Tier, type DbTier, type Feature, hasFeature, tierMeetsMinimum } from "@shared/tier-config";

export function useTier() {
  const { user } = useAuth();

  const isGlobalAdmin = user?.role === "global_admin";
  // subscriptionPlan is the canonical field (Task #808); fall back to legacy subscriptionTier if present
  const rawPlan = (user as any)?.subscriptionPlan ?? (user as any)?.subscriptionTier ?? null;
  const dbTier: DbTier | null = isGlobalAdmin
    ? "enterprise"
    : (rawPlan as DbTier) ?? null;

  return {
    tier: dbTier,
    isGlobalAdmin,
    hasFeature: (feature: Feature) => isGlobalAdmin || hasFeature(dbTier, feature),
    meetsMinimum: (min: Tier) => isGlobalAdmin || tierMeetsMinimum(dbTier, min),
  };
}
