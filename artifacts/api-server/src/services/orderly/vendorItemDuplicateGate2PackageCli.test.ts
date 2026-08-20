import { describe, expect, it, vi } from "vitest";
import { runVendorItemDuplicateGate2Package } from "./vendorItemDuplicateGate2PackageCli";

describe("non-executable Gate 2 package CLI guards", () => {
  it("fails before reading evidence files or writing a package when reference drift is present", async () => {
    let calls = 0;
    const readFile = vi.fn();
    const writePackage = vi.fn();
    const execute = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return [];
      if (calls === 2) return [{ db: "production-db" }];
      if (calls === 3) return [{ table_name: "unexpected", column_name: "vendor_item_id" }];
      throw new Error("no other query expected");
    });

    await expect(runVendorItemDuplicateGate2Package({ execute, readFile, writePackage })).rejects.toThrow(/Reference column set drifted/);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(readFile).not.toHaveBeenCalled();
    expect(writePackage).not.toHaveBeenCalled();
  });
});