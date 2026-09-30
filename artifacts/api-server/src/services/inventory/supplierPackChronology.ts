import { and, eq, inArray, or } from "drizzle-orm";
import {
  historicalInvoiceLines,
  historicalInvoices,
  inventoryItemPriceHistory,
  inventoryItems,
  vendorItems,
  vendorItemExternalMappings,
  vendors,
} from "@workspace/db";
import { db } from "../../db";

export type SupplierPackChronologyEvent = {
  date: string;
  source: string;
  vendorName: string | null;
  vendorItemId: string | null;
  sku: string | null;
  packLabel: string | null;
  rawPack: string | null;
  canonicalQuantity: number | null;
  casePrice: number | null;
  pricePerCanonicalUnit: number | null;
  observedUnitPrice: number | null;
  priceDate: string | null;
  packEvidenceDate: string | null;
  evidenceRef: string | null;
  evidenceType: "current_vendor" | "historical_invoice" | "price_observation";
  priceSource?: string | null;
};

type CurrentVendorPriceInput = {
  casePrice: number | null;
  canonicalQuantity: number | null;
  geometryStatus: string | null;
  pricingBasis: string | null;
  storedNormalizedPrice?: number | null;
};

type HistoricalInvoicePriceInput = {
  unitPrice: number | null;
  pricingBasis: string | null;
  canonicalQuantity: number | null;
};

type CurrentVendorRow = {
  vendorItemId: string;
  vendorName: string;
  sku: string | null;
  caseSize: number | null;
  innerPackSize: number | null;
  packUom: string | null;
  canonicalQuantity: number | null;
  geometryStatus: string | null;
  pricingBasis: string | null;
  casePrice: number | null;
  storedNormalizedPrice: number | null;
  pricedAt: Date | null;
  packGeometryUpdatedAt: Date | null;
  priceSource: string | null;
  evidenceRef: string | null;
};

type PriceObservationRow = {
  id: string;
  effectiveAt: Date;
  source: string | null;
  vendorItemId: string;
  pricePerUnit: number;
  casePrice: number | null;
};

type PriceObservationEventInput = {
  id: string;
  effectiveAt: Date;
  source: string | null;
  vendorItemId: string;
  vendorName: string | null;
  sku: string | null;
  pricePerUnit: number;
  casePrice: number | null;
};

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Build a label solely from explicitly stored current vendor pack fields. */
export function formatSupplierPackLabel(input: {
  caseSize: number | null;
  innerPackSize: number | null;
  packUom: string | null;
}): string | null {
  const { caseSize, innerPackSize, packUom } = input;
  if (
    !positiveFinite(caseSize) ||
    !positiveFinite(innerPackSize) ||
    !packUom?.trim()
  ) {
    return null;
  }
  return `${caseSize} × ${innerPackSize} ${packUom.trim()}`;
}

/**
 * Current vendor price normalization is permitted only for verified geometry,
 * a supported pricing basis, and a positive recorded case price. `casePrice`
 * is never synthesized from the legacy derived `lastPrice`. If a stored
 * normalized value exists, it must agree with this calculation.
 */
export function normalizeCurrentVendorPrice(input: CurrentVendorPriceInput): {
  canonicalQuantity: number | null;
  casePrice: number | null;
  pricePerCanonicalUnit: number | null;
} {
  const canNormalize =
    input.geometryStatus === "verified" &&
    (input.pricingBasis === "purchase_unit" ||
      input.pricingBasis === "canonical_unit") &&
    positiveFinite(input.canonicalQuantity);
  const canonicalQuantity = canNormalize ? input.canonicalQuantity : null;
  const casePrice = positiveFinite(input.casePrice) ? input.casePrice : null;
  const calculatedPrice =
    canonicalQuantity !== null && casePrice !== null
      ? casePrice / canonicalQuantity
      : null;
  const storedPriceAgrees =
    input.storedNormalizedPrice == null ||
    (positiveFinite(input.storedNormalizedPrice) &&
      calculatedPrice !== null &&
      Math.abs(input.storedNormalizedPrice - calculatedPrice) <= 0.000001);
  return {
    canonicalQuantity,
    casePrice,
    pricePerCanonicalUnit: storedPriceAgrees ? calculatedPrice : null,
  };
}

/**
 * Historical invoice prices are exposed only when the invoice evidence itself
 * explicitly says the price is per purchase unit and supplies positive pack
 * geometry. Raw text alone is not parsed or treated as verified geometry.
 */
export function normalizeHistoricalInvoicePrice(
  input: HistoricalInvoicePriceInput,
): {
  canonicalQuantity: number | null;
  casePrice: number | null;
  pricePerCanonicalUnit: number | null;
} {
  const canNormalize =
    input.pricingBasis === "purchase_unit" &&
    positiveFinite(input.canonicalQuantity);
  const canonicalQuantity = canNormalize ? input.canonicalQuantity : null;
  const casePrice =
    canNormalize && positiveFinite(input.unitPrice) ? input.unitPrice : null;
  return {
    canonicalQuantity,
    casePrice,
    pricePerCanonicalUnit:
      canonicalQuantity !== null && casePrice !== null
        ? casePrice / canonicalQuantity
        : null,
  };
}

/** A mapping is only a SKU fallback when its company-scoped result is unique. */
export function resolveSupplierSku(
  vendorSku: string | null,
  mappingSourceExternalIds: string[],
): string | null {
  if (vendorSku?.trim()) return vendorSku.trim();
  const distinctIds = [...new Set(mappingSourceExternalIds.filter((id) => id.trim()))];
  return distinctIds.length === 1 ? distinctIds[0] : null;
}

/** Invoice lines directly linked to the item cannot inherit an unrelated VI. */
export function trustedInvoiceVendorItemId(
  vendorItemId: string | null,
  itemVendorItemIds: ReadonlySet<string>,
): string | null {
  return vendorItemId && itemVendorItemIds.has(vendorItemId)
    ? vendorItemId
    : null;
}

export function resolveHistoricalInvoiceSku(input: {
  rawSku: string | null;
  invoiceVendorItemId: string | null;
  itemVendorItemIds: ReadonlySet<string>;
  currentVendorSku: string | null;
  mappingSourceExternalIds: string[];
}): string | null {
  if (input.rawSku !== null) return input.rawSku;
  if (!trustedInvoiceVendorItemId(input.invoiceVendorItemId, input.itemVendorItemIds)) {
    return null;
  }
  return resolveSupplierSku(input.currentVendorSku, input.mappingSourceExternalIds);
}

/** Historical price rows deliberately have no pack/geometry fields. */
export function buildPriceObservationEvent(
  input: PriceObservationEventInput,
): SupplierPackChronologyEvent {
  const date = input.effectiveAt.toISOString();
  return {
    date,
    source: input.source ?? "price_history",
    vendorName: input.vendorName,
    vendorItemId: input.vendorItemId,
    sku: input.sku,
    packLabel: null,
    rawPack: null,
    canonicalQuantity: null,
    casePrice: input.casePrice,
    pricePerCanonicalUnit: null,
    observedUnitPrice: input.pricePerUnit,
    priceDate: date,
    packEvidenceDate: null,
    evidenceRef: `inventory_item_price_history:${input.id}`,
    evidenceType: "price_observation",
  };
}

export function buildCurrentVendorEvent(
  row: CurrentVendorRow,
  mappingSourceExternalIds: string[],
): SupplierPackChronologyEvent | null {
  const priceDate = currentDateString(row.pricedAt);
  if (!priceDate) return null;
  const normalized = normalizeCurrentVendorPrice({
    casePrice: row.casePrice,
    canonicalQuantity: row.canonicalQuantity,
    geometryStatus: row.geometryStatus,
    pricingBasis: row.pricingBasis,
    storedNormalizedPrice: row.storedNormalizedPrice,
  });
  return {
    date: priceDate,
    source: "CURRENT RECORD",
    priceSource: row.priceSource,
    vendorName: row.vendorName,
    vendorItemId: row.vendorItemId,
    sku: resolveSupplierSku(row.sku, mappingSourceExternalIds),
    packLabel: formatSupplierPackLabel({
      caseSize: row.caseSize,
      innerPackSize: row.innerPackSize,
      packUom: row.packUom,
    }),
    rawPack: null,
    ...normalized,
    observedUnitPrice: null,
    priceDate,
    packEvidenceDate: currentDateString(row.packGeometryUpdatedAt),
    evidenceRef: row.evidenceRef,
    evidenceType: "current_vendor",
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function explicitPositiveNumber(
  object: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    if (positiveFinite(object[key])) return object[key];
  }
  return null;
}

function explicitText(
  object: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function currentDateString(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Read-only supplier price/pack evidence for one company-owned inventory item.
 * Historical lines are included only through the exact item ID or an exact
 * vendor-item ID currently linked to that item in the same company.
 */
export async function getSupplierPackChronology(
  itemId: string,
  companyId: string,
): Promise<{ events: SupplierPackChronologyEvent[] }> {
  const [ownedItem] = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.companyId, companyId),
      ),
    )
    .limit(1);

  if (!ownedItem) return { events: [] };

  const currentRows = await db
    .select({
      vendorItemId: vendorItems.id,
      vendorName: vendors.name,
      sku: vendorItems.vendorSku,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
      canonicalQuantity: vendorItems.canonicalQtyPerPurchaseUnit,
      geometryStatus: vendorItems.packGeometryStatus,
      pricingBasis: vendorItems.pricingBasis,
      casePrice: vendorItems.lastCasePrice,
      storedNormalizedPrice: vendorItems.normalizedPricePerCanonicalUnit,
      pricedAt: vendorItems.pricedAt,
      packGeometryUpdatedAt: vendorItems.packGeometryUpdatedAt,
      priceSource: vendorItems.priceSource,
      evidenceRef: vendorItems.priceSourceReferenceId,
    })
    .from(vendorItems)
    .innerJoin(vendors, eq(vendorItems.vendorId, vendors.id))
    .innerJoin(inventoryItems, eq(vendorItems.inventoryItemId, inventoryItems.id))
    .where(
      and(
        eq(vendorItems.inventoryItemId, itemId),
        eq(inventoryItems.companyId, companyId),
        eq(vendors.companyId, companyId),
      ),
    );

  const vendorItemIds = currentRows.map((row: CurrentVendorRow) => row.vendorItemId);
  const companyVendorItemIds = new Set<string>(vendorItemIds);
  const mappings = vendorItemIds.length
    ? await db
        .select({
          vendorItemId: vendorItemExternalMappings.vendorItemId,
          sourceExternalId: vendorItemExternalMappings.sourceExternalId,
        })
        .from(vendorItemExternalMappings)
        .where(
          and(
            eq(vendorItemExternalMappings.companyId, companyId),
            inArray(vendorItemExternalMappings.vendorItemId, vendorItemIds),
          ),
        )
    : [];
  const externalIdsByVendorItem = new Map<string, string[]>();
  for (const mapping of mappings) {
    const ids = externalIdsByVendorItem.get(mapping.vendorItemId) ?? [];
    ids.push(mapping.sourceExternalId);
    externalIdsByVendorItem.set(mapping.vendorItemId, ids);
  }
  const historicalPredicate = vendorItemIds.length
    ? or(
        eq(historicalInvoiceLines.inventoryItemId, itemId),
        inArray(historicalInvoiceLines.vendorItemId, vendorItemIds),
      )
    : eq(historicalInvoiceLines.inventoryItemId, itemId);

  const historicalRows = await db
    .select({
      sourceLineId: historicalInvoiceLines.sourceLineId,
      vendorItemId: historicalInvoiceLines.vendorItemId,
      sku: historicalInvoiceLines.sourceExternalId,
      unitPrice: historicalInvoiceLines.unitPrice,
      packSnapshot: historicalInvoiceLines.packSnapshot,
      invoiceDate: historicalInvoices.invoiceDate,
      sourceSystem: historicalInvoices.sourceSystem,
      sourcePropertyId: historicalInvoices.sourcePropertyId,
      sourceInvoiceId: historicalInvoices.sourceInvoiceId,
      vendorNameSnapshot: historicalInvoices.vendorNameSnapshot,
      vendorName: vendors.name,
    })
    .from(historicalInvoiceLines)
    .innerJoin(
      historicalInvoices,
      eq(historicalInvoiceLines.invoiceId, historicalInvoices.id),
    )
    .leftJoin(
      vendors,
      and(
        eq(historicalInvoices.vendorId, vendors.id),
        eq(vendors.companyId, companyId),
      ),
    )
    .where(
      and(
        eq(historicalInvoiceLines.companyId, companyId),
        eq(historicalInvoices.companyId, companyId),
        historicalPredicate,
      ),
    );

  const priceObservationRows: PriceObservationRow[] = vendorItemIds.length
    ? await db
        .select({
          id: inventoryItemPriceHistory.id,
          effectiveAt: inventoryItemPriceHistory.effectiveAt,
          source: inventoryItemPriceHistory.source,
          vendorItemId: inventoryItemPriceHistory.vendorItemId,
          pricePerUnit: inventoryItemPriceHistory.pricePerUnit,
          casePrice: inventoryItemPriceHistory.casePrice,
        })
        .from(inventoryItemPriceHistory)
        .innerJoin(
          vendorItems,
          eq(inventoryItemPriceHistory.vendorItemId, vendorItems.id),
        )
        .innerJoin(vendors, eq(vendorItems.vendorId, vendors.id))
        .where(
          and(
            inArray(inventoryItemPriceHistory.vendorItemId, vendorItemIds),
            eq(vendorItems.inventoryItemId, itemId),
            eq(vendors.companyId, companyId),
          ),
        )
    : [];
  const currentVendorById = new Map<string, CurrentVendorRow>(
    currentRows.map(
      (row: CurrentVendorRow): [string, CurrentVendorRow] => [
        row.vendorItemId,
        row,
      ],
    ),
  );

  const events: SupplierPackChronologyEvent[] = currentRows.flatMap((row: CurrentVendorRow) => {
    const event = buildCurrentVendorEvent(
      row,
      externalIdsByVendorItem.get(row.vendorItemId) ?? [],
    );
    return event ? [event] : [];
  });

  for (const row of priceObservationRows) {
    const currentVendor = currentVendorById.get(row.vendorItemId);
    events.push(buildPriceObservationEvent({
      ...row,
      vendorName: currentVendor?.vendorName ?? null,
      sku: currentVendor
        ? resolveSupplierSku(
            currentVendor.sku,
            externalIdsByVendorItem.get(row.vendorItemId) ?? [],
          )
        : null,
    }));
  }

  for (const row of historicalRows) {
    const pack = jsonObject(row.packSnapshot);
    const normalized = normalizeHistoricalInvoicePrice({
      unitPrice: row.unitPrice,
      pricingBasis: explicitText(pack, ["pricingBasis", "pricing_basis"]),
      canonicalQuantity: explicitPositiveNumber(pack, [
        "canonicalQuantity",
        "canonicalQtyPerPurchaseUnit",
        "canonical_qty_per_purchase_unit",
      ]),
    });
    const source = `${row.sourceSystem}:${row.sourcePropertyId}:${row.sourceInvoiceId}:${row.sourceLineId}`;
    events.push({
      date: row.invoiceDate,
      source,
      vendorName: row.vendorNameSnapshot ?? row.vendorName,
      vendorItemId: trustedInvoiceVendorItemId(
        row.vendorItemId,
        companyVendorItemIds,
      ),
      sku: resolveHistoricalInvoiceSku({
        rawSku: row.sku,
        invoiceVendorItemId: row.vendorItemId,
        itemVendorItemIds: companyVendorItemIds,
        currentVendorSku: row.vendorItemId
          ? currentVendorById.get(row.vendorItemId)?.sku ?? null
          : null,
        mappingSourceExternalIds: row.vendorItemId
          ? externalIdsByVendorItem.get(row.vendorItemId) ?? []
          : [],
      }),
      packLabel: explicitText(pack, ["label", "packLabel", "pack_label"]),
      rawPack: explicitText(pack, ["raw", "packRaw", "pack_raw"]),
      ...normalized,
      observedUnitPrice: row.unitPrice,
      priceDate: row.invoiceDate,
      packEvidenceDate: null,
      evidenceRef: `${row.sourceSystem}:${row.sourcePropertyId}:${row.sourceInvoiceId}:${row.sourceLineId}`,
      evidenceType: "historical_invoice",
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
  return { events };
}