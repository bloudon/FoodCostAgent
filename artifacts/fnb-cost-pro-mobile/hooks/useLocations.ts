import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";

export interface StoreLocation {
  id: string;
  name: string;
}

function normalizeLocations(json: unknown): StoreLocation[] {
  const arr = Array.isArray(json) ? json : [];
  return arr
    .filter((l): l is Record<string, unknown> => l !== null && typeof l === "object")
    .map((l) => ({
      id: String(l["id"] ?? l["location_id"] ?? ""),
      name: String(l["name"] ?? l["location_name"] ?? ""),
    }))
    .filter((l) => l.id.length > 0);
}

export function useLocations() {
  const { getToken } = useAuth();
  const { backendUrl } = useScan();
  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLocations = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${backendUrl}/api/mobile/locations`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        setLocations(normalizeLocations(json));
      } else {
        setLocations([]);
      }
    } catch {
      setLocations([]);
    } finally {
      setIsLoading(false);
    }
  }, [getToken, backendUrl]);

  useFocusEffect(
    useCallback(() => {
      fetchLocations();
    }, [fetchLocations])
  );

  return { locations, isLoading, refetch: fetchLocations };
}
