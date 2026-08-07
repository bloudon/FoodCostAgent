import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";
import { CountDeltaQueue, DirectSetQueue } from "@/lib/countDeltaQueue";

const DEBOUNCE_MS = 500;

export function useUpdateItemCount(
  sessionId: string,
  onServerQty?: (itemId: string, qty: number) => void,
) {
  const { getToken } = useAuth();
  const { backendUrl } = useScan();
  const [hasSaveError, setHasSaveError] = useState(false);
  const onServerQtyRef = useRef(onServerQty);
  onServerQtyRef.current = onServerQty;

  // Explicit typed input: absolute direct-set ("the shelf holds N",
  // last write wins by design). The local display is always reconciled from
  // the server-returned quantity via onServerQty.
  const patchSet = useCallback(
    async (itemId: string, count: number): Promise<number | null> => {
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
          return null;
        }
        const line = await res.json();
        return typeof line?.qty === "number" ? line.qty : count;
      } catch (err) {
        console.warn(`[useUpdateItemCount] Network error — URL: ${url} —`, err);
        return null;
      }
    },
    [getToken, backendUrl, sessionId]
  );

  const patchSetRef = useRef(patchSet);
  patchSetRef.current = patchSet;

  const setQueueRef = useRef<DirectSetQueue | null>(null);
  if (!setQueueRef.current) {
    setQueueRef.current = new DirectSetQueue(
      (itemId, count) => patchSetRef.current(itemId, count),
      {
        debounceMs: DEBOUNCE_MS,
        onServerQty: (itemId, qty) => onServerQtyRef.current?.(itemId, qty),
        onError: () => setHasSaveError(true),
      }
    );
  }

  // Relative +/- edits: accumulated per item and flushed as a single
  // `{ addQty }` PATCH so the server performs the atomic increment.
  // Concurrent devices cannot overwrite each other; the display reconciles
  // from the server-returned quantity via onServerQty.
  const patchAdd = useCallback(
    async (itemId: string, delta: number): Promise<number | null> => {
      const url = `${backendUrl}/api/mobile/sessions/${sessionId}/lines/${itemId}`;
      try {
        const token = await getToken();
        const res = await fetch(url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ addQty: delta }),
        });
        if (!res.ok) {
          let body = "";
          try { body = await res.text(); } catch {}
          console.warn(
            `[useUpdateItemCount] PATCH addQty HTTP ${res.status} — URL: ${url} — body: ${body}`
          );
          return null;
        }
        const line = await res.json();
        return typeof line?.qty === "number" ? line.qty : null;
      } catch (err) {
        console.warn(`[useUpdateItemCount] Network error — URL: ${url} —`, err);
        return null;
      }
    },
    [getToken, backendUrl, sessionId]
  );

  const patchAddRef = useRef(patchAdd);
  patchAddRef.current = patchAdd;

  const deltaQueueRef = useRef<CountDeltaQueue | null>(null);
  if (!deltaQueueRef.current) {
    deltaQueueRef.current = new CountDeltaQueue(
      (itemId, delta) => patchAddRef.current(itemId, delta),
      {
        debounceMs: DEBOUNCE_MS,
        onServerQty: (itemId, qty) => onServerQtyRef.current?.(itemId, qty),
        onError: () => setHasSaveError(true),
      }
    );
  }

  /** Relative increment/decrement — atomic server-side accumulation. */
  const addToCount = useCallback((itemId: string, delta: number) => {
    deltaQueueRef.current!.add(itemId, delta);
  }, []);

  /** Explicit typed direct-set — absolute value, reconciled from server. */
  const saveCount = useCallback((itemId: string, count: number) => {
    setQueueRef.current!.set(itemId, count);
  }, []);

  const flushAll = useCallback(async (): Promise<void> => {
    await Promise.all([
      setQueueRef.current!.flushAll(),
      deltaQueueRef.current!.flushAll(),
    ]);
  }, []);

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

  return { saveCount, addToCount, flushAll, hasSaveError, clearSaveError, clearAllCounts };
}
