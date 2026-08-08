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
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || fallback : fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
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
