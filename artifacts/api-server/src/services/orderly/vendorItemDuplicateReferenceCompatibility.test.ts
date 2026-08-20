import { describe, expect, it } from "vitest";
import {
  ReferenceSchemaCompatibilityError,
  VENDOR_ITEM_REFERENCE_SOURCES,
  referenceKey,
  validateReferenceColumnCompatibility,
} from "./vendorItemDuplicateReferenceCompatibility";

const optionalKey = "vendor_invoice_import_lines.resolved_vendor_item_id";
const requiredColumns = VENDOR_ITEM_REFERENCE_SOURCES
  .filter((source) => !source.legacyOptional)
  .map(referenceKey);

describe("vendor-item duplicate classifier reference compatibility", () => {
  it("accepts only the reviewed legacy state and reports the absent source explicitly", () => {
    const compatibility = validateReferenceColumnCompatibility(requiredColumns);

    expect(compatibility.presentSources.map(referenceKey)).not.toContain(optionalKey);
    expect(compatibility.sourceCompatibility[optionalKey]).toEqual({
      present: false,
      applicableReferences: 0,
      compatibilityState: "legacy_optional_absent",
    });
  });

  it("counts the reviewed invoice-import source when the newer schema contains it", () => {
    const compatibility = validateReferenceColumnCompatibility([...requiredColumns, optionalKey]);

    expect(compatibility.presentSources.map(referenceKey)).toContain(optionalKey);
    expect(compatibility.sourceCompatibility[optionalKey]).toEqual({
      present: true,
      applicableReferences: 0,
      compatibilityState: "current_present",
    });
  });

  it("fails closed for an unexpected reference consumer", () => {
    expect(() => validateReferenceColumnCompatibility([...requiredColumns, "unexpected_table.vendor_item_id"]))
      .toThrow(ReferenceSchemaCompatibilityError);
  });

  it("fails closed when any required reference consumer is absent", () => {
    expect(() => validateReferenceColumnCompatibility(requiredColumns.slice(1)))
      .toThrow(ReferenceSchemaCompatibilityError);
  });
});