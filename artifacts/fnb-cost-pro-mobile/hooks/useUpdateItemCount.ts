import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";

const DEBOUNCE_MS = 500;

export function useUpdateItemCount(sessionId: string) {
  const { getToken } = useAuth();
  const { backendUrl } = useScan();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, number>>({});
  const [hasSaveError, setHasSaveError] = useState(false);

  const patch = useCallback(
    async (itemId: string, count: number): Promise<void> => {
      const url = `${backendUrl}/api/mobile/sessions/${sessionId}/lines/${itemId}`;
      try {
        const token = await getToken();
        const res = await fetch(url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ count }),
        });
        if (!res.ok) {
          let body = "";
          try { body = await res.text(); } catch {}
          console.warn(
            `[useUpdateItemCount] PATCH HTTP ${res.status} — URL: ${url} — body: ${body}`
          );
          setHasSaveError(true);
        }
      } catch (err) {
        console.warn(`[useUpdateItemCount] Network error — URL: ${url} —`, err);
        setHasSaveError(true);
      }
    },
    [getToken, backendUrl, sessionId]
  );

  const saveCount = useCallback(
    (itemId: string, count: number) => {
      pending.current[itemId] = count;
      if (timers.current[itemId]) {
        clearTimeout(timers.current[itemId]);
      }
      timers.current[itemId] = setTimeout(() => {
        const c = pending.current[itemId];
        delete pending.current[itemId];
        delete timers.current[itemId];
        patch(itemId, c);
      }, DEBOUNCE_MS);
    },
    [patch]
  );

  const flushAll = useCallback(async (): Promise<void> => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};

    const snapshot = { ...pending.current };
    pending.current = {};
    await Promise.all(
      Object.entries(snapshot).map(([itemId, count]) => patch(itemId, count))
    );
  }, [patch]);

  const clearSaveError = useCallback(() => setHasSaveError(false), []);

  const clearAllCounts = useCallback(
    async (filter?: { categoryId?: string; locationId?: string }): Promise<boolean> => {
      const params = new URLSearchParams();
      if (filter?.categoryId) params.set("categoryId", filter.categoryId);
      if (filter?.locationId) params.set("locationId", filter.locationId);
      const qs = params.toString();
      const url = `${backendUrl}/api/mobile/sessions/${sessionId}/inventory${qs ? `?${qs}` : ""}`;
      try {
        const token = await getToken();
        const res = await fetch(url, {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          setHasSaveError(true);
          return false;
        }
        return true;
      } catch {
        setHasSaveError(true);
        return false;
      }
    },
    [getToken, backendUrl, sessionId]
  );

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "background" || nextState === "inactive") {
        flushAll();
      }
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      sub.remove();
      flushAll();
    };
  }, [flushAll]);

  return { saveCount, flushAll, hasSaveError, clearSaveError, clearAllCounts };
}
