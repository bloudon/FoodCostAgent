import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@workspace/db";

const mocks = vi.hoisted(() => ({
  getCompanyStore: vi.fn(),
  getUserStores: vi.fn(),
}));

vi.mock("./storage", () => ({ storage: mocks }));

import { canEditCountLineInStore } from "./permissions";

const count = { companyId: "company-a", storeId: "store-b" };
const user = (role: User["role"]) => ({
  id: "counter-a",
  companyId: "company-a",
  role,
}) as User;

describe("count-line mutation company and store guard", () => {
  beforeEach(() => {
    mocks.getCompanyStore.mockReset().mockResolvedValue(count);
    mocks.getUserStores.mockReset().mockResolvedValue([{ storeId: "store-a" }]);
  });

  it("does not expose a count in another or missing company context", async () => {
    expect(await canEditCountLineInStore(user("store_user"), "company-b", count)).toBe(false);
    expect(await canEditCountLineInStore(user("store_user"), undefined, count)).toBe(false);
    expect(mocks.getCompanyStore).not.toHaveBeenCalled();
  });

  it("denies a same-company counter who is not assigned to the count store", async () => {
    expect(await canEditCountLineInStore(user("store_user"), "company-a", count)).toBe(false);
    expect(mocks.getUserStores).toHaveBeenCalledWith("counter-a");
  });

  it("allows a store-assigned counter and company administrator", async () => {
    mocks.getUserStores.mockResolvedValueOnce([{ storeId: "store-b" }]);
    expect(await canEditCountLineInStore(user("store_user"), "company-a", count)).toBe(true);
    expect(await canEditCountLineInStore(user("company_admin"), "company-a", count)).toBe(true);
  });

  it("preserves global administrator access within an explicit company context", async () => {
    expect(await canEditCountLineInStore(user("global_admin"), "company-a", count)).toBe(true);
  });
});