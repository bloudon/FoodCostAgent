/**
 * Reviewed schema contract for the READ-ONLY vendor-item duplicate classifier.
 *
 * This is intentionally NOT a generic "missing references are OK" mechanism.
 * The invoice-import staging column is the sole approved legacy-optional
 * consumer, because restored production predates that later feature.
 */
export type ReferenceCompatibilityState =
  | "required_present"
  | "current_present"
  | "legacy_optional_absent";

export type ReferenceSource = {
  table: string;
  column: string;
  legacyOptional?: false | true;
};

export type ReferenceCompatibility = {
  present: boolean;
  applicableReferences: number;
  compatibilityState: ReferenceCompatibilityState;
};

export const VENDOR_ITEM_REFERENCE_SOURCES: readonly ReferenceSource[] = [
  { table: "historical_invoice_lines", column: "vendor_item_id" },
  { table: "inventory_item_price_history", column: "vendor_item_id" },
  { table: "po_lines", column: "vendor_item_id" },
  { table: "po_routing_audit", column: "vendor_item_id" },
  { table: "po_routing_audit", column: "source_vendor_item_id" },
  { table: "receipt_lines", column: "vendor_item_id" },
  // The only approved legacy exception: added with vendor-invoice staging
  // after the restored production schema. Do not add other optional sources
  // without a separately reviewed compatibility decision.
  {
    table: "vendor_invoice_import_lines",
    column: "resolved_vendor_item_id",
    legacyOptional: true,
  },
  { table: "vendor_item_external_mappings", column: "vendor_item_id" },
];

export function referenceKey(source: Pick<ReferenceSource, "table" | "column">): string {
  return `${source.table}.${source.column}`;
}

export class ReferenceSchemaCompatibilityError extends Error {
  readonly unexpected: string[];
  readonly missingRequired: string[];

  constructor({ unexpected, missingRequired }: { unexpected: string[]; missingRequired: string[] }) {
    super(
      `Reference column set drifted since the reviewed classifier contract. ` +
        `unexpected=${JSON.stringify(unexpected)} missingRequired=${JSON.stringify(missingRequired)}. ` +
        "STOP — re-audit before classification.",
    );
    this.name = "ReferenceSchemaCompatibilityError";
    this.unexpected = unexpected;
    this.missingRequired = missingRequired;
  }
}

/**
 * Validates the exact reviewed reference inventory before any classification
 * query is allowed. The return value includes every reviewed source so reports
 * make the legacy absence visible rather than silently omitting it.
 */
export function validateReferenceColumnCompatibility(liveColumns: readonly string[]): {
  sourceCompatibility: Record<string, ReferenceCompatibility>;
  presentSources: ReferenceSource[];
} {
  const live = new Set(liveColumns);
  const reviewed = new Set(VENDOR_ITEM_REFERENCE_SOURCES.map(referenceKey));
  const unexpected = [...live].filter((key) => !reviewed.has(key)).sort();
  const missingRequired = VENDOR_ITEM_REFERENCE_SOURCES
    .filter((source) => !source.legacyOptional && !live.has(referenceKey(source)))
    .map(referenceKey)
    .sort();

  if (unexpected.length > 0 || missingRequired.length > 0) {
    throw new ReferenceSchemaCompatibilityError({ unexpected, missingRequired });
  }

  const sourceCompatibility: Record<string, ReferenceCompatibility> = {};
  const presentSources: ReferenceSource[] = [];
  for (const source of VENDOR_ITEM_REFERENCE_SOURCES) {
    const key = referenceKey(source);
    const present = live.has(key);
    sourceCompatibility[key] = {
      present,
      applicableReferences: 0,
      compatibilityState: present
        ? source.legacyOptional
          ? "current_present"
          : "required_present"
        : "legacy_optional_absent",
    };
    if (present) presentSources.push(source);
  }

  return { sourceCompatibility, presentSources };
}