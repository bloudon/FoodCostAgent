/**
 * Dependency-injected Express request handlers for the onboarding invoice scan endpoints.
 * Extracted from server/routes.ts so they can be unit-tested with supertest
 * and mocked scanners/DB without importing the full routes module.
 */
import type { RequestHandler } from "express";
import { z } from "zod";
import type { ExtractedVendorItem, VendorReceiptScanResult } from "../services/vendorReceiptScanner";
import {
  resolvePriceSource,
  resolveScannedItemUnitPrice,
  resolveApplyLineUnitPrice,
} from "./invoiceScanUtils";

// ---------------------------------------------------------------------------
// Scan handler
// ---------------------------------------------------------------------------

export interface ScanHandlerDeps {
  /** Read an image buffer from object storage. */
  readBuffer: (
    objectPath: string,
    companyId: string,
    userId: string,
  ) => Promise<{ buffer: Buffer; mimeType: string }>;
  /** Call the AI vision service to extract line items from an invoice. */
  scanReceipt: (
    buffer: Buffer,
    mimeType: string,
  ) => Promise<VendorReceiptScanResult>;
  /** Fetch existing inventory items for fuzzy-match. */
  getInventoryItems: (
    companyId: string,
  ) => Promise<Array<{ id: string; name: string; pricePerUnit: number }>>;
}

const SUPPORTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchItem(
  item: ExtractedVendorItem,
  existingItems: Array<{ id: string; name: string }>,
): { matchedItemId: string | null; matchedItemName: string | null; matchConfidence: string } {
  const itemNorm = normalizeForMatch(item.name);
  const itemWords = new Set(itemNorm.split(" ").filter((w) => w.length > 2));
  let bestScore = 0;
  let bestMatch: { id: string; name: string } | null = null;

  for (const inv of existingItems) {
    const invNorm = normalizeForMatch(inv.name);
    const invWords = new Set(invNorm.split(" ").filter((w) => w.length > 2));
    if (itemWords.size === 0 && invWords.size === 0) continue;
    const intersection = [...itemWords].filter((w) => invWords.has(w)).length;
    const union = new Set([...itemWords, ...invWords]).size;
    const exactBonus =
      invNorm.includes(itemNorm) || itemNorm.includes(invNorm) ? 0.2 : 0;
    const score = Math.min(1, (union > 0 ? intersection / union : 0) + exactBonus);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = inv;
    }
  }

  const confidence =
    bestScore >= 0.6 ? "high" : bestScore >= 0.35 ? "medium" : "none";
  const matchedItem = confidence !== "none" ? bestMatch : null;
  return {
    matchedItemId: matchedItem?.id ?? null,
    matchedItemName: matchedItem?.name ?? null,
    matchConfidence: confidence,
  };
}

/**
 * Factory for the POST /api/onboarding/invoice-scan handler.
 * Injects storage, scanner, and DB dependencies so tests can supply fakes.
 */
export function createScanHandler(deps: ScanHandlerDeps): RequestHandler {
  return async (req, res) => {
    try {
      const companyId = (req as any).companyId as string;
      const userId = ((req as any).user?.id ?? "") as string;

      const parsed = z
        .object({ imageObjectPath: z.string().min(1, "imageObjectPath is required") })
        .safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid request", details: parsed.error.errors });
      }

      const { imageObjectPath } = parsed.data;
      const { buffer, mimeType } = await deps.readBuffer(
        imageObjectPath,
        companyId,
        userId,
      );

      if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
        return res.status(415).json({
          error: "Unsupported image type. Please upload JPG, PNG, or WebP.",
        });
      }

      const scanResult = await deps.scanReceipt(buffer, mimeType);
      if (scanResult.items.length === 0) {
        return res.status(422).json({
          error:
            "No product line items could be extracted from this image. Try a clearer photo.",
        });
      }

      const existingItems = await deps.getInventoryItems(companyId);

      const resultItems = scanResult.items.map((item) => {
        const { matchedItemId, matchedItemName, matchConfidence } = matchItem(
          item,
          existingItems,
        );

        // Core invariant tested in invoiceScanUtils.test.ts and endpoint tests:
        // unitPrice is ALWAYS a number in the response (never null/undefined).
        const priceSource = resolvePriceSource(item);
        const unitPrice = resolveScannedItemUnitPrice(item);

        return {
          name: item.name,
          sku: item.sku || null,
          unitPrice,
          casePrice: item.casePrice ?? null,
          priceSource,
          priceType: item.priceType,
          packSizeDescription: item.packSizeDescription || null,
          unit: item.unit || null,
          categoryHint: item.categoryHint || null,
          matchedItemId,
          matchedItemName,
          matchConfidence,
        };
      });

      return res.json({ items: resultItems, vendorName: scanResult.vendorName });
    } catch (error: any) {
      console.error("[Onboarding Invoice Scan]", error);
      return res.status(500).json({ error: error.message || "Failed to scan invoice" });
    }
  };
}

// ---------------------------------------------------------------------------
// Apply handler
// ---------------------------------------------------------------------------

export interface ApplyLineInput {
  name: string;
  unitPrice?: number | null;
  casePrice?: number | null;
  unit?: string;
  categoryHint?: string;
  action: "update" | "create" | "skip";
  inventoryItemId?: string;
}

export interface ApplyHandlerDeps {
  /** Resolve a unit abbreviation to a DB unit ID, falling back to the lb unit. */
  resolveUnitId: (unitStr: string | null | undefined) => string;
  /** Resolve a category hint string to a DB category ID. */
  resolveCategoryId: (hint: string | null | undefined) => string | null;
  /** Update an existing inventory item's price. Returns true if found. */
  updateItemPrice: (
    itemId: string,
    companyId: string,
    effectiveUnitPrice: number,
    casePrice: number | null | undefined,
  ) => Promise<boolean>;
  /** Create a new inventory item stub. Returns the new item ID. */
  createItem: (
    companyId: string,
    name: string,
    unitId: string,
    categoryId: string | null,
    effectiveUnitPrice: number,
  ) => Promise<string>;
  /** Trigger recipe cost recalculation for a list of inventory item IDs. */
  recalcRecipes: (itemIds: string[], companyId: string) => Promise<void>;
}

const applyBodySchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        unitPrice: z.number().nonnegative().nullable().optional(),
        casePrice: z.number().nonnegative().nullable().optional(),
        unit: z.string().optional(),
        categoryHint: z.string().optional(),
        action: z.enum(["update", "create", "skip"]),
        inventoryItemId: z.string().optional(),
      }),
    )
    .min(1),
});

/**
 * Factory for the POST /api/onboarding/invoice-scan/apply handler.
 * Injects DB-write operations so tests can assert effectiveUnitPrice behavior
 * without a real database connection.
 */
export function createApplyHandler(deps: ApplyHandlerDeps): RequestHandler {
  return async (req, res) => {
    try {
      const companyId = (req as any).companyId as string;

      const parsed = applyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid request", details: parsed.error.errors });
      }

      const { items } = parsed.data;
      const updatedItemIds: string[] = [];
      const createdItemIds: string[] = [];

      for (const line of items) {
        if (line.action === "skip") continue;

        // Core invariant: effectiveUnitPrice is always a number.
        // Falls back to casePrice when unitPrice is null/undefined, then to 0.
        const effectiveUnitPrice = resolveApplyLineUnitPrice(line);

        if (line.action === "update" && line.inventoryItemId) {
          const updated = await deps.updateItemPrice(
            line.inventoryItemId,
            companyId,
            effectiveUnitPrice,
            line.casePrice,
          );
          if (updated) updatedItemIds.push(line.inventoryItemId);
        }

        if (line.action === "create") {
          const unitId = deps.resolveUnitId(line.unit);
          const categoryId = deps.resolveCategoryId(line.categoryHint);
          const newId = await deps.createItem(
            companyId,
            line.name,
            unitId,
            categoryId,
            effectiveUnitPrice,
          );
          createdItemIds.push(newId);
        }
      }

      await deps.recalcRecipes(updatedItemIds, companyId);

      return res.json({
        updatedCount: updatedItemIds.length,
        createdCount: createdItemIds.length,
        updatedItemIds,
        createdItemIds,
      });
    } catch (error: any) {
      console.error("[Onboarding Invoice Scan Apply]", error);
      return res
        .status(500)
        .json({ error: error.message || "Failed to apply invoice scan" });
    }
  };
}
