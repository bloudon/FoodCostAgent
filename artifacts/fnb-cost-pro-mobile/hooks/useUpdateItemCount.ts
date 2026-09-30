import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useScan } from "@/context/ScanContext";
import { CountDeltaQueue, DirectSetQueue } from "@/lib/countDeltaQueue";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const DEBOUNCE_MS = 500;

export function useUpdateItemCount(
  sessionId: string,
  onServerQty?: (itemId: string, qty: number) => void,
) {
  const { getToken, handleUnauthorized } = useAuth();
  const { backendUrl } = useScan();
  const [hasSaveError, setHasSaveError] = useState(false);
  const packageSaveChainsRef = useRef(new Map<string, Promise<{
    qty: number;
    caseQty: number;
    containerQty: number;
  } | null>>());
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
        const res = await fetchWithAuth(
          url,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ count }),
          },
          handleUnauthorized,
        );
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
    [getToken, backendUrl, sessionId, handleUnauthorized]
  );

  // Package counts are absolute physical quantities. They must never use the
  // canonical direct-set or atomic add queues: the server derives canonical
  // quantity from cases and physical containers.
  const savePackageCount = useCallback(
    async (
      itemId: string,
      caseQty: number,
      containerQty: number,
    ): Promise<{
      qty: number;
      caseQty: number;
      containerQty: number;
    } | null> => {
      const url = `${backendUrl}/api/mobile/sessions/${sessionId}/lines/${itemId}`;
      const previous = packageSaveChainsRef.current.get(itemId) ?? Promise.resolve(null);
      const request = previous.then(async () => {
        try {
          const token = await getToken();
          const res = await fetchWithAuth(
            url,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                caseQty,
                containerQty,
                looseUnits: 0,
              }),
            },
            handleUnauthorized,
          );
          if (!res.ok) {
            setHasSaveError(true);
            return null;
          }
          const line = await res.json();
          const qty = typeof line?.qty === "number" ? line.qty : null;
          if (qty === null) {
            setHasSaveError(true);
            return null;
          }
          const confirmed = {
            qty,
            caseQty: typeof line?.caseQty === "number" ? line.caseQty : caseQty,
            containerQty: typeof line?.containerQty === "number" ? line.containerQty : containerQty,
          };
          onServerQtyRef.current?.(itemId, confirmed.qty);
          return confirmed;
        } catch {
          setHasSaveError(true);
          return null;
        }
      });
      packageSaveChainsRef.current.set(itemId, request);
      void request.finally(() => {
        if (packageSaveChainsRef.current.get(itemId) === request) {
          packageSaveChainsRef.current.delete(itemId);
        }
      });
      return request;
    },
    [getToken, backendUrl, sessionId, handleUnauthorized],
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
        const res = await fetchWithAuth(
          url,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ addQty: delta }),
          },
          handleUnauthorized,
        );
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
    [getToken, backendUrl, sessionId, handleUnauthorized]
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
        const res = await fetchWithAuth(
          url,
          {
            method: "DELETE",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
          handleUnauthorized,
        );
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
    [getToken, backendUrl, sessionId, handleUnauthorized]
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

  return {
    saveCount,
    savePackageCount,
    addToCount,
    flushAll,
    hasSaveError,
    clearSaveError,
    clearAllCounts,
  };
}
