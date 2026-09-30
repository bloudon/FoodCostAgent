import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface SessionItem {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  value: number;
  categoryName: string | null;
  locationName: string | null;
  caseQty: number | null;
  containerQty: number | null;
  looseUnits: number | null;
  caseSize: number | null;
  containerSize: number | null;
  casePkgCount: number | null;
  containerLabel: string | null;
  countMode: "catch" | "direct" | "package" | "unconfigured" | null;
  countStatus: "historicalLoose" | "ready" | "incomplete" | null;
  isCounted: boolean;
  isCatchWeightCategory: boolean;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || fallback : fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const parsed = num(v, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeItem(raw: Record<string, unknown>): SessionItem {
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    name: typeof raw.name === "string" ? raw.name : "",
    quantity: num(raw.quantity ?? raw.qty ?? raw.count),
    unit: str(raw.unit ?? raw.unitName ?? raw.unit_name),
    value: num(raw.value ?? raw.totalValue ?? raw.total_value ?? raw.price),
    categoryName: str(raw.categoryName ?? raw.category_name ?? raw.category),
    locationName: str(raw.locationName ?? raw.location_name ?? raw.location),
    caseQty: nullableNum(raw.caseQty ?? raw.case_qty),
    containerQty: nullableNum(raw.containerQty ?? raw.container_qty),
    looseUnits: nullableNum(raw.looseUnits ?? raw.loose_units),
    caseSize: nullableNum(raw.caseSize ?? raw.case_size),
    containerSize: nullableNum(raw.containerSize ?? raw.container_size),
    casePkgCount: nullableNum(raw.casePkgCount ?? raw.case_pkg_count),
    containerLabel: str(raw.containerLabel ?? raw.container_label),
    countMode:
      raw.countMode === "catch" ||
      raw.countMode === "direct" ||
      raw.countMode === "package" ||
      raw.countMode === "unconfigured"
        ? raw.countMode
        : null,
    countStatus:
      raw.countStatus === "historicalLoose" ||
      raw.countStatus === "ready" ||
      raw.countStatus === "incomplete"
        ? raw.countStatus
        : null,
    isCounted:
      typeof raw.isCounted === "boolean"
        ? raw.isCounted
        : num(raw.quantity ?? raw.qty ?? raw.count) > 0,
    isCatchWeightCategory: Boolean(
      raw.isCatchWeightCategory ??
        raw.is_catch_weight_category ??
        raw.isTareWeightCategory ??
        raw.is_tare_weight_category,
    ),
  };
}

function unwrapArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json !== null && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
  }
  return [];
}

export function useSessionItems(
  sessionId: string,
  filter: { categoryId?: string; locationId?: string }
) {
  const { getToken, handleUnauthorized } = useAuth();
  const { backendUrl } = useScan();
  const [items, setItems] = useState<SessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const hasData = useRef(false);

  const fetch_ = useCallback(async () => {
    if (!sessionId) return;
    if (inFlight.current) return;
    inFlight.current = true;

    const initialLoad = !hasData.current;
    if (initialLoad) setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (filter.categoryId) params.set("categoryId", filter.categoryId);
      if (filter.locationId) params.set("locationId", filter.locationId);
      const url = `${backendUrl}/api/mobile/sessions/${sessionId}/items?${params.toString()}`;
      const res = await fetchWithAuth(
        url,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        handleUnauthorized,
      );
      if (res.ok) {
        const json = (await res.json()) as unknown;
        setItems(unwrapArray(json).map(normalizeItem));
        hasData.current = true;
      } else {
        setError(`Could not load items. (${res.status})`);
      }
    } catch {
      setError("Could not load items.");
    } finally {
      if (initialLoad) setIsLoading(false);
      inFlight.current = false;
    }
  }, [getToken, backendUrl, sessionId, filter.categoryId, filter.locationId]);

  return { items, isLoading, error, refetch: fetch_ };
}
