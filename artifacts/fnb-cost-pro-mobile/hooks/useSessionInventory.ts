import { useCallback, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface InventoryItem {
  id: string;
  inventoryItemId: string;
  name: string;
  unit: string | null;
  barcode: string | null;
  categoryId: string;
  categoryName: string;
  locationId: string | null;
  locationName: string | null;
  currentCount: number;
  expectedCount: number | null;
  isCatchWeightCategory: boolean;
  countMode: "catch" | "package" | "direct" | "unconfigured";
  countBlockedReason: string | null;
  countStatus: "ready" | "incomplete" | "historicalLoose" | null;
  caseQty: number | null;
  containerQty: number | null;
  looseUnits: number | null;
  containerSize: number | null;
  casePkgCount: number | null;
  containerLabel: string | null;
}

export interface InventorySection {
  categoryId: string;
  categoryName: string;
  data: InventoryItem[];
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number"
    ? v
    : typeof v === "string"
    ? parseFloat(v) || fallback
    : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

function normalizeItem(raw: Record<string, unknown>): InventoryItem {
  const isCatchWeightCategory = !!(raw.isCatchWeightCategory ?? raw.is_catch_weight_category ?? raw.isTareWeightCategory ?? raw.is_tare_weight_category);
  const containerSize = numOrNull(raw.containerSize ?? raw.container_size);
  const casePkgCount = numOrNull(raw.casePkgCount ?? raw.case_pkg_count);
  const containerLabel = strOrNull(raw.containerLabel ?? raw.container_label);
  const looseUnits = numOrNull(raw.looseUnits ?? raw.loose_units);
  const hasPackageMetadata = containerSize != null || casePkgCount != null || containerLabel != null;
  const derivedMode = isCatchWeightCategory
    ? "catch"
    : hasPackageMetadata
      ? "package"
      : "direct";
  const rawMode = raw.countMode ?? raw.count_mode;
  return {
    id: str(raw.id ?? raw.inventoryItemId ?? raw.inventory_item_id),
    inventoryItemId: str(raw.inventoryItemId ?? raw.inventory_item_id ?? raw.id),
    name: str(raw.name),
    unit: strOrNull(raw.unit ?? raw.unitName ?? raw.unit_name),
    barcode: strOrNull(raw.barcode ?? raw.barcodeValue ?? raw.barcode_value),
    categoryId: str(raw.categoryId ?? raw.category_id ?? raw.categoryName ?? raw.category_name),
    categoryName: str(raw.categoryName ?? raw.category_name ?? raw.category),
    locationId: strOrNull(raw.locationId ?? raw.location_id),
    locationName: strOrNull(raw.locationName ?? raw.location_name ?? raw.location),
    currentCount: num(raw.currentCount ?? raw.current_count ?? raw.count ?? raw.quantity),
    expectedCount: numOrNull(raw.expectedCount ?? raw.expected_count ?? raw.expected),
    isCatchWeightCategory,
    countMode: (rawMode ?? derivedMode) as InventoryItem["countMode"],
    countBlockedReason: strOrNull(raw.countBlockedReason ?? raw.count_blocked_reason),
    countStatus: (raw.countStatus ?? raw.count_status ?? (looseUnits != null && looseUnits > 0 ? "historicalLoose" : hasPackageMetadata && containerSize != null && containerSize > 0 && casePkgCount != null && casePkgCount > 0 ? "ready" : hasPackageMetadata ? "incomplete" : null)) as InventoryItem["countStatus"],
    caseQty: numOrNull(raw.caseQty ?? raw.case_qty),
    containerQty: numOrNull(raw.containerQty ?? raw.container_qty),
    looseUnits,
    containerSize,
    casePkgCount,
    containerLabel,
  };
}

function unwrapItems(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json !== null && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    if (obj.data !== null && typeof obj.data === "object" && !Array.isArray(obj.data)) {
      const inner = obj.data as Record<string, unknown>;
      if (Array.isArray(inner.items)) return inner.items as Record<string, unknown>[];
    }
  }
  return [];
}

function groupByCategory(items: InventoryItem[]): InventorySection[] {
  const map = new Map<string, InventorySection>();
  for (const item of items) {
    const key = item.categoryId || "__uncategorized__";
    if (!map.has(key)) {
      map.set(key, {
        categoryId: key,
        categoryName: item.categoryName || "Uncategorized",
        data: [],
      });
    }
    map.get(key)!.data.push(item);
  }
  return Array.from(map.values());
}

export function useSessionInventory(
  sessionId: string,
  filter?: { categoryId?: string; locationId?: string }
) {
  const { getToken, handleUnauthorized } = useAuth();
  const { backendUrl } = useScan();
  const [sections, setSections] = useState<InventorySection[]>([]);
  const [allItems, setAllItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(!!sessionId);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (filter?.categoryId) params.set("categoryId", filter.categoryId);
      if (filter?.locationId) params.set("locationId", filter.locationId);
      const qs = params.toString();
      const url = `${backendUrl}/api/mobile/sessions/${sessionId}/inventory${qs ? `?${qs}` : ""}`;
      const res = await fetchWithAuth(
        url,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        handleUnauthorized,
      );
      if (res.ok) {
        const json = (await res.json()) as unknown;
        const items = unwrapItems(json).map(normalizeItem);
        setAllItems(items);
        setSections(groupByCategory(items));
      } else {
        setAllItems([]);
        setSections([]);
        setError(`Could not load inventory. (${res.status})`);
      }
    } catch {
      setAllItems([]);
      setSections([]);
      setError("Could not load inventory.");
    } finally {
      setIsLoading(false);
    }
  }, [getToken, backendUrl, sessionId, filter?.categoryId, filter?.locationId]);

  return { sections, allItems, isLoading, error, refetch };
}
