/**
 * pricing-constants.ts — thin re-export shim.
 *
 * All pricing constants have moved to shared/plan-catalog.ts.
 * This shim is kept for backward compatibility of existing import sites.
 */
export { PRICING, MARKETING_PRICING, type BillingTerm } from "@shared/plan-catalog";
