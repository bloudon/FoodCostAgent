/**
 * Unit tests for use-tier.ts normalizePlan helper.
 *
 * These tests verify that legacy subscriptionTier values are correctly mapped
 * to canonical SubscriptionPlan values (or null for non-paid plans) so that
 * the entitlement gates are never incorrectly unlocked by stale data.
 */

import { describe, it, expect } from "vitest";
import { normalizePlan } from "./use-tier";

describe("normalizePlan — canonical plan values", () => {
  it("passes 'platform' through unchanged", () => {
    expect(normalizePlan("platform")).toBe("platform");
  });

  it("passes 'enterprise' through unchanged", () => {
    expect(normalizePlan("enterprise")).toBe("enterprise");
  });
});

describe("normalizePlan — legacy tier values", () => {
  it("maps 'pro' → 'platform'", () => {
    expect(normalizePlan("pro")).toBe("platform");
  });

  it("maps 'basic' → 'platform'", () => {
    expect(normalizePlan("basic")).toBe("platform");
  });
});

describe("normalizePlan — non-paid / unknown values → null", () => {
  it("returns null for 'free' (not a paid plan)", () => {
    expect(normalizePlan("free")).toBeNull();
  });

  it("returns null for null", () => {
    expect(normalizePlan(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizePlan(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizePlan("")).toBeNull();
  });

  it("returns null for unrecognized strings", () => {
    expect(normalizePlan("starter")).toBeNull();
    expect(normalizePlan("trial")).toBeNull();
    expect(normalizePlan("unknown_tier")).toBeNull();
  });
});

describe("normalizePlan — hasFeature behaviour for normalized plans", () => {
  // These tests mirror the entitlement logic inline to verify the chain:
  // raw legacy value → normalizePlan → gating decision

  function simulateHasFeature(
    rawPlan: string | null | undefined,
    feature: string,
  ): boolean {
    const subscriptionPlan = normalizePlan(rawPlan);
    if (!subscriptionPlan) return false; // no paid plan
    if (feature === "enterprise_analytics") return subscriptionPlan === "enterprise";
    return true; // all other features on any paid plan
  }

  it("'free' user cannot access core platform features", () => {
    expect(simulateHasFeature("free", "quickbooks_integration")).toBe(false);
    expect(simulateHasFeature("free", "transfer_orders")).toBe(false);
    expect(simulateHasFeature("free", "tfc_variance")).toBe(false);
    expect(simulateHasFeature("free", "prep_chart")).toBe(false);
  });

  it("null plan user cannot access any features", () => {
    expect(simulateHasFeature(null, "quickbooks_integration")).toBe(false);
    expect(simulateHasFeature(null, "enterprise_analytics")).toBe(false);
  });

  it("'basic' legacy user can access core platform features", () => {
    expect(simulateHasFeature("basic", "quickbooks_integration")).toBe(true);
    expect(simulateHasFeature("basic", "transfer_orders")).toBe(true);
    expect(simulateHasFeature("basic", "tfc_variance")).toBe(true);
  });

  it("'pro' legacy user can access core platform features", () => {
    expect(simulateHasFeature("pro", "quickbooks_integration")).toBe(true);
    expect(simulateHasFeature("pro", "transfer_orders")).toBe(true);
    expect(simulateHasFeature("pro", "tfc_variance")).toBe(true);
  });

  it("'platform' user cannot access enterprise_analytics", () => {
    expect(simulateHasFeature("platform", "enterprise_analytics")).toBe(false);
  });

  it("'enterprise' user can access enterprise_analytics", () => {
    expect(simulateHasFeature("enterprise", "enterprise_analytics")).toBe(true);
  });

  it("'pro' legacy user cannot access enterprise_analytics (maps to platform)", () => {
    expect(simulateHasFeature("pro", "enterprise_analytics")).toBe(false);
  });
});
