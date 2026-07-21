/**
 * Route-lines access guard factory.
 *
 * Extracted from POST /api/purchase-orders/:id/route-lines so the tenant
 * isolation logic can be unit-tested via supertest without bootstrapping the
 * full Express app (same pattern as invoiceScanHandler.ts).
 *
 * The guard:
 *   1. Tries to load the source PO scoped to the authenticated company.
 *   2. If NOT found, checks whether the PO exists for ANY company.
 *      - Exists for another company → 403 (access denied)
 *      - Does not exist at all     → 404 (not found)
 *   3. If found (company matches) → attaches sourcePo to req and calls next().
 */

import type { Request, Response, NextFunction } from "express";
import type { PurchaseOrder } from "@shared/schema";

// ─── Dependency interface ─────────────────────────────────────────────────────

export interface RoutingPOGuardDeps {
  /** Fetch the PO scoped to the given company (returns undefined on mismatch). */
  getPurchaseOrder: (id: string, companyId: string) => Promise<PurchaseOrder | undefined>;
  /** Returns true if the PO exists in any company (used to distinguish 403 from 404). */
  checkPoExists: (id: string) => Promise<boolean>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that enforces company-scoped access to the
 * source PO.  On success, attaches the PO record to `req.sourcePo` so the
 * downstream route handler does not need to re-fetch it.
 *
 * @param deps  Injectable DB/storage operations (real in production, fake in tests).
 */
export function createRoutingPOGuard(deps: RoutingPOGuardDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const companyId = (req as any).companyId as string | null;
    const sourcePoId = req.params.id;

    const sourcePo = await deps.getPurchaseOrder(sourcePoId, companyId ?? "");

    if (!sourcePo) {
      const exists = await deps.checkPoExists(sourcePoId);
      if (exists) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }

    (req as any).sourcePo = sourcePo;
    next();
  };
}
