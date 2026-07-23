/**
 * Storage-layer isolation test for getCompanyStore.
 *
 * This is a defense-in-depth test. The HTTP-level 403/404 check (in the route
 * handler) is one layer of protection. This test verifies that the underlying
 * storage function itself is the final line of defense: calling
 * `getCompanyStore(storeId, wrongCompanyId)` returns undefined, ensuring no
 * cross-company data can leak even if the application-layer check is bypassed
 * through future refactoring.
 *
 * Test data mirrors what the Playwright cross-company isolation suite uses:
 *   Company A – Brian's Pizza   (ad95ecda-74a9-49d7-833b-6d7d2f48efd1)
 *     Store:   2c9272ed-8ccc-45f7-ab81-45504a87b7cb
 *
 *   Company B – The Breakfast Nook  (bn-company-0001)
 *
 * The test requires a live DATABASE_URL (same as all other integration tests
 * in this project). It is skipped automatically when DATABASE_URL is absent.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "./storage";

const COMPANY_A_ID    = "ad95ecda-74a9-49d7-833b-6d7d2f48efd1";
const COMPANY_A_STORE = "2c9272ed-8ccc-45f7-ab81-45504a87b7cb";
const COMPANY_B_ID    = "bn-company-0001";
const NONEXISTENT_ID  = "00000000-0000-0000-0000-000000000000";

describe("storage.getCompanyStore — company-ID isolation", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      console.warn(
        "[skip] DATABASE_URL not set — storage isolation test requires a live DB",
      );
    }
  });

  it("returns undefined when the storeId belongs to a different company", async () => {
    if (!process.env.DATABASE_URL) return;

    const result = await storage.getCompanyStore(COMPANY_A_STORE, COMPANY_B_ID);
    expect(
      result,
      "getCompanyStore must return undefined when companyId does not match the store's company — " +
        "this is the storage-layer line of defense that prevents cross-company data leakage",
    ).toBeUndefined();
  });

  it("returns the store when the correct companyId is supplied (positive case)", async () => {
    if (!process.env.DATABASE_URL) return;

    const result = await storage.getCompanyStore(COMPANY_A_STORE, COMPANY_A_ID);
    expect(result, "getCompanyStore must return the store when companyId matches").toBeDefined();
    expect(result?.id).toBe(COMPANY_A_STORE);
    expect(result?.companyId).toBe(COMPANY_A_ID);
  });

  it("returns the store when no companyId is supplied (backward-compat, no filter applied)", async () => {
    if (!process.env.DATABASE_URL) return;

    const result = await storage.getCompanyStore(COMPANY_A_STORE);
    expect(result, "getCompanyStore without companyId must still return the store").toBeDefined();
    expect(result?.id).toBe(COMPANY_A_STORE);
  });

  it("returns undefined for a completely nonexistent storeId regardless of companyId", async () => {
    if (!process.env.DATABASE_URL) return;

    const result = await storage.getCompanyStore(NONEXISTENT_ID, COMPANY_A_ID);
    expect(result).toBeUndefined();
  });
});
