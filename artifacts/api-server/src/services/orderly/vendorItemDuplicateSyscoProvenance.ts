export const SYSCO_DUPLICATE_VENDOR_ITEM_IDS = [
  "04f822ba-fb2d-479e-9f9b-6aefc4b0af90",
  "ca185955-ce85-4c92-be7e-875974c0100d",
] as const;

export type SyscoProvenanceConclusion =
  | "TWELVE_EA_AUTHORITATIVE_CURRENT"
  | "ONE_EA_AUTHORITATIVE_CURRENT"
  | "PACK_CONFIGURATION_CHANGED_OVER_TIME"
  | "DISTINCT_LEGITIMATE_CURRENT_PRODUCTS"
  | "INSUFFICIENT_EVIDENCE";

export type SyscoProvenanceEvent = {
  occurredAt: string | null;
  /** Only a source record explicitly asserted current by its owning system may set this. */
  isCurrent: boolean;
  source: string;
  directVendorItemId: string | null;
  bridge: "direct" | "vendor-and-sku" | "inventory-item" | "unlinked";
  packEvidence: {
    caseSize: number | null;
    innerPackSize: number | null;
    packUom: string | null;
    rawDescription: string | null;
    confidence: "authoritative" | "supporting" | "unknown";
  };
  priceContext?: { casePrice: number | null; unitPrice: number | null } | null;
  details: Record<string, unknown>;
};

export function chronological(events: readonly SyscoProvenanceEvent[]): SyscoProvenanceEvent[] {
  return [...events].sort((left, right) => {
    const a = left.occurredAt ?? "9999-12-31T23:59:59.999Z";
    const b = right.occurredAt ?? "9999-12-31T23:59:59.999Z";
    return a.localeCompare(b) || left.source.localeCompare(right.source);
  });
}

function totalPackUnits(event: SyscoProvenanceEvent): number | null {
  const { caseSize, innerPackSize } = event.packEvidence;
  if (caseSize == null || innerPackSize == null) return null;
  return caseSize * innerPackSize;
}

/**
 * Price snapshots are intentionally excluded. A conclusion can only use dated,
 * direct evidence with an authoritative pack assertion. Only evidence expressly
 * marked current can establish the present pack; otherwise the result remains
 * insufficient even if every historical record agrees.
 */
export function concludeSyscoProvenance(events: readonly SyscoProvenanceEvent[]): {
  conclusion: SyscoProvenanceConclusion;
  rationale: string;
} {
  const authoritative = chronological(events).filter((event) =>
    event.bridge === "direct" &&
    event.packEvidence.confidence === "authoritative" &&
    event.occurredAt !== null &&
    totalPackUnits(event) != null,
  );
  if (authoritative.length === 0) {
    return {
      conclusion: "INSUFFICIENT_EVIDENCE",
      rationale: "No dated, direct, authoritative source record establishes a Sysco pack identity. Current snapshots, indirect bridges, and price arithmetic are supporting context only.",
    };
  }
  const authoritativeCurrent = authoritative.filter((event) => event.isCurrent);
  if (authoritativeCurrent.length > 0) {
    const currentPacksByVendorItem = new Map<string, number>();
    for (const event of authoritativeCurrent) {
      if (!event.directVendorItemId) continue;
      const pack = totalPackUnits(event)!;
      const previous = currentPacksByVendorItem.get(event.directVendorItemId);
      if (previous != null && previous !== pack) {
        return {
          conclusion: "INSUFFICIENT_EVIDENCE",
          rationale: "Direct authoritative current records disagree for one vendor-item identity. No result can elect a survivor.",
        };
      }
      currentPacksByVendorItem.set(event.directVendorItemId, pack);
    }
    const currentPacks = [...new Set(currentPacksByVendorItem.values())];
    if (currentPacksByVendorItem.size >= 2 && currentPacks.includes(12) && currentPacks.includes(1)) {
      return {
        conclusion: "DISTINCT_LEGITIMATE_CURRENT_PRODUCTS",
        rationale: "Dated direct authoritative current evidence independently establishes a 12 EA and a 1 EA product. This describes distinct current products and does not authorize a merge.",
      };
    }
    if (currentPacks.length === 1 && currentPacks[0] === 12) {
      return {
        conclusion: "TWELVE_EA_AUTHORITATIVE_CURRENT",
        rationale: "Dated direct authoritative current evidence establishes 12 EA. A later PM decision is still required before any held row enters a mutation set.",
      };
    }
    if (currentPacks.length === 1 && currentPacks[0] === 1) {
      return {
        conclusion: "ONE_EA_AUTHORITATIVE_CURRENT",
        rationale: "Dated direct authoritative current evidence establishes 1 EA. A later PM decision is still required before any held row enters a mutation set.",
      };
    }
    return {
      conclusion: "INSUFFICIENT_EVIDENCE",
      rationale: "Direct authoritative current evidence exists but does not establish one reviewed 1 EA or 12 EA identity.",
    };
  }
  const packUnits = [...new Set(authoritative.map((event) => totalPackUnits(event)!))];
  if (packUnits.length > 1) {
    return {
      conclusion: "PACK_CONFIGURATION_CHANGED_OVER_TIME",
      rationale: "Dated, direct, authoritative source evidence records more than one pack quantity. This describes historical change and does not authorize a merge.",
    };
  }
  return {
    conclusion: "INSUFFICIENT_EVIDENCE",
    rationale: "Historical direct authoritative evidence exists, but no dated source explicitly establishes currentness. It cannot elect a winner.",
  };
}