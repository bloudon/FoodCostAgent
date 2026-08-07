import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";

export interface ActiveSession {
  id: string;
  name: string;
  startedAt: string;
  scanCount: number;
  locationId: string | null;
}

export function useActiveSessions(locationId?: string | null) {
  const { getToken } = useAuth();
  const { backendUrl } = useScan();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const url = new URL(`${backendUrl}/api/mobile/sessions/active`);
      if (locationId) {
        url.searchParams.set("locationId", locationId);
      }
      const res = await fetch(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        const raw = Array.isArray(json) ? (json as ActiveSession[]) : [];
        const sorted = [...raw].sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
        setSessions(sorted);
      } else {
        setSessions([]);
      }
    } catch {
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [getToken, backendUrl, locationId]);

  useFocusEffect(
    useCallback(() => {
      fetchSessions();
    }, [fetchSessions])
  );

  return { sessions, isLoading, refetch: fetchSessions };
}
