import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { getOperatingMode, type SubscriptionPlan, type OperatingMode } from "@shared/plan-catalog";
import type { Feature } from "@shared/tier-config";

/**
 * Normalizes a raw subscription plan or legacy tier value to a canonical SubscriptionPlan.
 *
 * Mapping:
 *   "platform"              → "platform"  (canonical paid plan)
 *   "enterprise"            → "enterprise" (canonical paid plan)
 *   "pro" | "basic"         → "platform"  (legacy tier names that map to the Platform plan)
 *   "free" | null | unknown → null        (no active paid plan)
 */
export function normalizePlan(raw: string | null | undefined): SubscriptionPlan | null {
  if (!raw) return null;
  if (raw === "enterprise") return "enterprise";
  if (raw === "platform" || raw === "pro" || raw === "basic") return "platform";
  // Anything else (e.g. "free", unrecognized string) is not a paid plan
  return null;
}

export function useTier() {
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "global_admin";

  // subscriptionPlan is the canonical field (Task #808); fall back to legacy subscriptionTier if present.
  // Always normalize so legacy values ("free", "basic", "pro") map correctly to paid or null.
  const rawPlan = (user as any)?.subscriptionPlan ?? (user as any)?.subscriptionTier ?? null;
  const subscriptionPlan: SubscriptionPlan | null = isGlobalAdmin
    ? "enterprise"
    : normalizePlan(rawPlan);

  // Fetch active operating locations to derive the operating mode.
  // companyStores records with status="active" are the operating locations.
  // Storage areas (walk-ins, freezers, prep rooms) live in a separate table and
  // must never be counted here.
  const { data: stores = [] } = useQuery<Array<{ id: string; status: string }>>({
    queryKey: ["/api/stores/accessible"],
    enabled: !!user && !isGlobalAdmin,
    staleTime: 5 * 60 * 1000, // 5 min — mode only changes when locations are added/removed
  });

  const activeOperatingLocationCount = stores.filter((s) => s.status === "active").length;

  const operatingMode: OperatingMode = isGlobalAdmin
    ? "enterprise"
    : getOperatingMode({ subscriptionPlan, activeOperatingLocationCount });

  /**
   * Returns true if the current account has access to the given feature.
   *
   * Entitlement model:
   *   - All features except enterprise_analytics are available on any paid plan
   *     (platform or enterprise). There is no longer a "Pro" tier gate.
   *   - enterprise_analytics requires the enterprise plan.
   *   - null/free/unknown plans → always false (not a paid account).
   *   - Global admins always pass.
   */
  function hasFeature(feature: Feature): boolean {
    if (isGlobalAdmin) return true;
    if (!subscriptionPlan) return false; // no active paid plan (includes legacy "free")
    if (feature === "enterprise_analytics") return subscriptionPlan === "enterprise";
    return true; // all other features available on any paid plan (platform or enterprise)
  }

  /**
   * Returns true if the account meets the given minimum plan level.
   * Kept for backward compatibility with call sites that haven't been migrated yet.
   */
  function meetsMinimum(min: "platform" | "enterprise"): boolean {
    if (isGlobalAdmin) return true;
    if (!subscriptionPlan) return false;
    if (min === "platform") return true; // both platform and enterprise qualify
    if (min === "enterprise") return subscriptionPlan === "enterprise";
    return false;
  }

  return {
    tier: subscriptionPlan, // backward-compat alias for subscriptionPlan
    subscriptionPlan,
    operatingMode,
    isGlobalAdmin,
    hasFeature,
    meetsMinimum,
  };
}
