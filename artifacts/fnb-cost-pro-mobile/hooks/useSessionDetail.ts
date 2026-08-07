import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";

export interface SessionCategory {
  id: string;
  name: string;
  itemCount: number;
  countedItems: number;
  value: number;
}

export interface SessionLocation {
  id: string;
  name: string;
  itemCount: number;
  countedItems: number;
  value: number;
}

export interface SessionDetail {
  id: string;
  name: string;
  startedAt: string;
  totalItems: number;
  countedItems: number;
  totalValue: number;
  categories: SessionCategory[];
  locations: SessionLocation[];
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || fallback : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function unwrap(json: unknown): Record<string, unknown> {
  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if (
      typeof obj.data === "object" &&
      obj.data !== null &&
      !Array.isArray(obj.data)
    ) {
      return obj.data as Record<string, unknown>;
    }
    return obj;
  }
  return {};
}

function unwrapInventoryItems(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (json !== null && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as Array<Record<string, unknown>>;
    if (Array.isArray(obj.data)) return obj.data as Array<Record<string, unknown>>;
    if (obj.data !== null && typeof obj.data === "object" && !Array.isArray(obj.data)) {
      const inner = obj.data as Record<string, unknown>;
      if (Array.isArray(inner.items)) return inner.items as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function normalizeGroup(
  raw: Record<string, unknown>,
  countedOverride?: number
): SessionCategory | SessionLocation {
  return {
    id: str(raw.id),
    name: str(raw.name),
    itemCount: num(raw.itemCount ?? raw.item_count ?? raw.count),
    countedItems: countedOverride ?? num(raw.countedItems ?? raw.counted_items),
    value: num(raw.value ?? raw.totalValue ?? raw.total_value),
  };
}

function normalizeSessionDetail(
  raw: Record<string, unknown>,
  inventoryItems: Array<Record<string, unknown>>
): SessionDetail {
  // Build per-location and per-category counted maps from inventory items.
  // An item is "counted" if its currentCount > 0.
  const countedByLocation = new Map<string, number>();
  const countedByCategory = new Map<string, number>();
  let totalCountedFromInventory = 0;

  for (const item of inventoryItems) {
    const count = num(item.currentCount ?? item.current_count ?? item.count ?? item.quantity);
    if (count > 0) {
      totalCountedFromInventory += 1;

      // Use the same broad fallbacks as useSessionInventory so manually-entered
      // items that arrive without a proper ID (but do have a name) are still counted.
      const locId = str(item.locationId ?? item.location_id);
      const locName = str(item.locationName ?? item.location_name ?? item.location);
      if (locId) {
        countedByLocation.set(locId, (countedByLocation.get(locId) ?? 0) + 1);
      } else if (locName) {
        countedByLocation.set(locName, (countedByLocation.get(locName) ?? 0) + 1);
      }

      const catId = str(item.categoryId ?? item.category_id);
      const catName = str(item.categoryName ?? item.category_name ?? item.category);
      if (catId) {
        countedByCategory.set(catId, (countedByCategory.get(catId) ?? 0) + 1);
      } else if (catName) {
        countedByCategory.set(catName, (countedByCategory.get(catName) ?? 0) + 1);
      }
    }
  }

  // When inventory data is available, always prefer client-computed counts.
  // Match by ID first, then fall back to name so that items without a proper
  // categoryId/locationId (common for manually-entered items) still contribute.
  const hasInventory = inventoryItems.length > 0;

  const categories = Array.isArray(raw.categories)
    ? (raw.categories as Record<string, unknown>[]).map((c) => {
        const id = str(c.id);
        const name = str(c.name);
        const counted = countedByCategory.get(id) ?? countedByCategory.get(name);
        return normalizeGroup(c, hasInventory ? (counted ?? 0) : undefined) as SessionCategory;
      })
    : [];

  const locations = Array.isArray(raw.locations)
    ? (raw.locations as Record<string, unknown>[]).map((l) => {
        const id = str(l.id);
        const name = str(l.name);
        const counted = countedByLocation.get(id) ?? countedByLocation.get(name);
        return normalizeGroup(l, hasInventory ? (counted ?? 0) : undefined) as SessionLocation;
      })
    : [];

  // Prefer the client-computed countedItems when inventory data is available,
  // because the production API may omit this top-level field entirely.
  const apiCountedItems = num(raw.countedItems ?? raw.counted_items ?? raw.itemsCounted ?? raw.items_counted);
  const countedItems = inventoryItems.length > 0 ? totalCountedFromInventory : apiCountedItems;

  return {
    id: str(raw.id),
    name: str(raw.name),
    startedAt: str(raw.startedAt ?? raw.started_at ?? raw.createdAt ?? raw.created_at),
    totalItems: num(raw.totalItems ?? raw.total_items ?? raw.itemCount ?? raw.item_count),
    countedItems,
    totalValue: num(raw.totalValue ?? raw.total_value),
    categories,
    locations,
  };
}

export function useSessionDetail(sessionId: string) {
  const { getToken } = useAuth();
  const { backendUrl } = useScan();
  const [data, setData] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Mirror data presence in a ref so fetch_ stays stable (no data dep needed).
  const hasData = useRef(false);

  const fetch_ = useCallback(async () => {
    if (!sessionId) return;
    if (inFlight.current) return;
    inFlight.current = true;

    // Only show the full loading skeleton on the initial fetch (no data yet).
    const initialLoad = !hasData.current;
    if (initialLoad) setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      // Fetch session detail and inventory in parallel.
      // The inventory endpoint lets us compute countedItems client-side,
      // which is necessary because the production API may omit that field.
      const [detailRes, inventoryRes] = await Promise.all([
        fetch(`${backendUrl}/api/mobile/sessions/${sessionId}`, {
          headers: authHeader,
        }),
        fetch(`${backendUrl}/api/mobile/sessions/${sessionId}/inventory`, {
          headers: authHeader,
        }).catch(() => null),
      ]);

      if (detailRes.ok) {
        const detailJson = (await detailRes.json()) as unknown;
        const inventoryJson = inventoryRes?.ok ? ((await inventoryRes.json()) as unknown) : null;
        const inventoryItems = unwrapInventoryItems(inventoryJson);
        setData(normalizeSessionDetail(unwrap(detailJson), inventoryItems));
        hasData.current = true;
      } else {
        setError(`Could not load session details. (${detailRes.status})`);
      }
    } catch {
      setError("Could not load session details.");
    } finally {
      if (initialLoad) setIsLoading(false);
      inFlight.current = false;
    }
  }, [getToken, backendUrl, sessionId]);

  return { data, isLoading, error, refetch: fetch_ };
}
